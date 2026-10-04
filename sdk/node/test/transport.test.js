import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createTransport } from '../src/transport.js'
import { recordingFetch } from './helpers.js'

const make = (fetch, extra = {}) => { const errors = []; return { errors, transport: createTransport({ ingestUrl: 'http://pt/api/telemetry/batch', timeout: 200, fetch, reportError: e => errors.push(e), ...extra }) } }

test('POSTs JSON { spans, errors } to the ingestion URL', async () => {
  const rec = recordingFetch()
  const { transport, errors } = make(rec.fetch)
  const result = await transport.send({ spans: [{ spanId: 'sp_1' }], errors: [] })
  assert.equal(result.ok, true)
  assert.equal(rec.calls[0].url, 'http://pt/api/telemetry/batch')
  assert.equal(rec.calls[0].init.method, 'POST')
  assert.equal(rec.calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(rec.calls[0].body, { spans: [{ spanId: 'sp_1' }], errors: [] })
  assert.equal(errors.length, 0)
})

test('never rejects: network failure, timeout, HTTP errors and rejected items are reported instead', async () => {
  const net = make(async () => { throw new Error('ECONNREFUSED') })
  assert.deepEqual(await net.transport.send({ spans: [{}] }), { ok: false, status: null, body: null })
  assert.match(net.errors[0].message, /ECONNREFUSED/)

  const slow = make((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
  assert.equal((await slow.transport.send({ spans: [{}] })).ok, false)
  assert.match(slow.errors[0].message, /did not respond within 200ms/)

  const http500 = make(async () => new Response(JSON.stringify({ success: false, message: 'Internal Server Error' }), { status: 500 }))
  assert.equal((await http500.transport.send({ spans: [{}] })).status, 500)
  assert.match(http500.errors[0].message, /HTTP 500: Internal Server Error/)

  const partial = make(async () => new Response(JSON.stringify({ success: true, data: { rejected: [{ type: 'span', reason: 'projectId is required.' }] } }), { status: 207 }))
  assert.equal((await partial.transport.send({ spans: [{}] })).ok, true)
  assert.match(partial.errors[0].message, /rejected 1 telemetry item.*projectId is required/)

  const notJson = make(async () => new Response('<html>', { status: 502 }))
  assert.equal((await notJson.transport.send({ spans: [{}] })).status, 502)
})

test('works with the real global fetch against a real HTTP server', async () => {
  let received
  const server = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { received = { url: req.url, method: req.method, type: req.headers['content-type'], body: JSON.parse(b) }; res.setHeader('content-type', 'application/json'); res.end('{"success":true,"data":{"rejected":[]}}') }) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { transport, errors } = make(globalThis.fetch, { ingestUrl: `http://127.0.0.1:${server.address().port}/api/telemetry/batch`, timeout: 2000 })
  assert.equal((await transport.send({ spans: [{ spanId: 'sp_9' }], errors: [] })).ok, true)
  server.close()
  assert.deepEqual([received.url, received.method, received.type], ['/api/telemetry/batch', 'POST', 'application/json'])
  assert.equal(received.body.spans[0].spanId, 'sp_9')
  assert.equal(errors.length, 0)
})
