// Run: npm run test:adapters  (plain Node, no browser/bundler needed)
import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptActivity, adaptServiceMap, adaptServices, adaptTraceTree, bucketTimestamps, bucketTraces, durationHistogram, groupErrors, layoutNodes, prettyName } from './adapters.js'
import { timeAgo } from '../utils/formatters.js'

const T0 = Date.parse('2026-10-03T10:00:00.000Z')
const iso = ms => new Date(T0 + ms).toISOString()

test('prettyName', () => {
  assert.equal(prettyName('api-gateway'), 'API Gateway')
  assert.equal(prettyName('mission-service'), 'Mission Service')
  assert.equal(prettyName('database'), 'Database')
})

test('trace tree is flattened depth-first with offsets relative to the first span', () => {
  const span = (spanId, parent, svc, start, duration, children = [], status = 'success') => ({ spanId, traceId: 'tr_1', parentSpanId: parent, serviceName: svc, operation: `op ${spanId}`, startTime: iso(start), endTime: iso(start + duration), duration, status, children })
  const tree = { trace: { traceId: 'tr_1', rootService: 'api-gateway', route: '/api/missions', method: 'GET', duration: 100, status: 'success', timestamp: iso(0) },
    spans: [span('a', null, 'api-gateway', 0, 100, [span('b', 'a', 'auth-service', 10, 30), span('c', 'a', 'mission-service', 45, 50, [span('d', 'c', 'database', 50, 40, [], 'error')])])] }
  const v = adaptTraceTree(tree)
  assert.deepEqual(v.spans.map(s => [s.id, s.depth, s.start, s.duration]), [['a', 0, 0, 100], ['b', 1, 10, 30], ['c', 1, 45, 50], ['d', 2, 50, 40]])
  assert.equal(v.spans[3].status, 'error')
  assert.equal(v.total, 100)
  assert.deepEqual(v.ticks, [0, 25, 50, 75, 100])
  assert.equal(v.trace.id, 'tr_1')
  assert.equal(v.spans[1].service, 'Auth Service')
})

test('trace tree with no spans does not crash', () => {
  const v = adaptTraceTree({ trace: { traceId: 'tr_x', rootService: 'a', route: '/', method: 'GET', duration: 5, status: 'success', timestamp: iso(0) }, spans: [] })
  assert.equal(v.spans.length, 0)
  assert.equal(v.total, 1)
})

test('service map: backend nodes/edges -> React Flow nodes/edges, layered left to right', () => {
  const data = {
    nodes: ['api-gateway', 'auth-service', 'mission-service', 'database', 'lonely'].map(id => ({ id, data: { label: id, status: id === 'database' ? 'down' : 'healthy', environment: 'production', requestCount: 4, errorCount: 1, averageLatency: 80 } })),
    edges: [
      { id: 'api-gateway-auth-service', source: 'api-gateway', target: 'auth-service', data: { requestCount: 2, errorCount: 0, errorRate: 0, averageLatency: 78 } },
      { id: 'auth-service-mission-service', source: 'auth-service', target: 'mission-service', data: { requestCount: 2, errorCount: 1, errorRate: 50, averageLatency: 120 } },
      { id: 'mission-service-database', source: 'mission-service', target: 'database', data: { requestCount: 2, errorCount: 0, errorRate: 0, averageLatency: 40 } },
      { id: 'dangling', source: 'ghost', target: 'database' },
    ],
  }
  const g = adaptServiceMap(data)
  const x = id => g.nodes.find(n => n.id === id).position.x
  assert.ok(x('api-gateway') < x('auth-service') && x('auth-service') < x('mission-service') && x('mission-service') < x('database'))
  assert.equal(x('lonely'), x('api-gateway'))
  assert.deepEqual(g.edges.map(e => [e.source, e.target]), [['api-gateway', 'auth-service'], ['auth-service', 'mission-service'], ['mission-service', 'database']])
  assert.equal(g.edges[1].label, '2 req · 120ms · 1 err')
  const db = g.nodes.find(n => n.id === 'database').data.service
  assert.deepEqual([db.name, db.health, db.requests, db.errorPct], ['Database', 'failing', 4, 25])
  assert.equal(g.nodes.every(n => n.type === 'service' && Number.isFinite(n.position.x) && Number.isFinite(n.position.y)), true)
})

test('service map layout terminates on cycles and handles empty input', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }]
  const pos = layoutNodes(nodes, [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }])
  assert.equal(pos.size, 2)
  assert.deepEqual(adaptServiceMap({ nodes: [], edges: [] }), { nodes: [], edges: [] })
  assert.deepEqual(adaptServiceMap(), { nodes: [], edges: [] })
})

test('services: identity from /api/services, numbers from span-based service map + performance', () => {
  const out = adaptServices(
    [{ name: 'api-gateway', environment: 'production', status: 'healthy' }, { name: 'database', environment: 'production', status: 'down' }, { name: 'idle', environment: 'dev', status: 'healthy' }],
    [{ id: 'api-gateway', data: { requestCount: 10, errorCount: 2, averageLatency: 50 } }, { id: 'database', data: { requestCount: 5, errorCount: 0, averageLatency: 9 } }],
    [{ serviceName: 'api-gateway', p95: 120 }],
  )
  assert.deepEqual(out.map(s => [s.name, s.health, s.requests, s.errorPct, s.latency, s.p95]), [['API Gateway', 'healthy', 10, 20, 50, 120], ['Database', 'failing', 5, 0, 9, null], ['Idle', 'healthy', 0, 0, 0, null]])
})

test('errors: identical records are grouped, newest first, count uses occurrenceCount', () => {
  const rec = (id, svc, type, message, offset, extra = {}) => ({ id, serviceName: svc, errorType: type, message, timestamp: iso(offset), traceId: `tr_${id}`, occurrenceCount: 3, ...extra })
  const groups = groupErrors([rec('1', 'db', 'Timeout', 'timed out', 0), rec('2', 'db', 'Timeout', 'timed out', 60000, { stackTrace: 'at x' }), rec('3', 'api', 'HTTP 404', 'GET /x responded with 404', 30000, { occurrenceCount: 1 })], T0 + 120000)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map(g => [g.title, g.count, g.traceId]), [['timed out', 3, 'tr_2'], ['GET /x responded with 404', 1, 'tr_3']])
  assert.equal(groups[0].stack, 'at x')
  assert.equal(groups[0].last, '1 min ago')
})

test('bucketTraces: counts, errors and average latency per bucket; out-of-range traces ignored', () => {
  const now = T0 + 60 * 60 * 1000
  const traces = [{ timestamp: iso(5 * 60 * 1000), status: 'success', duration: 100 }, { timestamp: iso(6 * 60 * 1000), status: 'error', duration: 300 }, { timestamp: iso(-3600 * 1000 * 5), status: 'success', duration: 1 }]
  const b = bucketTraces(traces, 3600 * 1000, 12, now)
  assert.equal(b.length, 12)
  assert.deepEqual([b[1].requests, b[1].errors, b[1].latency], [2, 1, 200])
  assert.equal(b.reduce((n, x) => n + x.requests, 0), 2)
  assert.equal(b[0].latency, null)
})

test('bucketTimestamps / durationHistogram: empty, single and spread inputs', () => {
  assert.deepEqual(bucketTimestamps([]), [])
  assert.equal(bucketTimestamps([iso(0)]).length, 1)
  const b = bucketTimestamps([iso(0), iso(1000), iso(60000)], 6)
  assert.equal(b.reduce((n, x) => n + x.errors, 0), 3)
  assert.deepEqual(durationHistogram([]), [])
  const h = durationHistogram([10, 20, 30, 250, 245], 5)
  assert.equal(h.reduce((n, x) => n + x.count, 0), 5)
  assert.equal(h.length, 5)
})

test('activity feed merges traces and errors, newest first, max 4', () => {
  const traces = [1, 2, 3].map(i => ({ timestamp: iso(i * 1000), status: i === 2 ? 'error' : 'success', method: 'GET', route: `/r${i}`, duration: 10 * i }))
  const errors = [{ timestamp: iso(5000), message: 'boom', serviceName: 'database' }, { timestamp: iso(500), message: 'old', serviceName: 'a' }]
  const a = adaptActivity(traces, errors, T0 + 10000)
  assert.equal(a.length, 4)
  assert.equal(a[0].detail, 'boom • Database')
  assert.equal(a[0].kind, 'error')
})

test('timeAgo', () => {
  assert.equal(timeAgo(iso(0), T0 + 10_000), 'just now')
  assert.equal(timeAgo(iso(0), T0 + 5 * 60_000), '5 min ago')
  assert.equal(timeAgo(iso(0), T0 + 3 * 3600_000), '3h ago')
  assert.equal(timeAgo(iso(0), T0 + 2 * 86400_000), '2d ago')
  assert.equal(timeAgo('not a date'), '—')
})

test('an empty project (e.g. API Suite before it is connected) adapts to empty views, no fake data', () => {
  assert.deepEqual(adaptServiceMap({ nodes: [], edges: [] }), { nodes: [], edges: [] })
  assert.deepEqual(adaptServices([], [], []), [])
  assert.deepEqual(groupErrors([]), [])
  assert.deepEqual(adaptActivity([], []), [])
  assert.deepEqual(durationHistogram([]), [])
  assert.deepEqual(bucketTimestamps([]), [])
  const series = bucketTraces([], 3600 * 1000, 12)
  assert.equal(series.reduce((n, b) => n + b.requests + b.errors, 0), 0)
  assert.ok(series.every(b => b.latency === null))
})
