// Tests recordHttpSpan with in-memory fakes for the models (no MongoDB). Run: npm run test:logic
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const db = { traces: [{ projectId: 'pulsetrace', traceId: 'tr_test_001', status: 'success', duration: 245 }], spans: [{ projectId: 'pulsetrace', spanId: 'sp_test_gateway', traceId: 'tr_test_001' }, { projectId: 'pulsetrace', spanId: 'sp_elsewhere', traceId: 'tr_seed' }], errors: [], services: [] };
let traceCreateError = null;
const match = (row, q) => Object.entries(q).every(([k, v]) => row[k] === v);
const fakeModel = (name) => ({
  findOne: async (q) => db[name].find((r) => match(r, q)) || null,
  exists: async (q) => (db[name].find((r) => match(r, q)) ? { _id: 1 } : null),
  create: async (doc) => {
    if (name === 'traces' && traceCreateError) { db.traces.push({ ...doc }); throw traceCreateError; }
    db[name].push({ ...doc }); return { ...doc };
  },
  updateOne: async (q, u) => { if (!db[name].find((r) => match(r, q))) db[name].push({ ...u.$setOnInsert }); },
});
mock.module('../src/models/Trace.js', { defaultExport: fakeModel('traces') });
mock.module('../src/models/Span.js', { defaultExport: fakeModel('spans') });
mock.module('../src/models/Service.js', { defaultExport: fakeModel('services') });
mock.module('../src/models/Error.js', { defaultExport: fakeModel('errors') });
mock.module('../src/config/env.js', { defaultExport: { nodeEnv: 'test' } });

const { recordHttpSpan } = await import('../src/services/tracingService.js');
const t0 = new Date('2026-09-30T16:00:00.000Z');
const req = (o) => ({ serviceName: 'svc', method: 'GET', path: '/api/missions', startTime: t0, endTime: new Date(t0.getTime() + 37), statusCode: 200, ...o });

test('new trace id: creates root trace + root span with matching duration/status', async () => {
  await recordHttpSpan(req({ traceId: 'tr_new', spanId: 'sp_new' }));
  const trace = db.traces.find((t) => t.traceId === 'tr_new');
  const span = db.spans.find((s) => s.spanId === 'sp_new');
  assert.deepEqual([trace.rootService, trace.route, trace.method, trace.duration, trace.status], ['svc', '/api/missions', 'GET', 37, 'success']);
  assert.deepEqual([span.traceId, span.parentSpanId, span.operation, span.duration, span.status], ['tr_new', null, 'GET /api/missions', 37, 'success']);
});
test('existing trace: span added, trace document untouched', async () => {
  const before = JSON.stringify(db.traces.find((t) => t.traceId === 'tr_test_001'));
  const tracesBefore = db.traces.length;
  await recordHttpSpan(req({ traceId: 'tr_test_001', spanId: 'sp_a' }));
  assert.equal(db.traces.length, tracesBefore);
  assert.equal(JSON.stringify(db.traces.find((t) => t.traceId === 'tr_test_001')), before);
  assert.equal(db.spans.find((s) => s.spanId === 'sp_a').traceId, 'tr_test_001');
});
test('valid parent is stored as parentSpanId', async () => {
  await recordHttpSpan(req({ traceId: 'tr_test_001', spanId: 'sp_b', parentSpanId: 'sp_test_gateway' }));
  assert.equal(db.spans.find((s) => s.spanId === 'sp_b').parentSpanId, 'sp_test_gateway');
});
test('4xx and 5xx => error span + error document tied to trace and service', async () => {
  for (const [code, id] of [[404, 'sp_404'], [500, 'sp_500']]) {
    await recordHttpSpan(req({ traceId: 'tr_test_001', spanId: id, statusCode: code }));
    assert.equal(db.spans.find((s) => s.spanId === id).status, 'error');
  }
  const err = db.errors.find((e) => e.errorType === 'HTTP 404');
  assert.equal(err.traceId, 'tr_test_001');
  assert.equal(err.serviceName, 'svc');
});
test('3xx => success', async () => {
  await recordHttpSpan(req({ traceId: 'tr_test_001', spanId: 'sp_302', statusCode: 302 }));
  assert.equal(db.spans.find((s) => s.spanId === 'sp_302').status, 'success');
});
test('parent that does not exist or belongs to another trace is rejected, nothing stored', async () => {
  const spans = db.spans.length;
  await assert.rejects(recordHttpSpan(req({ traceId: 'tr_test_001', spanId: 'sp_c', parentSpanId: 'sp_missing' })), (e) => e.statusCode === 404);
  await assert.rejects(recordHttpSpan(req({ traceId: 'tr_test_001', spanId: 'sp_d', parentSpanId: 'sp_elsewhere' })), (e) => e.statusCode === 400);
  assert.equal(db.spans.length, spans);
});
test('parent given for an unknown trace: rejected and no orphan trace created', async () => {
  const traces = db.traces.length;
  await assert.rejects(recordHttpSpan(req({ traceId: 'tr_unknown', spanId: 'sp_e', parentSpanId: 'sp_test_gateway' })), (e) => e.statusCode === 404);
  assert.equal(db.traces.length, traces);
});
test('race: trace created concurrently (duplicate key) is tolerated', async () => {
  traceCreateError = Object.assign(new Error('E11000'), { code: 11000 });
  await recordHttpSpan(req({ traceId: 'tr_race', spanId: 'sp_race' }));
  traceCreateError = null;
  assert.ok(db.spans.find((s) => s.spanId === 'sp_race'));
});
