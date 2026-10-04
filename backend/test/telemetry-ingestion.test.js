// POST /api/telemetry/batch: contract validation, persistence into the EXISTING collections, project isolation,
// idempotency, out-of-order delivery, status codes, and loop prevention. In-memory fake models, no MongoDB.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './helpers/fakeMongo.js'

const db = createFakeDb()
const env = { nodeEnv: 'test' }
mock.module('../src/config/env.js', { defaultExport: env })
mock.module('../src/config/database.js', { namedExports: { isDatabaseConnected: () => true } })
mock.module('../src/models/Trace.js', { defaultExport: db.models.Trace })
mock.module('../src/models/Span.js', { defaultExport: db.models.Span })
mock.module('../src/models/Service.js', { defaultExport: db.models.Service })
mock.module('../src/models/Error.js', { defaultExport: db.models.Error })

const { ingestBatch, httpStatusFor, validateSpan, validateError, MAX_BATCH_ITEMS } = await import('../src/services/telemetryService.js')
const { ingestBatch: controller } = await import('../src/controllers/telemetryController.js')
const { getAllTraces, getTrace } = await import('../src/services/traceService.js')
const { getAllErrors } = await import('../src/services/errorService.js')
const { getServices } = await import('../src/services/serviceService.js')
const { getPerformance } = await import('../src/services/performanceService.js')
const { getServiceMap } = await import('../src/services/serviceMapService.js')
const { getTraceTree } = await import('../src/services/tracingService.js')
const { DEFAULT_TRACE_IGNORE_PATHS } = await import('../src/config/traceIgnore.js')
const { createTracingMiddleware } = await import('../src/middleware/tracingMiddleware.js')

const T0 = Date.parse('2026-10-04T10:00:00.000Z')
const iso = (ms) => new Date(T0 + ms).toISOString()
let n = 0
const span = (over = {}) => {
  n += 1
  const start = over.start ?? 0
  const duration = over.duration ?? 50
  const { start: _s, ...rest } = over
  return { projectId: 'api-suite', traceId: 'tr_a', spanId: `sp_${n}`, parentSpanId: null, serviceName: 'api-suite', environment: 'development', operation: 'GET /orders', method: 'GET', route: '/orders', status: 'success', startTime: iso(start), endTime: 'endTime' in rest ? rest.endTime : iso(start + Number(duration)), duration, ...rest }
}
const err = (over = {}) => ({ projectId: 'api-suite', traceId: 'tr_a', spanId: 'sp_x', serviceName: 'api-suite', errorType: 'HTTP 500', message: 'GET /orders responded with 500', stackTrace: 'Error: boom\n at x', timestamp: iso(60), ...over })
const fresh = () => { db.reset(); env.requireProjectId = false; env.projectId = undefined }
const reasonOf = (r, i = 0) => r.rejected[i]?.reason

test('contract: a valid SDK-style span + error is accepted and stored in the existing collections', async () => {
  fresh()
  const s = span({ spanId: 'sp_root', status: 'error', duration: 120 })
  const r = await ingestBatch({ spans: [s], errors: [err({ spanId: 'sp_root' })] })
  assert.deepEqual(r, { received: { spans: 1, errors: 1 }, accepted: { spans: 1, errors: 1 }, duplicates: 0, rejected: [] })
  const [trace] = db.store.traces, [stored] = db.store.spans, [error] = db.store.errors, [service] = db.store.services
  assert.deepEqual([trace.projectId, trace.traceId, trace.rootService, trace.route, trace.method, trace.duration, trace.status], ['api-suite', 'tr_a', 'api-suite', '/orders', 'GET', 120, 'error'])
  assert.equal(trace.timestamp.toISOString(), s.startTime)
  assert.deepEqual([stored.projectId, stored.spanId, stored.traceId, stored.parentSpanId, stored.serviceName, stored.operation, stored.duration, stored.status], ['api-suite', 'sp_root', 'tr_a', null, 'api-suite', 'GET /orders', 120, 'error'])
  assert.equal(stored.startTime.toISOString(), s.startTime)
  assert.deepEqual([error.projectId, error.traceId, error.serviceName, error.errorType, error.message, error.stackTrace], ['api-suite', 'tr_a', 'api-suite', 'HTTP 500', 'GET /orders responded with 500', 'Error: boom\n at x'])
  assert.deepEqual([service.projectId, service.name, service.environment], ['api-suite', 'api-suite', 'development']) // environment lands on the Service
})

test('serviceName is normalized (lower-case) and environment is stored per service', async () => {
  fresh()
  await ingestBatch({ spans: [span({ serviceName: 'Orders-API', environment: 'Staging' })] })
  assert.deepEqual([db.store.spans[0].serviceName, db.store.services[0].name, db.store.services[0].environment], ['orders-api', 'orders-api', 'staging'])
})

test('projectId is mandatory and validated on every span and error; it is never inferred', async () => {
  fresh()
  const noProject = span(); delete noProject.projectId
  const r = await ingestBatch({ spans: [noProject, span({ projectId: 'nope' }), span({ projectId: 'API-SUITE' }), span({ projectId: ['api-suite'] }), span({ projectId: '' })], errors: [err({ projectId: undefined }), err({ projectId: 'ghost' })] })
  assert.equal(r.accepted.spans + r.accepted.errors, 0)
  assert.equal(r.rejected.length, 7)
  assert.match(reasonOf(r, 0), /projectId is required/)
  assert.match(reasonOf(r, 1), /Invalid projectId.*pulsetrace, api-suite/)
  assert.deepEqual(db.store, { traces: [], spans: [], errors: [], services: [] }, 'nothing stored')
  // serviceName that LOOKS like a project does not decide it; env.projectId (the server's own project) is not a fallback either
  env.projectId = 'pulsetrace'
  const r2 = await ingestBatch({ spans: [(() => { const s = span({ serviceName: 'pulsetrace-backend' }); delete s.projectId; return s })()] })
  assert.match(reasonOf(r2), /projectId is required/)
  assert.equal(db.store.spans.length, 0)
})

test('every required span field is enforced with a clear reason', async () => {
  fresh()
  const cases = [
    ['traceId', /traceId is required/], ['spanId', /spanId is required/], ['serviceName', /serviceName is required/], ['operation', /operation is required/],
    ['method', /method is required/], ['route', /route is required/], ['status', /status must be success or error/], ['startTime', /startTime is required/], ['endTime', /endTime is required/], ['duration', /duration must be/],
  ]
  for (const [field, pattern] of cases) {
    const s = span(); delete s[field]
    assert.match(reasonOf(await ingestBatch({ spans: [s] })), pattern, field)
  }
  const bad = [
    [{ status: 'ok' }, /status must be/], [{ duration: -5, endTime: iso(50) }, /duration must be/], [{ duration: 'fast', endTime: iso(50) }, /duration must be/], [{ startTime: 'yesterday' }, /startTime must be a valid date/],
    [{ endTime: iso(-100) }, /endTime cannot be before startTime/], [{ duration: 999, endTime: iso(50) }, /does not match endTime - startTime/], [{ traceId: 'has space' }, /traceId must match/], [{ spanId: 'x'.repeat(65) }, /spanId must match/],
    [{ method: 'G3T' }, /method must be an HTTP method/], [{ serviceName: 'x'.repeat(129) }, /at most 128/], [{ parentSpanId: 7 }, /parentSpanId must be a non-empty string/],
  ]
  for (const [over, pattern] of bad) assert.match(reasonOf(await ingestBatch({ spans: [span(over)] })), pattern, JSON.stringify(over))
  assert.match(reasonOf(await ingestBatch({ spans: [span({ spanId: 'sp_self', parentSpanId: 'sp_self' })] })), /own parent/)
  assert.match(reasonOf(await ingestBatch({ spans: ['text', null, 5, []] })), /span must be an object/)
  assert.equal(db.store.spans.length, 0)
})

test('error items: required fields, defaults and truncation', async () => {
  fresh()
  for (const [field, pattern] of [['traceId', /traceId is required/], ['serviceName', /serviceName is required/], ['errorType', /errorType is required/], ['message', /message is required/]]) {
    const e = err(); delete e[field]
    assert.match(reasonOf(await ingestBatch({ errors: [e] })), pattern, field)
  }
  const v = validateError({ projectId: 'api-suite', traceId: 'tr_a', serviceName: 's', errorType: 'E', message: 'm'.repeat(5000), stackTrace: 's'.repeat(30000) })
  assert.equal(v.message.length, 4000)
  assert.equal(v.stackTrace.length, 20000)
  assert.equal(v.spanId, null)
  assert.ok(v.timestamp instanceof Date)
  assert.ok(validateSpan(span()).startTime instanceof Date)
})

test('an error needs its trace in the same project; an error sent with its span finds it', async () => {
  fresh()
  const orphan = await ingestBatch({ errors: [err({ traceId: 'tr_unknown' })] })
  assert.match(reasonOf(orphan), /trace not found in this project/)
  const together = await ingestBatch({ errors: [err()], spans: [span()] }) // errors listed first, spans are still processed first
  assert.deepEqual(together.accepted, { spans: 1, errors: 1 })
  await ingestBatch({ spans: [span({ projectId: 'pulsetrace', traceId: 'tr_p', serviceName: 'pulsetrace-backend' })] })
  const cross = await ingestBatch({ errors: [err({ traceId: 'tr_p' })] }) // api-suite error pointing at a pulsetrace trace
  assert.match(reasonOf(cross), /trace not found in this project/)
  assert.equal(db.store.errors.length, 1)
})

test('parent-child: parentSpanId is stored and the tree nests the child under its parent', async () => {
  fresh()
  const root = span({ spanId: 'sp_001', start: 0, duration: 100 })
  const child = span({ spanId: 'sp_002', parentSpanId: 'sp_001', serviceName: 'auth-service', operation: 'GET /verify', route: '/verify', start: 10, duration: 30 })
  const r = await ingestBatch({ spans: [root, child] })
  assert.equal(r.accepted.spans, 2)
  const tree = await getTraceTree('tr_a', { projectId: 'api-suite' })
  assert.deepEqual(tree.spans.map((s) => [s.spanId, s.children.map((c) => [c.spanId, c.parentSpanId])]), [['sp_001', [['sp_002', 'sp_001']]]])
  const map = await getServiceMap({ projectId: 'api-suite' })
  assert.deepEqual(map.edges.map((e) => [e.source, e.target]), [['api-suite', 'auth-service']])
})

test('out-of-order delivery: child first (batch order and separate batches) still links up, and the root defines the trace', async () => {
  fresh()
  const root = span({ traceId: 'tr_o', spanId: 'sp_r', serviceName: 'gateway', route: '/entry', operation: 'GET /entry', start: 0, duration: 200, status: 'success' })
  const mid = span({ traceId: 'tr_o', spanId: 'sp_m', parentSpanId: 'sp_r', serviceName: 'orders', route: '/orders', start: 10, duration: 150, status: 'error' })
  const leaf = span({ traceId: 'tr_o', spanId: 'sp_l', parentSpanId: 'sp_m', serviceName: 'db', route: '/q', start: 20, duration: 100 })
  // same batch, reversed
  assert.equal((await ingestBatch({ spans: [leaf, mid, root] })).accepted.spans, 3)
  const tree = await getTraceTree('tr_o', { projectId: 'api-suite' })
  assert.deepEqual(tree.spans.map((s) => s.spanId), ['sp_r'])
  assert.deepEqual(tree.spans[0].children[0].children.map((s) => s.spanId), ['sp_l'])

  // separate batches: the child arrives long before its parent (parent not stored yet)
  fresh()
  assert.equal((await ingestBatch({ spans: [leaf] })).accepted.spans, 1)
  assert.equal(db.store.traces[0].rootService, 'db', 'provisional root until the real root arrives')
  assert.equal((await ingestBatch({ spans: [mid] })).accepted.spans, 1)
  assert.equal((await ingestBatch({ spans: [root] })).accepted.spans, 1)
  const [trace] = db.store.traces
  assert.deepEqual([db.store.traces.length, trace.rootService, trace.route, trace.method, trace.duration, trace.status], [1, 'gateway', '/entry', 'GET', 200, 'error'])
  assert.equal(trace.timestamp.toISOString(), root.startTime)
  const tree2 = await getTraceTree('tr_o', { projectId: 'api-suite' })
  assert.deepEqual([tree2.spans.length, tree2.spans[0].spanId, tree2.spans[0].children[0].spanId], [1, 'sp_r', 'sp_m'])
})

test('a stored parent from a different trace or project is rejected', async () => {
  fresh()
  await ingestBatch({ spans: [span({ traceId: 'tr_1', spanId: 'sp_a' }), span({ projectId: 'pulsetrace', traceId: 'tr_p', spanId: 'sp_p', serviceName: 'pulsetrace-backend' })] })
  const wrongTrace = await ingestBatch({ spans: [span({ traceId: 'tr_2', spanId: 'sp_b', parentSpanId: 'sp_a' })] })
  assert.match(reasonOf(wrongTrace), /different trace or project/)
  const wrongProject = await ingestBatch({ spans: [span({ traceId: 'tr_p', spanId: 'sp_c', parentSpanId: 'sp_p' })] }) // api-suite span claiming a pulsetrace parent
  assert.match(reasonOf(wrongProject), /different trace or project|not available for this project/)
  assert.deepEqual(db.store.spans.map((s) => s.spanId).sort(), ['sp_a', 'sp_p'])
})

test('project isolation: a traceId or spanId owned by another project cannot be written to or overwritten', async () => {
  fresh()
  await ingestBatch({ spans: [span({ projectId: 'pulsetrace', traceId: 'tr_shared', spanId: 'sp_shared', serviceName: 'pulsetrace-backend' })] })
  const hijackTrace = await ingestBatch({ spans: [span({ traceId: 'tr_shared', spanId: 'sp_new' })] })
  assert.match(reasonOf(hijackTrace), /traceId is not available for this project/)
  const hijackSpan = await ingestBatch({ spans: [span({ traceId: 'tr_other', spanId: 'sp_shared' })] })
  assert.match(reasonOf(hijackSpan), /spanId is already used/)
  assert.equal(db.store.spans.length, 1)
  assert.equal(db.store.traces.length, 1)
  assert.equal(db.store.traces[0].projectId, 'pulsetrace')
  assert.equal(db.store.spans[0].projectId, 'pulsetrace')
})

test('project isolation end to end: each project\'s dashboard queries see only its own telemetry (same service name allowed)', async () => {
  fresh()
  await ingestBatch({
    spans: [
      span({ projectId: 'pulsetrace', traceId: 'tr_p', spanId: 'sp_p1', serviceName: 'pulsetrace-backend', route: '/x', operation: 'GET /x', duration: 10 }),
      span({ projectId: 'pulsetrace', traceId: 'tr_p', spanId: 'sp_p2', parentSpanId: 'sp_p1', serviceName: 'database', route: '/q', duration: 4, start: 1 }),
      span({ projectId: 'api-suite', traceId: 'tr_a', spanId: 'sp_a1', serviceName: 'api-suite', route: '/orders', duration: 900, status: 'error' }),
      span({ projectId: 'api-suite', traceId: 'tr_a', spanId: 'sp_a2', parentSpanId: 'sp_a1', serviceName: 'database', route: '/q', duration: 800, start: 5 }),
    ],
    errors: [err({ projectId: 'api-suite', traceId: 'tr_a' }), err({ projectId: 'pulsetrace', traceId: 'tr_p', serviceName: 'pulsetrace-backend', message: 'p-only' })],
  })
  const ids = async (q) => (await getAllTraces(q)).data.map((t) => t.traceId)
  assert.deepEqual(await ids({ projectId: 'pulsetrace' }), ['tr_p'])
  assert.deepEqual(await ids({ projectId: 'api-suite' }), ['tr_a'])
  assert.deepEqual((await getAllErrors({ projectId: 'api-suite' })).data.map((e) => e.projectId), ['api-suite'])
  assert.deepEqual((await getAllErrors({ projectId: 'pulsetrace' })).data.map((e) => e.message), ['p-only'])
  assert.deepEqual((await getServices({ projectId: 'api-suite' })).map((s) => s.name).sort(), ['api-suite', 'database'])
  assert.deepEqual((await getServices({ projectId: 'pulsetrace' })).map((s) => s.name).sort(), ['database', 'pulsetrace-backend'])
  assert.equal((await getPerformance({ projectId: 'api-suite' })).averageLatency, 900)
  assert.equal((await getPerformance({ projectId: 'pulsetrace' })).averageLatency, 10)
  assert.deepEqual((await getServiceMap({ projectId: 'api-suite' })).edges.map((e) => e.id), ['api-suite-database'])
  assert.deepEqual((await getServiceMap({ projectId: 'pulsetrace' })).edges.map((e) => e.id), ['pulsetrace-backend-database'])
  await assert.rejects(getTrace('tr_a', { projectId: 'pulsetrace' }), (e) => e.statusCode === 404)
  await assert.rejects(getTraceTree('tr_p', { projectId: 'api-suite' }), (e) => e.statusCode === 404)
})

test('idempotent: re-sending the same span is a duplicate, not a second copy; partial failures do not block good items', async () => {
  fresh()
  const s = span({ spanId: 'sp_dup' })
  assert.equal((await ingestBatch({ spans: [s] })).accepted.spans, 1)
  const again = await ingestBatch({ spans: [s] })
  assert.deepEqual([again.accepted.spans, again.duplicates, again.rejected.length], [0, 1, 0])
  assert.equal(db.store.spans.length, 1)
  assert.equal(db.store.traces.length, 1)
  const mixed = await ingestBatch({ spans: [span({ projectId: 'nope' }), span({ spanId: 'sp_good' })] })
  assert.deepEqual([mixed.accepted.spans, mixed.rejected.length, mixed.rejected[0].index, httpStatusFor(mixed)], [1, 1, 0, 207])
})

test('whole-request errors: malformed body, empty batch, too many items', async () => {
  fresh()
  for (const body of [undefined, null, 'x', 5, [], [{}]]) await assert.rejects(ingestBatch(body), (e) => e.statusCode === 400 && /JSON object/.test(e.message))
  await assert.rejects(ingestBatch({ spans: 'nope' }), (e) => e.statusCode === 400 && /must be arrays/.test(e.message))
  await assert.rejects(ingestBatch({ errors: {} }), (e) => e.statusCode === 400)
  await assert.rejects(ingestBatch({}), (e) => e.statusCode === 400 && /empty/.test(e.message))
  await assert.rejects(ingestBatch({ spans: [], errors: [] }), (e) => e.statusCode === 400 && /empty/.test(e.message))
  await assert.rejects(ingestBatch({ spans: Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => ({})) }), (e) => e.statusCode === 413)
  assert.equal(db.store.spans.length, 0)
})

test('HTTP status via the controller: 200 all ok, 207 partial, 422 nothing usable, errors -> next()', async () => {
  fresh()
  const call = async (body) => {
    const out = { status: null, json: null, next: null }
    const res = { status(code) { out.status = code; return this }, json(payload) { out.json = payload } }
    await controller({ body }, res, (e) => { out.next = e })
    return out
  }
  const ok = await call({ spans: [span()] })
  assert.deepEqual([ok.status, ok.json.success, ok.json.data.accepted.spans], [200, true, 1])
  const partial = await call({ spans: [span(), span({ projectId: 'nope' })] })
  assert.deepEqual([partial.status, partial.json.success, partial.json.data.rejected.length], [207, true, 1])
  const none = await call({ spans: [span({ projectId: 'nope' })] })
  assert.deepEqual([none.status, none.json.success], [422, false])
  const dup = await call({ spans: [span({ spanId: 'sp_same' })] }); const dup2 = await call({ spans: [dup.json && db.store.spans.find((s) => s.spanId === 'sp_same') ? span({ spanId: 'sp_same' }) : span()] })
  assert.equal(dup2.status, 200)
  const broken = await call(undefined)
  assert.equal(broken.status, null)
  assert.equal(broken.next.statusCode, 400)
})

test('loop prevention: /api/telemetry (and the other PulseTrace API paths) are on the default ignore list and are not traced', async () => {
  assert.ok(DEFAULT_TRACE_IGNORE_PATHS.includes('/api/telemetry'))
  for (const path of ['/api/health', '/api/traces', '/api/spans', '/api/errors', '/api/performance', '/api/service-map', '/api/services', '/api/settings', '/api/projects']) assert.ok(DEFAULT_TRACE_IGNORE_PATHS.includes(path), path)
  const recorded = []
  const mw = createTracingMiddleware({ record: async (d) => { recorded.push(d) }, isDatabaseReady: () => true, ignorePaths: DEFAULT_TRACE_IGNORE_PATHS, logger: console })
  const exchange = (path, method = 'POST') => {
    const handlers = {}
    const res = { statusCode: 200, writableFinished: true, headers: {}, setHeader(k, v) { this.headers[k] = v }, once: (e, h) => { handlers[e] = h } }
    mw({ method, originalUrl: path, path, headers: {} }, res, () => {})
    handlers.finish?.()
    return res
  }
  const batch = exchange('/api/telemetry/batch')
  assert.equal(batch.headers['x-trace-id'], undefined, 'no trace headers on the ingestion endpoint')
  assert.equal(recorded.length, 0)
  assert.ok(exchange('/api/orders', 'GET').headers['x-trace-id'], 'application routes are still traced')
  assert.equal(recorded.length, 1)
})
