import Service from '../models/Service.js';
import Span from '../models/Span.js';
import { resolveProjectId } from '../utils/projectScope.js';

const average = (values) => (values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0);
const rate = (part, total) => (total ? Number(((part / total) * 100).toFixed(2)) : 0);

/**
 * Pure function: derive the dependency graph from services + spans.
 * An edge A -> B exists when a span of service B has a parent span of service A.
 * Same-service parent/child pairs are not dependencies and are ignored.
 * Existing fields (nodes[].id/data.label/status/environment, edges[].id/source/target) are unchanged;
 * metrics are additive: edge.data and node.data.{requestCount,errorCount,averageLatency}.
 * Edge latency = duration of the callee (child) spans.
 */
export function buildServiceMap(services, spans) {
  const spansById = new Map(spans.map((span) => [span.spanId, span]));

  const edgeGroups = new Map();
  spans.forEach((span) => {
    const parent = span.parentSpanId ? spansById.get(span.parentSpanId) : null;
    if (!parent || parent.serviceName === span.serviceName) return;
    const id = `${parent.serviceName}-${span.serviceName}`;
    const group = edgeGroups.get(id) || { id, source: parent.serviceName, target: span.serviceName, durations: [], errorCount: 0 };
    group.durations.push(span.duration);
    if (span.status === 'error') group.errorCount += 1;
    edgeGroups.set(id, group);
  });

  const spanGroups = new Map();
  spans.forEach((span) => {
    const group = spanGroups.get(span.serviceName) || { durations: [], errorCount: 0 };
    group.durations.push(span.duration);
    if (span.status === 'error') group.errorCount += 1;
    spanGroups.set(span.serviceName, group);
  });

  const nodes = services.map((service) => ({
    id: service.name,
    data: { label: service.name, status: service.status, environment: service.environment },
  }));
  // A service that has spans/edges but no Service document (e.g. it was deleted) still needs a node.
  const known = new Set(nodes.map((node) => node.id));
  [...spanGroups.keys()].sort().forEach((name) => {
    if (!known.has(name)) {
      known.add(name);
      nodes.push({ id: name, data: { label: name, status: 'unknown', environment: null } });
    }
  });
  nodes.forEach((node) => {
    const group = spanGroups.get(node.id) || { durations: [], errorCount: 0 };
    Object.assign(node.data, { requestCount: group.durations.length, errorCount: group.errorCount, averageLatency: average(group.durations) });
  });

  const edges = [...edgeGroups.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((group) => ({
      id: group.id,
      source: group.source,
      target: group.target,
      data: {
        requestCount: group.durations.length,
        errorCount: group.errorCount,
        errorRate: rate(group.errorCount, group.durations.length),
        averageLatency: average(group.durations),
      },
    }));

  return { nodes, edges };
}

export async function getServiceMap(query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const [services, spans] = await Promise.all([
    Service.find({ projectId }),
    Span.find({ projectId }).select('spanId parentSpanId serviceName duration status'),
  ]);
  return buildServiceMap(services, spans);
}
