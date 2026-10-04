import Trace from '../models/Trace.js';
import Span from '../models/Span.js';
import ErrorRecord from '../models/Error.js';
import * as tracingService from './tracingService.js';
import { resolveProjectId } from '../utils/projectScope.js';

function positiveInteger(value, fallback, maximum = 100) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('Pagination values must be positive integers.');
    error.statusCode = 400;
    throw error;
  }
  return Math.min(parsed, maximum);
}

function traceFilter(query) {
  const filter = { projectId: resolveProjectId(query.projectId) };
  if (query.status) {
    if (!['success', 'error'].includes(query.status)) {
      const error = new Error('status must be success or error.');
      error.statusCode = 400;
      throw error;
    }
    filter.status = query.status;
  }
  if (query.service) filter.rootService = query.service.toLowerCase();
  if (query.minDuration || query.maxDuration) {
    filter.duration = {};
    if (query.minDuration !== undefined) filter.duration.$gte = Number(query.minDuration);
    if (query.maxDuration !== undefined) filter.duration.$lte = Number(query.maxDuration);
    if (Object.values(filter.duration).some((value) => !Number.isFinite(value))) {
      const error = new Error('Duration filters must be valid numbers.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (query.search) {
    const search = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { traceId: { $regex: search, $options: 'i' } },
      { route: { $regex: search, $options: 'i' } },
      { rootService: { $regex: search, $options: 'i' } },
    ];
  }
  return filter;
}

export async function getAllTraces(query = {}) {
  const page = positiveInteger(query.page, 1, 100000);
  const limit = positiveInteger(query.limit, 20);
  const filter = traceFilter(query);
  const [data, total] = await Promise.all([
    Trace.find(filter).sort({ timestamp: -1, duration: -1 }).skip((page - 1) * limit).limit(limit),
    Trace.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getTrace(traceId, query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const trace = await Trace.findOne({ traceId, projectId });
  if (!trace) {
    const error = new Error('Trace not found.');
    error.statusCode = 404;
    throw error;
  }
  const spans = await Span.find({ traceId, projectId }).sort({ startTime: 1 });
  return { trace, spans };
}

export function addTrace(data) {
  return tracingService.startTrace(data);
}

export function completeTrace(traceId, data) {
  return tracingService.completeTrace(traceId, data);
}

export function getTraceTree(traceId, query = {}) {
  return tracingService.getTraceTree(traceId, query);
}

export async function removeTrace(traceId, query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const trace = await Trace.findOneAndDelete({ traceId, projectId });
  if (!trace) {
    const error = new Error('Trace not found.');
    error.statusCode = 404;
    throw error;
  }
  await Promise.all([
    Span.deleteMany({ traceId, projectId }),
    ErrorRecord.deleteMany({ traceId, projectId }),
  ]);
}
