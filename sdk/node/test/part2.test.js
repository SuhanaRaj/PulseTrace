import test from 'node:test'
import assert from 'node:assert/strict'
import { PulseTrace } from '../src/index.js'
import { sleep } from './helpers.js'

const base = {
  endpoint: 'http://127.0.0.1:5000',
  projectId: 'api-suite',
  serviceName: 'api-suite',
  environment: 'test',
  logger: false,
}

function fetchRecorder({ fail = false } = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    if (fail) throw new Error('ECONNREFUSED')
    return new Response(JSON.stringify({ success: true, data: { rejected: [] } }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  }
  return { fetch, calls }
}

test('transport batches multiple telemetry payloads by batch size', async () => {
  const rec = fetchRecorder()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, batchSize: 3, flushInterval: 60000 })
  const a = pt.startSpan('A'); a.end()
  const b = pt.startSpan('B'); b.end()
  const c = pt.startSpan('C'); c.end()

  for (let i = 0; i < 100 && rec.calls.length === 0; i++) await sleep(5)
  await pt.shutdown()

  assert.equal(rec.calls.length, 1)
  assert.equal(rec.calls[0].body.spans.length, 3)
})

test('flush interval sends buffered telemetry without blocking the application', async () => {
  const rec = fetchRecorder()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, batchSize: 50, flushInterval: 20 })
  const span = pt.startSpan('Delayed')
  span.end()

  for (let i = 0; i < 100 && rec.calls.length === 0; i++) await sleep(5)
  await pt.shutdown()
  assert.equal(rec.calls.length, 1)
})

test('failed delivery is retried and never rejects the caller', async () => {
  let attempts = 0
  const fetch = async () => {
    attempts += 1
    throw new Error('ECONNREFUSED')
  }
  const pt = new PulseTrace({ ...base, fetch, maxRetries: 2, retryDelay: 1, flushInterval: 60000 })
  const span = pt.startSpan('Retry')
  assert.doesNotThrow(() => span.end())
  await pt.flush()
  assert.equal(attempts, 3)
  await pt.shutdown({ discard: true })
})

test('manual span inherits the current request context', async () => {
  const rec = fetchRecorder()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, batchSize: 50, flushInterval: 60000 })

  // Use the SDK's middleware with a minimal HTTP exchange through the test helper.
  const { startServer, request } = await import('./helpers.js')
  const app = await startServer(async (req, res) => {
    const parent = pt.getContext()
    const child = pt.startSpan('Database Query')
    await sleep(2)
    child.end()
    res.end(parent.traceId)
  }, { pre: [pt.middleware()] })

  const response = await request(`${app.url}/users`)
  await app.close()
  await pt.flush()

  const spans = rec.calls.flatMap(c => c.body.spans)
  const http = spans.find(s => s.operation === 'GET /users')
  const child = spans.find(s => s.operation === 'Database Query')

  assert.ok(http)
  assert.ok(child)
  assert.equal(child.traceId, http.traceId)
  assert.equal(child.parentSpanId, http.spanId)
})

test('manual span can record an error', async () => {
  const rec = fetchRecorder()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, batchSize: 50, flushInterval: 60000 })
  const span = pt.startSpan('Database Query')
  span.recordError(new TypeError('database unavailable'))
  span.end()
  await pt.flush()

  const body = rec.calls.flatMap(c => c.body.errors)
  assert.equal(body.length, 1)
  assert.equal(body[0].errorType, 'TypeError')
  assert.equal(body[0].spanId, span.spanId)
})

test('shutdown flushes pending telemetry', async () => {
  const rec = fetchRecorder()
  const pt = new PulseTrace({ ...base, fetch: rec.fetch, batchSize: 100, flushInterval: 60000 })
  const span = pt.startSpan('Shutdown Flush')
  span.end()
  await pt.shutdown()
  assert.equal(rec.calls.length, 1)
})
