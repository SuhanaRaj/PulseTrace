import Span from '../models/Span.js';
import * as tracingService from './tracingService.js';
import { resolveProjectId } from '../utils/projectScope.js';

export function getTraceSpans(traceId, query = {}) {
  return Span.find({ traceId, projectId: resolveProjectId(query.projectId) }).sort({ startTime: 1 });
}

export function addSpan(data) {
  return tracingService.recordSpan(data);
}

export function closeSpan(spanId, data = {}) {
  return tracingService.finishSpan(spanId, data);
}
