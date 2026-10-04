import Trace from '../models/Trace.js';
import Span from '../models/Span.js';
import Service from '../models/Service.js';
import ErrorRecord from '../models/Error.js';
import env from '../config/env.js';
import { generateSpanId, generateTraceId } from '../utils/ids.js';
import { httpError } from '../utils/httpError.js';
import { explicitProjectId, resolveProjectId } from '../utils/projectScope.js';

const STATUSES = ['success', 'error'];

function toDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(400, `${fieldName} must be a valid date.`);
  return date;
}

function requireString(data, field) {
  if (typeof data[field] !== 'string' || !data[field].trim()) throw httpError(400, `${field} is required.`);
}

// Make sure every service that reports a span/trace exists in the services collection.
export async function ensureService(name, projectId, environment = env.nodeEnv) {
  const serviceName = name.trim().toLowerCase();
  const serviceEnvironment = String(environment || env.nodeEnv || 'development').trim().toLowerCase();
  await Service.updateOne(
    { projectId, name: serviceName },
    { $setOnInsert: { projectId, name: serviceName, environment: serviceEnvironment, status: 'healthy' } },
    { upsert: true },
  );
  return serviceName;
}

/**
 * Record an error tied to a trace + service.
 */
export async function recordError({ projectId, traceId = null, serviceName, errorType = 'Error', message, stackTrace = null, timestamp, environment }) {
  requireString({ serviceName }, 'serviceName');
  requireString({ message }, 'message');
  const project = resolveProjectId(projectId);
  await ensureService(serviceName, project, environment);
  return ErrorRecord.create({ projectId: project, traceId, serviceName, errorType, message, stackTrace, timestamp: timestamp || new Date() });
}

/**
 * Create (start) a trace. traceId is generated when not supplied.
 * A trace is persisted immediately with duration 0 and is finalized by completeTrace().
 * If endTime/duration are supplied the trace is stored already complete.
 */
export async function startTrace(data = {}) {
  requireString(data, 'rootService');
  requireString(data, 'route');
  requireString(data, 'method');

  const startTime = data.startTime ? toDate(data.startTime, 'startTime') : new Date();
  const endTime = data.endTime ? toDate(data.endTime, 'endTime') : null;
  if (endTime && endTime < startTime) throw httpError(400, 'endTime cannot be before startTime.');

  let duration = 0;
  if (data.duration !== undefined) {
    duration = Number(data.duration);
    if (!Number.isFinite(duration) || duration < 0) throw httpError(400, 'duration must be a non-negative number.');
  } else if (endTime) {
    duration = endTime - startTime;
  }
  const status = data.status || 'success';
  if (!STATUSES.includes(status)) throw httpError(400, 'status must be success or error.');

  const projectId = resolveProjectId(data.projectId);
  const traceId = data.traceId || generateTraceId();
  const rootService = await ensureService(data.rootService, projectId, data.environment);

  return Trace.create({
    projectId, traceId, rootService, route: data.route, method: data.method, duration, status, timestamp: startTime,
  });
}

/**
 * Record a span. spanId is generated when not supplied. Duration is calculated from
 * startTime/endTime. parentSpanId (if given) must belong to the same trace.
 * status 'error' automatically records an error document linked to traceId + service.
 */
export async function recordSpan(data = {}) {
  requireString(data, 'traceId');
  requireString(data, 'serviceName');
  requireString(data, 'operation');

  // The trace decides the project. An explicit projectId must match it (a trace of another project is "not found").
  const explicit = explicitProjectId(data.projectId);
  const trace = await Trace.findOne(explicit ? { traceId: data.traceId, projectId: explicit } : { traceId: data.traceId });
  if (!trace) throw httpError(404, `Trace not found: ${data.traceId}`);
  const projectId = trace.projectId;

  if (data.spanId !== undefined && (typeof data.spanId !== 'string' || !data.spanId.trim())) throw httpError(400, 'spanId must be a non-empty string.');
  if (data.parentSpanId !== undefined && data.parentSpanId !== null && typeof data.parentSpanId !== 'string') throw httpError(400, 'parentSpanId must be a string or null.');

  const startTime = data.startTime ? toDate(data.startTime, 'startTime') : new Date();
  let endTime = data.endTime ? toDate(data.endTime, 'endTime') : null;
  let duration;
  if (endTime) {
    if (endTime < startTime) throw httpError(400, 'endTime cannot be before startTime.');
    duration = endTime - startTime;
    if (data.duration !== undefined && Math.abs(Number(data.duration) - duration) > 1) {
      throw httpError(400, `duration (${data.duration}) does not match endTime - startTime (${duration} ms).`);
    }
  } else if (data.duration !== undefined) {
    duration = Number(data.duration);
    if (!Number.isFinite(duration) || duration < 0) throw httpError(400, 'duration must be a non-negative number.');
    endTime = new Date(startTime.getTime() + duration);
  } else {
    // Open span: closed later via finishSpan()
    duration = 0;
    endTime = startTime;
  }

  const status = data.status || 'success';
  if (!STATUSES.includes(status)) throw httpError(400, 'status must be success or error.');

  const spanId = data.spanId ? data.spanId.trim() : generateSpanId();
  if (await Span.exists({ spanId })) throw httpError(409, `Span already exists: ${spanId}`);

  const parentSpanId = data.parentSpanId || null;
  if (parentSpanId) {
    if (parentSpanId === spanId) throw httpError(400, 'A span cannot be its own parent.');
    const parent = await Span.findOne({ spanId: parentSpanId });
    if (!parent) throw httpError(404, `Parent span not found: ${parentSpanId}`);
    if (parent.traceId !== data.traceId) throw httpError(400, 'Parent span belongs to a different trace.');
  }

  const serviceName = await ensureService(data.serviceName, projectId);
  const span = await Span.create({
    projectId,
    spanId,
    traceId: data.traceId,
    parentSpanId,
    serviceName,
    operation: data.operation,
    duration,
    status,
    startTime,
    endTime,
  });

  if (status === 'error') {
    await recordError({
      projectId,
      traceId: span.traceId,
      serviceName,
      errorType: data.error?.type || data.errorType || 'Error',
      message: data.error?.message || data.errorMessage || `${data.operation} failed`,
      stackTrace: data.error?.stack || data.stackTrace || null,
      timestamp: endTime,
    });
  }
  return span;
}

/**
 * Persist one finished HTTP request as a span (and its trace, if it is new).
 * Used by the tracing middleware. 4xx/5xx (or an aborted request) => status 'error'.
 * - Unknown traceId  -> a new trace is created with this request as the root.
 * - Known traceId    -> the span is added to that trace (parentSpanId validated by recordSpan).
 * The trace document itself is never modified for an existing trace.
 */
export async function recordHttpSpan({ projectId, traceId, spanId, parentSpanId = null, serviceName, method, path, startTime, endTime, statusCode, aborted = false }) {
  const status = aborted || statusCode >= 400 ? 'error' : 'success';
  const duration = endTime - startTime;
  // Conventions (see seed.js + performanceService): Trace.route is the PATH only, Trace.method is separate,
  // Span.operation is "METHOD path". performanceService builds `${trace.method} ${trace.route}`, so a route that
  // already contained the method produced "GET GET /api/missions".
  const operation = `${method} ${path}`;
  const project = resolveProjectId(projectId);

  if (!(await Trace.exists({ traceId, projectId: project }))) {
    if (parentSpanId) throw httpError(404, `Parent span not found: ${parentSpanId} (trace ${traceId} does not exist)`);
    try {
      await startTrace({ projectId: project, traceId, rootService: serviceName, route: path, method, startTime, endTime, duration, status });
    } catch (error) {
      // Another concurrent request created the same trace first: that is fine. (If the id belongs to another
      // project, recordSpan below finds no such trace in THIS project and rejects, so nothing crosses over.)
      if (error?.code !== 11000) throw error;
    }
  }

  return recordSpan({
    projectId: project,
    traceId,
    spanId,
    parentSpanId,
    serviceName,
    operation,
    startTime,
    endTime,
    duration,
    status,
    errorType: `HTTP ${statusCode}`,
    errorMessage: aborted
      ? `${operation} aborted: client closed the connection before the response completed`
      : `${operation} responded with ${statusCode}`,
  });
}

/**
 * Close an open span: sets endTime, duration and status. Records an error if it failed.
 */
export async function finishSpan(spanId, { projectId, endTime, status = 'success', error } = {}) {
  if (!STATUSES.includes(status)) throw httpError(400, 'status must be success or error.');
  const span = await Span.findOne({ spanId, projectId: resolveProjectId(projectId) });
  if (!span) throw httpError(404, `Span not found: ${spanId}`);
  const end = endTime ? toDate(endTime, 'endTime') : new Date();
  if (end < span.startTime) throw httpError(400, 'endTime cannot be before startTime.');
  span.endTime = end;
  span.duration = end - span.startTime;
  span.status = status;
  await span.save();
  if (status === 'error') {
    await recordError({
      projectId: span.projectId,
      traceId: span.traceId,
      serviceName: span.serviceName,
      errorType: error?.type || 'Error',
      message: error?.message || `${span.operation} failed`,
      stackTrace: error?.stack || null,
      timestamp: end,
    });
  }
  return span;
}

/**
 * Finalize a trace from its spans: duration = latest span end - trace start
 * (or the root span duration), status = error if any span errored.
 */
export async function completeTrace(traceId, { projectId, endTime, status } = {}) {
  const project = resolveProjectId(projectId);
  const trace = await Trace.findOne({ traceId, projectId: project });
  if (!trace) throw httpError(404, `Trace not found: ${traceId}`);
  if (status && !STATUSES.includes(status)) throw httpError(400, 'status must be success or error.');

  const spans = await Span.find({ traceId, projectId: project });
  const start = trace.timestamp;
  let end = endTime ? toDate(endTime, 'endTime') : null;
  if (!end) {
    const latest = spans.reduce((max, span) => Math.max(max, span.endTime.getTime()), 0);
    end = latest ? new Date(Math.max(latest, start.getTime())) : new Date();
  }
  if (end < start) throw httpError(400, 'endTime cannot be before the trace start time.');

  trace.duration = end - start;
  trace.status = status || (spans.some((span) => span.status === 'error') ? 'error' : 'success');
  await trace.save();
  return { trace, spans: spans.sort((a, b) => a.startTime - b.startTime) };
}

/**
 * Build the parent/child tree for a trace.
 */
export async function getTraceTree(traceId, { projectId } = {}) {
  const project = resolveProjectId(projectId);
  const trace = await Trace.findOne({ traceId, projectId: project });
  if (!trace) throw httpError(404, 'Trace not found.');
  const spans = (await Span.find({ traceId, projectId: project }).sort({ startTime: 1 })).map((s) => ({ ...s.toObject(), children: [] }));
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const roots = [];
  spans.forEach((span) => {
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : null;
    (parent ? parent.children : roots).push(span);
  });
  return { trace, spans: roots };
}

/**
 * Find the trace an error/span refers to. Explicit projectId must match; otherwise the trace's own project is used.
 */
export async function findTraceForWrite(traceId, projectIdInput) {
  const explicit = explicitProjectId(projectIdInput);
  const trace = await Trace.findOne(explicit ? { traceId, projectId: explicit } : { traceId });
  if (!trace) throw httpError(404, `Trace not found: ${traceId}`);
  return trace;
}
