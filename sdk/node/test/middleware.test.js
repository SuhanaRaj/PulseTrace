import test from 'node:test'
import assert from 'node:assert/strict'
import { PulseTrace, PARENT_SPAN_HEADER, SPAN_HEADER, TRACE_HEADER } from '../src/index.js'
import { resolveRoute } from '../src/middleware.js'
import { fakeExchange, recordingFetch, request, silentLogger, sleep, startServer } from './helpers.js'

const base = { endpoint: 'http://localhost:5000', projectId: 'api-suite', serviceName: 'api-suite', environment: 'development' }
function setup(extra = {}) {
  const rec = recordingFetch()
  const log = silentLogger()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, logger: log, ...extra })
  return { rec, log, pt }
}
const serve = (pt, handler) => startServer(handler, { pre: [pt.middleware()] })

test('exports the PulseTrace class and the propagation header names', () => {
  assert.equal(typeof PulseTrace, 'function')
  assert.deepEqual([TRACE_HEADER, PARENT_SPAN_HEADER, SPAN_HEADER], ['x-trace-id', 'x-parent-span-id', 'x-span-id'])
})

test('no incoming headers: generates traceId + spanId, exposes them, reports a root span', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => { res.end('ok') })
  const res = await request(`${app.url}/api/missions?x=1`)
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.equal(res.body, 'ok')
  assert.match(res.headers['x-trace-id'], /^tr_[0-9a-f]{16}$/)
  assert.match(res.headers['x-span-id'], /^sp_[0-9a-f]{12}$/)
  assert.equal(span.traceId, res.headers['x-trace-id'])
  assert.equal(span.spanId, res.headers['x-span-id'])
  assert.equal(span.parentSpanId, null)
  assert.equal(rec.calls[0].url, 'http://localhost:5000/api/telemetry/batch')
})

test('span carries projectId, serviceName, environment, method, route, operation, status and times', async () => {
  const { rec, pt } = setup({ serviceName: 'Orders-API', environment: 'staging' })
  const app = await serve(pt, (req, res) => { res.end('ok') })
  await request(`${app.url}/api/missions?x=1`, { method: 'POST' })
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.equal(span.projectId, 'api-suite')
  assert.equal(span.serviceName, 'Orders-API')
  assert.equal(span.environment, 'staging')
  assert.equal(span.method, 'POST')
  assert.equal(span.route, '/api/missions') // query string removed
  assert.equal(span.operation, 'POST /api/missions')
  assert.equal(span.status, 'success')
  assert.ok(!Number.isNaN(Date.parse(span.startTime)) && !Number.isNaN(Date.parse(span.endTime)))
  assert.equal(rec.errors().length, 0)
})

test('duration is measured and consistent with endTime - startTime', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, async (req, res) => { await sleep(60); res.end('slow') })
  await request(`${app.url}/slow`)
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.ok(span.duration >= 55 && span.duration < 1000, `duration ${span.duration}`)
  assert.equal(Date.parse(span.endTime) - Date.parse(span.startTime), span.duration)
  assert.ok(Number.isInteger(span.duration))
})

test('incoming x-trace-id is reused, not replaced', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => res.end('ok'))
  const res = await request(`${app.url}/x`, { headers: { 'x-trace-id': 'tr_existing_123' } })
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.equal(res.headers['x-trace-id'], 'tr_existing_123')
  assert.equal(span.traceId, 'tr_existing_123')
  assert.equal(span.parentSpanId, null)
  assert.match(span.spanId, /^sp_/)
})

test('parent-child: x-parent-span-id becomes parentSpanId and the span id is new', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => res.end('ok'))
  const res = await request(`${app.url}/x`, { headers: { 'x-trace-id': 'tr_123', 'x-parent-span-id': 'sp_001' } })
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.deepEqual([span.traceId, span.parentSpanId], ['tr_123', 'sp_001'])
  assert.notEqual(span.spanId, 'sp_001')
  assert.equal(res.headers['x-span-id'], span.spanId)
})

test('two services in one trace: the downstream span is the child of the upstream span', async () => {
  const downstream = setup({ serviceName: 'downstream' })
  const upstream = setup({ serviceName: 'upstream' })
  const b = await serve(downstream.pt, (req, res) => res.end('b'))
  const a = await serve(upstream.pt, async (req, res) => {
    // inside the request: call the downstream service continuing the same trace
    const out = await request(`${b.url}/inner`, { headers: upstream.pt.getPropagationHeaders() })
    res.end(`a->${out.body}`)
  })
  const res = await request(`${a.url}/outer`)
  const [parent] = await upstream.rec.waitFor(1)
  const [child] = await downstream.rec.waitFor(1)
  await a.close(); await b.close()
  assert.equal(res.body, 'a->b')
  assert.equal(parent.parentSpanId, null)
  assert.equal(child.traceId, parent.traceId)
  assert.equal(child.parentSpanId, parent.spanId)
  assert.notEqual(child.spanId, parent.spanId)
  assert.deepEqual([parent.serviceName, child.serviceName], ['upstream', 'downstream'])
})

test('invalid propagation headers are ignored with a warning (not trusted, not silent)', async () => {
  const { rec, pt, log } = setup()
  const app = await serve(pt, (req, res) => res.end('ok'))
  const res = await request(`${app.url}/x`, { headers: { 'x-trace-id': 'bad id;$where', 'x-parent-span-id': '{{parentSpan}}' } })
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.match(res.headers['x-trace-id'], /^tr_[0-9a-f]{16}$/)
  assert.equal(span.parentSpanId, null)
  assert.equal(log.logs.filter(([level, m]) => level === 'warn' && /invalid x-/.test(m)).length, 2)
})

test('4xx/5xx => error span + error item (HTTP code); the response itself is untouched', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => { res.statusCode = req.path === '/boom' ? 500 : 404; res.end('nope') })
  const r404 = await request(`${app.url}/missing`)
  const r500 = await request(`${app.url}/boom`)
  const spans = await rec.waitFor(2)
  await app.close()
  assert.deepEqual([r404.status, r404.body, r500.status], [404, 'nope', 500])
  assert.deepEqual(spans.map(s => s.status), ['error', 'error'])
  const errors = rec.errors()
  assert.deepEqual(errors.map(e => e.errorType), ['HTTP 404', 'HTTP 500'])
  assert.equal(errors[0].spanId, spans[0].spanId)
  assert.equal(errors[0].traceId, spans[0].traceId)
  assert.equal(errors[0].projectId, 'api-suite')
  assert.equal(errors[0].serviceName, 'api-suite')
  assert.match(errors[0].message, /GET \/missing responded with 404/)
  assert.equal(errors[0].stackTrace, null)
})

test('3xx is success', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => { res.statusCode = 302; res.end() })
  await request(`${app.url}/old`)
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.equal(span.status, 'success')
  assert.equal(rec.errors().length, 0)
})

test('errorHandler() records the thrown error type, message and stack', async () => {
  const { rec, pt } = setup()
  const app = await startServer((req, res) => {
    const error = new TypeError('cannot read x')
    // what Express does: run the error handlers, which then send the 500
    pt.errorHandler()(error, req, res, () => { res.statusCode = 500; res.end('handled') })
  }, { pre: [pt.middleware()] })
  const res = await request(`${app.url}/throws`)
  const [span] = await rec.waitFor(1)
  await app.close()
  assert.equal(res.status, 500)
  const [error] = rec.errors()
  assert.deepEqual([error.errorType, error.message, span.status], ['TypeError', 'cannot read x', 'error'])
  assert.match(error.stackTrace, /TypeError: cannot read x/)
  assert.equal(error.spanId, span.spanId)
})

test('AsyncLocalStorage: context is available to handlers and across awaits/timers, isolated per request, absent outside', async () => {
  const { pt } = setup()
  assert.equal(pt.getContext(), undefined)
  const seen = {}
  const app = await serve(pt, async (req, res) => {
    const id = req.path.slice(1)
    const sync = pt.getContext()
    await sleep(id === 'a' ? 40 : 5) // interleave the two requests
    await new Promise(r => setTimeout(r, 1))
    const later = pt.getContext()
    seen[id] = { sync, later, headers: pt.getPropagationHeaders() }
    res.end(id)
  })
  const [a, b] = await Promise.all([request(`${app.url}/a`), request(`${app.url}/b`)])
  await app.close()
  for (const [id, res] of [['a', a], ['b', b]]) {
    assert.equal(seen[id].sync.spanId, res.headers['x-span-id'])
    assert.equal(seen[id].later.spanId, res.headers['x-span-id'], 'context survives awaits')
    assert.equal(seen[id].later.traceId, res.headers['x-trace-id'])
    assert.deepEqual(seen[id].later.projectId, 'api-suite')
    assert.deepEqual(seen[id].headers, { 'x-trace-id': res.headers['x-trace-id'], 'x-parent-span-id': res.headers['x-span-id'] })
  }
  assert.notEqual(seen.a.later.spanId, seen.b.later.spanId)
  assert.equal(pt.getContext(), undefined, 'nothing leaks outside the request')
  assert.throws(() => { seen.a.sync.traceId = 'x' }, TypeError, 'context is frozen')
})

test('two SDK instances do not share context', async () => {
  const one = setup({ serviceName: 'one' }).pt
  const two = setup({ serviceName: 'two' }).pt
  let inner
  const app = await serve(one, (req, res) => { inner = { one: one.getContext()?.serviceName, two: two.getContext() }; res.end('ok') })
  await request(`${app.url}/x`)
  await app.close()
  assert.deepEqual(inner, { one: 'one', two: undefined })
})

test('telemetry failures never break the app (PulseTrace down, slow or rejecting)', async () => {
  const errors = []
  const down = new PulseTrace({ ...base, fetch: async () => { throw new Error('ECONNREFUSED') }, onError: e => errors.push(e.message) })
  const app = await serve(down, (req, res) => res.end('still works'))
  const res = await request(`${app.url}/x`)
  for (let i = 0; i < 100 && !errors.length; i += 1) await sleep(5)
  await app.close()
  assert.deepEqual([res.status, res.body], [200, 'still works'])
  assert.match(errors[0], /ECONNREFUSED/)
})

test('without onError, failures are logged at most once per interval', async () => {
  const log = silentLogger()
  const pt = new PulseTrace({ ...base, fetch: async () => { throw new Error('down') }, logger: log })
  const app = await serve(pt, (req, res) => res.end('ok'))
  for (let i = 0; i < 5; i += 1) await request(`${app.url}/x`)
  await sleep(50)
  await app.close()
  assert.equal(log.logs.filter(([level]) => level === 'warn').length, 1)
})

test('ignorePaths, OPTIONS and enabled:false produce no telemetry and no headers', async () => {
  const { rec, pt } = setup({ ignorePaths: ['/health'] })
  const app = await serve(pt, (req, res) => res.end('ok'))
  const health = await request(`${app.url}/health`)
  const nested = await request(`${app.url}/health/db`)
  const options = await request(`${app.url}/x`, { method: 'OPTIONS' })
  const traced = await request(`${app.url}/healthy`) // prefix match is path-segment based
  await rec.waitFor(1)
  await app.close()
  assert.equal(health.headers['x-trace-id'], undefined)
  assert.equal(nested.headers['x-trace-id'], undefined)
  assert.equal(options.headers['x-trace-id'], undefined)
  assert.ok(traced.headers['x-trace-id'])
  assert.deepEqual(rec.spans().map(s => s.route), ['/healthy'])

  const off = setup({ enabled: false })
  const app2 = await serve(off.pt, (req, res) => res.end('ok'))
  const res = await request(`${app2.url}/x`)
  await sleep(30)
  await app2.close()
  assert.equal(res.headers['x-trace-id'], undefined)
  assert.equal(off.rec.calls.length, 0)
})

test('one span per request, even though both finish and close fire', async () => {
  const { rec, pt } = setup()
  const app = await serve(pt, (req, res) => res.end('ok'))
  await request(`${app.url}/x`)
  await sleep(50)
  await app.close()
  assert.equal(rec.spans().length, 1)
})

test('aborted request (client closes before the response finished) is reported as an error', async () => {
  const { rec, pt } = setup()
  const { req, res } = fakeExchange({ url: '/slow' })
  res.writableFinished = false
  let called = 0
  pt.middleware()(req, res, () => { called += 1 })
  res.emit('close')
  res.emit('close')
  await rec.waitFor(1)
  assert.equal(called, 1)
  assert.equal(rec.spans().length, 1)
  assert.equal(rec.spans()[0].status, 'error')
  assert.match(rec.errors()[0].message, /aborted/)
})

test('route: Express route pattern (baseUrl + route.path) when known, else the concrete path', () => {
  assert.equal(resolveRoute({ originalUrl: '/api/users/42?x=1', route: { path: '/:id' }, baseUrl: '/api/users' }), '/api/users/:id')
  assert.equal(resolveRoute({ originalUrl: '/api/users', route: { path: '/' }, baseUrl: '/api/users' }), '/api/users')
  assert.equal(resolveRoute({ originalUrl: '/ping', route: { path: '/ping' }, baseUrl: '' }), '/ping')
  assert.equal(resolveRoute({ originalUrl: '/', route: { path: '/' } }), '/')
  assert.equal(resolveRoute({ originalUrl: '/api/users/42?x=1' }), '/api/users/42')
  assert.equal(resolveRoute({ originalUrl: '/a/b', route: { path: /regex/ } }), '/a/b')
})

test('route is captured when the response STARTS (Express resets baseUrl afterwards, e.g. via an error handler)', async () => {
  const { rec, pt } = setup()
  const { req, res } = fakeExchange({ url: '/api/users/42', method: 'GET', route: { path: '/:id' }, baseUrl: '/api/users' })
  pt.middleware()(req, res, () => {})
  res.writeHead(200) // response starts inside the handler: baseUrl + route known
  req.baseUrl = ''; req.route = { path: '/:id' } // later Express restores baseUrl
  res.emit('finish')
  const [span] = await rec.waitFor(1)
  assert.equal(span.route, '/api/users/:id')
  assert.equal(span.operation, 'GET /api/users/:id')
})

test('a bug inside the middleware itself never blocks the request', () => {
  const { pt } = setup()
  const { req, res } = fakeExchange()
  res.setHeader = () => { throw new Error('headers already sent') }
  let called = 0
  assert.doesNotThrow(() => pt.middleware()(req, res, () => { called += 1 }))
  assert.equal(called, 1)
})
