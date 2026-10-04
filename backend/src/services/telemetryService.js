/**
 * Telemetry ingestion for external SDKs (POST /api/telemetry/batch).
 *
 * Contract (v1) - every item MUST carry its own projectId; it is never derived from serviceName or routes.
 *   span : { projectId, traceId, spanId, parentSpanId|null, serviceName, environment?, operation, method, route,
 *            status: "success"|"error", startTime, endTime, duration(ms) }
 *   error: { projectId, traceId, spanId?, serviceName, errorType, message, stackTrace?, timestamp? }
 * Spans/errors are stored in the EXISTING collections (traces, spans, errors, services) through the existing
 * tracing service helpers. method/route/environment map onto Trace.route/method and Service.environment.
 *
 * Items are validated independently: a bad item is reported in `rejected`, good ones are still stored.
 */
import Trace from '../models/Trace.js';
import Span from '../models/Span.js';
import { assertValidProjectId } from '../config/projects.js';
import { ensureService, recordError, startTrace } from './tracingService.js';
import { httpError } from '../utils/httpError.js';

export const MAX_BATCH_ITEMS = 500;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const STATUSES = ['success', 'error'];
const MAX = { name: 128, operation: 512, route: 512, message: 4000, stack: 20000, environment: 64 };

// ---------- per-item validation (throws an Error flagged itemError) ----------
const bad = (message) => Object.assign(new Error(message), { itemError: true });
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function text(raw, field, { max, required = true } = {}) {
  const value = raw[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) throw bad(`${field} must be a non-empty string.`);
  if (max && value.trim().length > max) throw bad(`${field} must be at most ${max} characters.`);
  return value.trim();
}

function id(raw, field, { required = true } = {}) {
  const value = text(raw, field, { required });
  if (value !== undefined && !ID_PATTERN.test(value)) throw bad(`${field} must match ${ID_PATTERN}.`);
  return value;
}

function projectIdOf(raw) {
  if (typeof raw.projectId !== 'string' || !raw.projectId) throw bad('projectId is required.');
  try {
    return assertValidProjectId(raw.projectId);
  } catch (error) {
    throw bad(error.message);
  }
}

function date(raw, field) {
  const value = raw[field];
  if (value === undefined || value === null || value === '') throw bad(`${field} is required.`);
  const parsed = new Date(value);
  if (typeof value === 'boolean' || Number.isNaN(parsed.getTime())) throw bad(`${field} must be a valid date.`);
  return parsed;
}

export function validateSpan(raw) {
  if (!isObject(raw)) throw bad('span must be an object.');
  const projectId = projectIdOf(raw);
  const traceId = id(raw, 'traceId');
  const spanId = id(raw, 'spanId');
  const parentSpanId = id(raw, 'parentSpanId', { required: false }) ?? null;
  if (parentSpanId === spanId) throw bad('A span cannot be its own parent.');
  const serviceName = text(raw, 'serviceName', { max: MAX.name });
  const operation = text(raw, 'operation', { max: MAX.operation });
  // HTTP spans require method/route. Manual spans may omit them and are normalized
  // to INTERNAL + operation so they can use the existing Trace schema safely.
  const isManual = raw.method === undefined && raw.route === undefined;
  const method = isManual ? 'INTERNAL' : text(raw, 'method', { max: 16 });
  if (!/^[A-Za-z]+$/.test(method)) throw bad('method must be an HTTP method such as GET.');
  const route = isManual ? operation : text(raw, 'route', { max: MAX.route });
  const environment = text(raw, 'environment', { max: MAX.environment, required: false });
  if (!STATUSES.includes(raw.status)) throw bad('status must be success or error.');
  const startTime = date(raw, 'startTime');
  const endTime = date(raw, 'endTime');
  if (endTime < startTime) throw bad('endTime cannot be before startTime.');
  const duration = Number(raw.duration);
  if (raw.duration === undefined || raw.duration === null || raw.duration === '' || !Number.isFinite(duration) || duration < 0) throw bad('duration must be a non-negative number of milliseconds.');
  if (Math.abs(duration - (endTime - startTime)) > 1) throw bad(`duration (${duration}) does not match endTime - startTime (${endTime - startTime} ms).`);
  return { projectId, traceId, spanId, parentSpanId, serviceName, environment, operation, method: method.toUpperCase(), route, status: raw.status, startTime, endTime, duration };
}

export function validateError(raw) {
  if (!isObject(raw)) throw bad('error must be an object.');
  const projectId = projectIdOf(raw);
  const traceId = id(raw, 'traceId');
  const spanId = id(raw, 'spanId', { required: false }) ?? null;
  const serviceName = text(raw, 'serviceName', { max: MAX.name });
  const errorType = text(raw, 'errorType', { max: MAX.name });
  const message = text(raw, 'message');
  const stackTrace = typeof raw.stackTrace === 'string' && raw.stackTrace ? raw.stackTrace.slice(0, MAX.stack) : null;
  const timestamp = raw.timestamp === undefined || raw.timestamp === null ? new Date() : date(raw, 'timestamp');
  return { projectId, traceId, spanId, serviceName, errorType, message: message.slice(0, MAX.message), stackTrace, timestamp };
}

// ---------- persistence ----------
// Parents before children inside one batch (a child normally finishes - and is reported - before its parent).
function parentsFirst(items) {
  const bySpanId = new Map(items.map((item) => [item.span.spanId, item]));
  const depth = (item) => {
    let level = 0;
    let current = item;
    const seen = new Set();
    while (current.span.parentSpanId && bySpanId.has(current.span.parentSpanId) && !seen.has(current.span.spanId)) {
      seen.add(current.span.spanId);
      current = bySpanId.get(current.span.parentSpanId);
      level += 1;
    }
    return level;
  };
  return items.map((item) => ({ item, level: depth(item) })).sort((a, b) => a.level - b.level || a.item.index - b.item.index).map((entry) => entry.item);
}

async function persistSpan(span) {
  const existing = await Span.findOne({ spanId: span.spanId });
  if (existing) {
    // Retried delivery of the same span is idempotent; the same id in another trace/project is a conflict.
    if (existing.projectId === span.projectId && existing.traceId === span.traceId) return 'duplicate';
    throw bad('spanId is already used by a different trace or project.');
  }

  // A parent that is already stored must be in the same trace AND project. A parent that is not stored yet is
  // allowed: in distributed traces the child span is reported before its parent; the tree/service map link up
  // as soon as the parent arrives.
  if (span.parentSpanId) {
    const parent = await Span.findOne({ spanId: span.parentSpanId });
    if (parent && (parent.traceId !== span.traceId || parent.projectId !== span.projectId)) throw bad('parentSpanId belongs to a different trace or project.');
  }

  let trace = await Trace.findOne({ traceId: span.traceId });
  let createdTrace = false;
  if (trace && trace.projectId !== span.projectId) throw bad('traceId is not available for this project.');
  if (!trace) {
    try {
      trace = await startTrace({ projectId: span.projectId, traceId: span.traceId, rootService: span.serviceName, environment: span.environment, route: span.route, method: span.method, startTime: span.startTime, endTime: span.endTime, duration: span.duration, status: span.status });
      createdTrace = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      trace = await Trace.findOne({ traceId: span.traceId }); // created concurrently
      if (!trace || trace.projectId !== span.projectId) throw bad('traceId is not available for this project.');
    }
  }

  const serviceName = await ensureService(span.serviceName, span.projectId, span.environment);
  await Span.create({
    projectId: span.projectId, spanId: span.spanId, traceId: span.traceId, parentSpanId: span.parentSpanId, serviceName,
    operation: span.operation, duration: span.duration, status: span.status, startTime: span.startTime, endTime: span.endTime,
  });

  // The root span (no parent) defines the trace; a trace first created from an early-arriving child is corrected.
  const changes = {};
  if (!span.parentSpanId && !createdTrace && !(await Span.exists({ traceId: span.traceId, projectId: span.projectId, parentSpanId: null, spanId: { $ne: span.spanId } }))) {
    Object.assign(changes, { rootService: serviceName, route: span.route, method: span.method, duration: span.duration, timestamp: span.startTime });
  }
  if (span.status === 'error' && trace.status !== 'error') changes.status = 'error';
  if (Object.keys(changes).length) await Trace.updateOne({ traceId: span.traceId, projectId: span.projectId }, { $set: changes });
  return 'accepted';
}

async function persistError(error) {
  const trace = await Trace.findOne({ traceId: error.traceId });
  if (!trace || trace.projectId !== error.projectId) throw bad('trace not found in this project (send an error together with, or after, its span).');
  await recordError({ projectId: error.projectId, traceId: error.traceId, serviceName: error.serviceName, errorType: error.errorType, message: error.message, stackTrace: error.stackTrace, timestamp: error.timestamp });
}

/**
 * Ingest one batch. Returns a per-item summary; throws httpError only when the whole request is unusable.
 */
export async function ingestBatch(body) {
  if (!isObject(body)) throw httpError(400, 'Request body must be a JSON object with "spans" and/or "errors" arrays.');
  const spans = body.spans ?? [];
  const errors = body.errors ?? [];
  if (!Array.isArray(spans) || !Array.isArray(errors)) throw httpError(400, '"spans" and "errors" must be arrays.');
  if (!spans.length && !errors.length) throw httpError(400, 'The batch is empty.');
  if (spans.length + errors.length > MAX_BATCH_ITEMS) throw httpError(413, `A batch can contain at most ${MAX_BATCH_ITEMS} items.`);

  const result = { received: { spans: spans.length, errors: errors.length }, accepted: { spans: 0, errors: 0 }, duplicates: 0, rejected: [] };
  const reject = (type, index, itemId, error) => {
    if (!error.itemError) throw error;
    result.rejected.push({ type, index, id: typeof itemId === 'string' ? itemId : null, reason: error.message });
  };

  const valid = [];
  spans.forEach((raw, index) => {
    try { valid.push({ index, span: validateSpan(raw) }); } catch (error) { reject('span', index, raw?.spanId, error); }
  });
  for (const { index, span } of parentsFirst(valid)) {
    try {
      if ((await persistSpan(span)) === 'duplicate') result.duplicates += 1;
      else result.accepted.spans += 1;
    } catch (error) { reject('span', index, span.spanId, error); }
  }

  // Errors after spans, so an error sent in the same batch as its span always finds its trace.
  for (const [index, raw] of errors.entries()) {
    try {
      await persistError(validateError(raw));
      result.accepted.errors += 1;
    } catch (error) { reject('error', index, raw?.traceId, error); }
  }
  return result;
}

/** 200 = everything stored/duplicate, 207 = partly rejected, 422 = nothing usable. */
export function httpStatusFor(result) {
  if (!result.rejected.length) return 200;
  return result.accepted.spans + result.accepted.errors + result.duplicates > 0 ? 207 : 422;
}
