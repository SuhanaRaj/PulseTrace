import Span from '../models/Span.js';
import Trace from '../models/Trace.js';
import { resolveProjectId } from '../utils/projectScope.js';

function percentile(values, percentage) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.ceil((percentage / 100) * values.length) - 1)];
}

function latencySummary(durations) {
  const sorted = durations.slice().sort((a, b) => a - b);
  const averageLatency = sorted.length
    ? Math.round(sorted.reduce((total, duration) => total + duration, 0) / sorted.length)
    : 0;
  return { averageLatency, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
}

export async function getPerformance(query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const [traces, spans] = await Promise.all([Trace.find({ projectId }).select('rootService route method duration'), Span.find({ projectId }).select('serviceName operation duration')]);
  const serviceGroups = new Map();
  const endpointGroups = new Map();
  spans.forEach((span) => {
    const group = serviceGroups.get(span.serviceName) || [];
    group.push(span.duration);
    serviceGroups.set(span.serviceName, group);
  });
  traces.forEach((trace) => {
    const key = `${trace.method} ${trace.route}`;
    const group = endpointGroups.get(key) || { serviceName: trace.rootService, durations: [] };
    group.durations.push(trace.duration);
    endpointGroups.set(key, group);
  });
  const slowestServices = [...serviceGroups.entries()]
    .map(([serviceName, durations]) => ({ serviceName, ...latencySummary(durations), requestCount: durations.length }))
    .sort((a, b) => b.averageLatency - a.averageLatency)
    .slice(0, 5);
  const slowestEndpoints = [...endpointGroups.entries()]
    .map(([operation, value]) => ({ operation, serviceName: value.serviceName, ...latencySummary(value.durations), requestCount: value.durations.length }))
    .sort((a, b) => b.averageLatency - a.averageLatency)
    .slice(0, 5);
  return { ...latencySummary(traces.map((trace) => trace.duration)), slowestServices, slowestEndpoints };
}

export async function getServicePerformance(serviceName, query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const [traces, spans] = await Promise.all([
    Trace.find({ projectId, rootService: serviceName.toLowerCase() }).select('duration'),
    Span.find({ projectId, serviceName: serviceName.toLowerCase() }).select('duration operation'),
  ]);
  if (!traces.length && !spans.length) {
    const error = new Error('Service performance data not found.');
    error.statusCode = 404;
    throw error;
  }
  return { serviceName: serviceName.toLowerCase(), ...latencySummary((spans.length ? spans : traces).map((item) => item.duration)), traceCount: traces.length, spanCount: spans.length };
}
