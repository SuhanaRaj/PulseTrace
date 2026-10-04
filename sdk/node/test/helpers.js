import http from 'node:http'
import { EventEmitter } from 'node:events'

// A recording fetch stub: collects every telemetry POST and answers like PulseTrace would.
export function recordingFetch(reply = () => new Response(JSON.stringify({ success: true, data: { rejected: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })) {
  const calls = []
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return reply(url, init) }
  return {
    fetch, calls,
    spans: () => calls.flatMap(c => c.body.spans),
    errors: () => calls.flatMap(c => c.body.errors),
    async waitFor(n = 1, ms = 2000) { const end = Date.now() + ms; while (this.spans().length < n && Date.now() < end) await new Promise(r => setTimeout(r, 5)); return this.spans() },
  }
}

// Minimal Express stand-in on a real Node HTTP server: adds req.path / req.originalUrl like Express does.
export async function startServer(handlers, { pre = [] } = {}) {
  const server = http.createServer((req, res) => {
    req.originalUrl = req.url
    req.path = new URL(req.url, 'http://localhost').pathname
    const chain = [...pre, (rq, rs) => handlers(rq, rs)]
    const run = i => { if (i < chain.length) chain[i](req, res, () => run(i + 1)) }
    run(0)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}

export function request(url, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

// Fake req/res pair for exercising the middleware without a server.
export function fakeExchange({ method = 'GET', url = '/x', headers = {}, statusCode = 200, route, baseUrl } = {}) {
  const req = { method, url, originalUrl: url, path: url.split('?')[0], headers, route, baseUrl }
  const res = Object.assign(new EventEmitter(), { statusCode, writableFinished: true, headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead() { return this } })
  return { req, res }
}

export const silentLogger = () => { const logs = []; return { logs, warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]) } }
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
