// Regression: x-parent-span-id must survive header -> middleware -> recordHttpSpan -> recordSpan -> storage,
// and the tree must show the new span under its parent.
// Uses a REAL Node HTTP server + real HTTP requests, with in-memory fakes for the models (no MongoDB).
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const db = {
  traces: [{ projectId: 'pulsetrace', traceId: 'tr_9df0dd5e3db554a1', status: 'success', duration: 100 }, { projectId: 'pulsetrace', traceId: 'tr_other', status: 'success', duration: 1 }],
  spans: [
    { projectId: 'pulsetrace', spanId: 'sp_598ec9bc9a86', traceId: 'tr_9df0dd5e3db554a1', parentSpanId: null, serviceName: 'pulsetrace-backend', operation: 'GET /api/services', startTime: new Date('2026-10-01T10:00:00.000Z'), endTime: new Date('2026-10-01T10:00:00.050Z'), duration: 50, status: 'success' },
    { projectId: 'pulsetrace', spanId: 'sp_in_other_trace', traceId: 'tr_other', parentSpanId: null, serviceName: 'x', operation: 'x', startTime: new Date(), endTime: new Date(), duration: 0, status: 'success' },
  ],
  errors: [], services: [],
};
const match = (row, q) => Object.entries(q).every(([k, v]) => row[k] === v);
const fakeModel = (name) => ({
  findOne: async (q) => db[name].find((r) => match(r, q)) || null,
  exists: async (q) => (db[name].find((r) => match(r, q)) ? { _id: 1 } : null),
  find: (q) => {
    const rows = db[name].filter((r) => match(r, q));
    const wrap = (arr) => arr.map((r) => ({ ...r, toObject() { return { ...r }; } }));
    return { sort: async () => wrap([...rows].sort((a, b) => a.startTime - b.startTime)) };
  },
  create: async (doc) => { db[name].push({ ...doc }); return { ...doc }; },
  updateOne: async (q, u) => { if (!db[name].find((r) => match(r, q))) db[name].push({ ...u.$setOnInsert }); },
});
mock.module('../src/models/Trace.js', { defaultExport: fakeModel('traces') });
mock.module('../src/models/Span.js', { defaultExport: fakeModel('spans') });
mock.module('../src/models/Service.js', { defaultExport: fakeModel('services') });
mock.module('../src/models/Error.js', { defaultExport: fakeModel('errors') });
mock.module('../src/config/env.js', { defaultExport: { nodeEnv: 'test', serviceName: 'pulsetrace-backend', traceIgnorePaths: ['/api/health'] } });
mock.module('../src/config/database.js', { namedExports: { isDatabaseConnected: () => true } });

const { createTracingMiddleware } = await import('../src/middleware/tracingMiddleware.js');
const { getTraceTree } = await import('../src/services/tracingService.js');

const logs = [];
const middleware = createTracingMiddleware({ logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) } });
const server = http.createServer((req, res) => {
  // Express adds these two properties; the middleware relies on them.
  req.originalUrl = req.url;
  req.path = new URL(req.url, 'http://localhost').pathname;
  middleware(req, res, () => {
    res.statusCode = req.path === '/api/missing' ? 404 : 200;
    res.end('{}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const { port } = server.address();

const get = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res));
  }).on('error', reject);
});
// storage happens just after the response finishes
const settle = async (spanId) => {
  for (let i = 0; i < 50 && !db.spans.find((s) => s.spanId === spanId); i += 1) await new Promise((r) => setTimeout(r, 10));
};

const TRACE = 'tr_9df0dd5e3db554a1';
const PARENT = 'sp_598ec9bc9a86';

test('existing trace + existing parent: child span is stored with parentSpanId and appears under the parent in the tree', async () => {
  const tracesBefore = db.traces.length;
  const res = await get('/api/services', { 'x-trace-id': TRACE, 'x-parent-span-id': PARENT });
  const spanId = res.headers['x-span-id'];
  await settle(spanId);

  // 1. existing trace id reused (response header, no new trace)
  assert.equal(res.headers['x-trace-id'], TRACE);
  assert.equal(db.traces.length, tracesBefore);

  // 2 + 3. parent accepted and stored on the new span
  const span = db.spans.find((s) => s.spanId === spanId);
  assert.ok(span, `span ${spanId} was not stored. logs: ${logs.join(' | ')}`);
  assert.equal(span.traceId, TRACE);
  assert.equal(span.parentSpanId, PARENT);

  // 4. the parent belongs to the same trace
  assert.equal(db.spans.find((s) => s.spanId === PARENT).traceId, span.traceId);

  // 5. tree: child nested under the parent, not a second root
  const { spans: roots } = await getTraceTree(TRACE);
  assert.deepEqual(roots.map((r) => r.spanId), [PARENT]);
  assert.deepEqual(roots[0].children.map((c) => c.spanId), [spanId]);
});

test('header name is case-insensitive over real HTTP', async () => {
  const res = await get('/api/services', { 'X-Trace-Id': TRACE, 'X-Parent-Span-Id': PARENT });
  await settle(res.headers['x-span-id']);
  assert.equal(db.spans.find((s) => s.spanId === res.headers['x-span-id']).parentSpanId, PARENT);
});

test('error response (404) still records the parent and marks the span as error', async () => {
  const res = await get('/api/missing', { 'x-trace-id': TRACE, 'x-parent-span-id': PARENT });
  assert.equal(res.statusCode, 404);
  await settle(res.headers['x-span-id']);
  const span = db.spans.find((s) => s.spanId === res.headers['x-span-id']);
  assert.equal(span.parentSpanId, PARENT);
  assert.equal(span.status, 'error');
});

test('parent from another trace is rejected: nothing stored, response unaffected', async () => {
  const before = db.spans.length;
  const res = await get('/api/services', { 'x-trace-id': TRACE, 'x-parent-span-id': 'sp_in_other_trace' });
  assert.equal(res.statusCode, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(db.spans.length, before);
  assert.ok(logs.some((l) => /different trace/.test(l)));
});
