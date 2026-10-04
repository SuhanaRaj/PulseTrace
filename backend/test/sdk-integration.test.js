// The real @pulsetrace/node SDK talking over real HTTP to the real telemetry controller/service
// (in-memory fake models instead of MongoDB, a minimal Express stand-in instead of Express).
import { test, mock, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createFakeDb } from './helpers/fakeMongo.js'

const db = createFakeDb()
const env = { nodeEnv: 'test' }
mock.module('../src/config/env.js', { defaultExport: env })
mock.module('../src/config/database.js', { namedExports: { isDatabaseConnected: () => true } })
mock.module('../src/models/Trace.js', { defaultExport: db.models.Trace })
mock.module('../src/models/Span.js', { defaultExport: db.models.Span })
mock.module('../src/models/Service.js', { defaultExport: db.models.Service })
mock.module('../src/models/Error.js', { defaultExport: db.models.Error })

const { ingestBatch } = await import('../src/controllers/telemetryController.js')
const { getTraceTree } = await import('../src/services/tracingService.js')
const { getAllTraces } = await import('../src/services/traceService.js')
const { getServiceMap } = await import('../src/services/serviceMapService.js')
const { PulseTrace } = await import('../../sdk/node/src/index.js')

// --- "PulseTrace backend": POST /api/telemetry/batch -> real controller ---
const received = []
const pulseServer = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    received.push({ method: req.method, url: req.url })
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (payload) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)) }
    if (req.method !== 'POST' || req.url !== '/api/telemetry/batch') { res.status(404).json({ success: false, message: 'not found' }); return }
    req.body = JSON.parse(raw)
    ingestBatch(req, res, (error) => res.status(error.statusCode || 500).json({ success: false, message: error.message }))
  })
})
await new Promise((r) => pulseServer.listen(0, '127.0.0.1', r))
const endpoint = `http://127.0.0.1:${pulseServer.address().port}`
const servers = []
after(() => { pulseServer.close(); servers.forEach((s) => s.close()) })

// --- a monitored application: any Node server + pulseTrace.middleware() ---
async function app(pt, handler) {
  const server = http.createServer((req, res) => {
    req.originalUrl = req.url; req.path = new URL(req.url, 'http://x').pathname
    pt.middleware()(req, res, () => handler(req, res))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
const get = (url, headers = {}) => new Promise((resolve, reject) => http.get(url, { headers }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })) }).on('error', reject))
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); return fn() }
const quiet = { warn() {}, error() {} }

test('SDK -> /api/telemetry/batch: a monitored request appears in the api-suite project with the right fields', async () => {
  db.reset()
  const pt = new PulseTrace({ endpoint, projectId: 'api-suite', serviceName: 'api-suite', environment: 'development', logger: quiet })
  const url = await app(pt, (req, res) => setTimeout(() => res.end('orders'), 30))
  const res = await get(`${url}/orders?page=1`)
  assert.equal(await until(() => db.store.spans.length === 1), true)

  const [span] = db.store.spans
  const [trace] = db.store.traces
  assert.deepEqual([span.projectId, span.serviceName, span.operation, span.status, span.parentSpanId], ['api-suite', 'api-suite', 'GET /orders', 'success', null])
  assert.equal(span.spanId, res.headers['x-span-id'])
  assert.equal(span.traceId, res.headers['x-trace-id'])
  assert.ok(span.duration >= 25)
  assert.equal(span.endTime - span.startTime, span.duration)
  assert.deepEqual([trace.projectId, trace.rootService, trace.route, trace.method, trace.status, trace.traceId], ['api-suite', 'api-suite', '/orders', 'GET', 'success', res.headers['x-trace-id']])
  assert.deepEqual(db.store.services.map((s) => [s.projectId, s.name, s.environment]), [['api-suite', 'api-suite', 'development']])
  assert.ok(received.every((r) => r.method === 'POST' && r.url === '/api/telemetry/batch'))
})

test('SDK -> backend: a 500 produces an error span, an error record linked to the trace, and the app response is unchanged', async () => {
  db.reset()
  const pt = new PulseTrace({ endpoint, projectId: 'api-suite', serviceName: 'api-suite', logger: quiet })
  const url = await app(pt, (req, res) => { res.statusCode = 500; res.end('server exploded') })
  const res = await get(`${url}/checkout`)
  assert.deepEqual([res.status, res.body], [500, 'server exploded'])
  assert.equal(await until(() => db.store.errors.length === 1), true)
  const [error] = db.store.errors
  assert.deepEqual([error.projectId, error.traceId, error.serviceName, error.errorType], ['api-suite', res.headers['x-trace-id'], 'api-suite', 'HTTP 500'])
  assert.equal(db.store.spans[0].status, 'error')
  assert.equal(db.store.traces[0].status, 'error')
})

test('SDK -> backend: two monitored services in one trace form a parent/child tree and a service-map edge', async () => {
  db.reset()
  const authPt = new PulseTrace({ endpoint, projectId: 'api-suite', serviceName: 'auth-service', logger: quiet })
  const gwPt = new PulseTrace({ endpoint, projectId: 'api-suite', serviceName: 'api-gateway', logger: quiet })
  const authUrl = await app(authPt, (req, res) => res.end('ok'))
  const gwUrl = await app(gwPt, async (req, res) => { await get(`${authUrl}/verify`, gwPt.getPropagationHeaders()); res.end('done') })
  const res = await get(`${gwUrl}/entry`)
  assert.equal(await until(() => db.store.spans.length === 2), true)
  const traceId = res.headers['x-trace-id']
  const tree = await getTraceTree(traceId, { projectId: 'api-suite' })
  assert.deepEqual(tree.spans.map((s) => s.serviceName), ['api-gateway'], 'the gateway span is the root even though the auth span was reported first')
  assert.deepEqual(tree.spans[0].children.map((s) => [s.serviceName, s.parentSpanId]), [['auth-service', res.headers['x-span-id']]])
  assert.equal(db.store.traces.length, 1)
  assert.deepEqual([db.store.traces[0].rootService, db.store.traces[0].route], ['api-gateway', '/entry'])
  assert.deepEqual((await getServiceMap({ projectId: 'api-suite' })).edges.map((e) => [e.source, e.target]), [['api-gateway', 'auth-service']])
})

test('SDK -> backend: two projects with the same service names stay isolated', async () => {
  db.reset()
  const mine = new PulseTrace({ endpoint, projectId: 'pulsetrace', serviceName: 'database', logger: quiet })
  const theirs = new PulseTrace({ endpoint, projectId: 'api-suite', serviceName: 'database', logger: quiet })
  const a = await app(mine, (req, res) => res.end('a'))
  const b = await app(theirs, (req, res) => res.end('b'))
  const ra = await get(`${a}/q`); const rb = await get(`${b}/q`)
  assert.equal(await until(() => db.store.spans.length === 2), true)
  assert.deepEqual((await getAllTraces({ projectId: 'pulsetrace' })).data.map((t) => t.traceId), [ra.headers['x-trace-id']])
  assert.deepEqual((await getAllTraces({ projectId: 'api-suite' })).data.map((t) => t.traceId), [rb.headers['x-trace-id']])
  assert.deepEqual(db.store.services.map((s) => s.projectId).sort(), ['api-suite', 'pulsetrace'])
  // trying to continue a pulsetrace trace from the api-suite project is refused by the backend and does not leak into either project
  const before = db.store.spans.length
  await get(`${b}/q`, { 'x-trace-id': ra.headers['x-trace-id'], 'x-parent-span-id': ra.headers['x-span-id'] })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(db.store.spans.length, before)
})

test('SDK -> backend: an unknown projectId is rejected by PulseTrace, reported to onError, and never breaks the app', async () => {
  db.reset()
  const problems = []
  const pt = new PulseTrace({ endpoint, projectId: 'no-such-project', serviceName: 'x', logger: quiet, onError: (e) => problems.push(e.message) })
  const url = await app(pt, (req, res) => res.end('fine'))
  const res = await get(`${url}/x`)
  assert.deepEqual([res.status, res.body], [200, 'fine'])
  assert.equal(await until(() => problems.length > 0), true)
  assert.match(problems[0], /Invalid projectId.*pulsetrace, api-suite/)
  assert.deepEqual(db.store, { traces: [], spans: [], errors: [], services: [] })
})

test('SDK keeps the app working when PulseTrace is unreachable', async () => {
  const problems = []
  const pt = new PulseTrace({ endpoint: 'http://127.0.0.1:1', projectId: 'api-suite', serviceName: 'x', timeout: 500, logger: quiet, onError: (e) => problems.push(e.message) })
  const url = await app(pt, (req, res) => res.end('fine'))
  const res = await get(`${url}/x`)
  assert.equal(res.body, 'fine')
  assert.equal(await until(() => problems.length > 0), true)
})
