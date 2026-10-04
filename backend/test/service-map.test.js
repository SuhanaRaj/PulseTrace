// Service map dependency generation (pure function, no database).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/config/env.js', { defaultExport: { nodeEnv: 'test' } });
mock.module('../src/models/Service.js', { defaultExport: {} });
mock.module('../src/models/Span.js', { defaultExport: {} });
const { buildServiceMap } = await import('../src/services/serviceMapService.js');

const svc = (name, status = 'healthy') => ({ name, status, environment: 'production' });
const span = (spanId, serviceName, parentSpanId, duration, status = 'success', traceId = 'tr_1') => ({ spanId, traceId, serviceName, parentSpanId, duration, status });
const services = ['api-gateway', 'auth-service', 'mission-service', 'database', 'notification-service'].map((n) => svc(n));

test('chain gateway -> auth -> mission -> database yields exactly 3 edges', () => {
  const spans = [
    span('s1', 'api-gateway', null, 245), span('s2', 'auth-service', 's1', 35),
    span('s3', 'mission-service', 's2', 120), span('s4', 'database', 's3', 80),
  ];
  const { nodes, edges } = buildServiceMap(services, spans);
  assert.deepEqual(edges.map((e) => [e.id, e.source, e.target]), [
    ['api-gateway-auth-service', 'api-gateway', 'auth-service'],
    ['auth-service-mission-service', 'auth-service', 'mission-service'],
    ['mission-service-database', 'mission-service', 'database'],
  ]);
  assert.equal(nodes.length, 5);
  assert.deepEqual(nodes[0], { id: 'api-gateway', data: { label: 'api-gateway', status: 'healthy', environment: 'production', requestCount: 1, errorCount: 0, averageLatency: 245 } });
});

test('service with no parent/children is a node with no edges', () => {
  const { nodes, edges } = buildServiceMap(services, [span('s1', 'api-gateway', null, 10), span('n1', 'notification-service', null, 74)]);
  assert.equal(edges.length, 0);
  assert.ok(nodes.some((n) => n.id === 'notification-service' && n.data.requestCount === 1));
});

test('multiple spans between the same services are aggregated into one edge', () => {
  const spans = [
    span('a1', 'api-gateway', null, 126, 'success', 'tr_a'), span('a2', 'auth-service', 'a1', 72, 'success', 'tr_a'),
    span('b1', 'api-gateway', null, 742, 'error', 'tr_b'), span('b2', 'auth-service', 'b1', 83, 'success', 'tr_b'),
    span('c1', 'api-gateway', null, 50, 'error', 'tr_c'), span('c2', 'auth-service', 'c1', 100, 'error', 'tr_c'),
  ];
  const { edges } = buildServiceMap(services, spans);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0].data, { requestCount: 3, errorCount: 1, errorRate: 33.33, averageLatency: 85 });
});

test('same-service parent/child is not a dependency; unknown parent is ignored', () => {
  const spans = [span('m1', 'mission-service', null, 50), span('m2', 'mission-service', 'm1', 20), span('x1', 'database', 'ghost', 5)];
  assert.equal(buildServiceMap(services, spans).edges.length, 0);
});

test('service names containing ":" or "-" do not break edge ids/endpoints', () => {
  const { edges } = buildServiceMap([svc('a:b'), svc('c-d')], [span('p', 'a:b', null, 1), span('q', 'c-d', 'p', 1)]);
  assert.deepEqual([edges[0].source, edges[0].target], ['a:b', 'c-d']);
});

test('span service missing from the services collection still gets a node', () => {
  const { nodes, edges } = buildServiceMap([svc('api-gateway')], [span('p', 'api-gateway', null, 1), span('q', 'ghost-service', 'p', 1)]);
  assert.equal(edges[0].target, 'ghost-service');
  assert.equal(nodes.find((n) => n.id === 'ghost-service').data.status, 'unknown');
});

test('empty database', () => {
  assert.deepEqual(buildServiceMap([], []), { nodes: [], edges: [] });
});
