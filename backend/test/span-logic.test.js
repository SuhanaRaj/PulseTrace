// Logic-level test of the span validation rules using in-memory fakes for the Mongoose models.
// It does NOT touch MongoDB. Run: npm run test:logic   (needs Node >= 22)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const db = { traces: [{ traceId: 'tr_test_001' }, { traceId: 'tr_other' }], spans: [], errors: [], services: [] };
const match = (row, q) => Object.entries(q).every(([k, v]) => row[k] === v);
const fakeModel = (name) => ({
  findOne: async (q) => db[name].find((r) => match(r, q)) || null,
  exists: async (q) => (db[name].find((r) => match(r, q)) ? { _id: 1 } : null),
  create: async (doc) => { db[name].push({ ...doc }); return { ...doc }; },
  updateOne: async (q, u) => { if (!db[name].find((r) => match(r, q))) db[name].push({ ...u.$setOnInsert }); },
});
mock.module('../src/models/Trace.js', { defaultExport: fakeModel('traces') });
mock.module('../src/models/Span.js', { defaultExport: fakeModel('spans') });
mock.module('../src/models/Service.js', { defaultExport: fakeModel('services') });
mock.module('../src/models/Error.js', { defaultExport: fakeModel('errors') });
mock.module('../src/config/env.js', { defaultExport: { nodeEnv: 'test' } });

const { recordSpan } = await import('../src/services/tracingService.js');

const base = { traceId: 'tr_test_001', status: 'success' };
const T = '2026-09-30T15:13:20.000Z';
const chain = [
  { spanId: 'sp_001_gateway', parentSpanId: null, serviceName: 'api-gateway', operation: 'GET /api/missions', startTime: T, endTime: '2026-09-30T15:13:20.050Z', duration: 50 },
  { spanId: 'sp_002_auth', parentSpanId: 'sp_001_gateway', serviceName: 'auth-service', operation: 'Fetch user', startTime: '2026-09-30T15:13:20.005Z', endTime: '2026-09-30T15:13:20.025Z', duration: 20 },
  { spanId: 'sp_003_mission', parentSpanId: 'sp_002_auth', serviceName: 'mission-service', operation: 'Fetch missions', startTime: '2026-09-30T15:13:20.010Z', endTime: '2026-09-30T15:13:20.045Z', duration: 35 },
  { spanId: 'sp_004_database', parentSpanId: 'sp_003_mission', serviceName: 'database', operation: 'Query missions', startTime: '2026-09-30T15:13:20.015Z', endTime: '2026-09-30T15:13:20.040Z', duration: 25 },
];

const rejects = async (data, status, pattern) => {
  const before = db.spans.length;
  await assert.rejects(recordSpan({ ...base, ...data }), (e) => e.statusCode === status && pattern.test(e.message));
  assert.equal(db.spans.length, before, 'invalid span must not be inserted');
};

test('creates the 4-span hierarchy', async () => {
  for (const s of chain) await recordSpan({ ...base, ...s });
  assert.deepEqual(db.spans.map((s) => [s.spanId, s.parentSpanId]), [
    ['sp_001_gateway', null], ['sp_002_auth', 'sp_001_gateway'], ['sp_003_mission', 'sp_002_auth'], ['sp_004_database', 'sp_003_mission'],
  ]);
});
test('missing trace -> 404', () => rejects({ traceId: 'tr_nope', spanId: 'sp_x', serviceName: 'a', operation: 'b', duration: 1 }, 404, /Trace not found/));
test('missing parent -> 404', () => rejects({ spanId: 'sp_bad', parentSpanId: 'sp_does_not_exist', serviceName: 'a', operation: 'b', duration: 1 }, 404, /Parent span not found/));
test('parent from another trace -> 400', async () => {
  db.spans.push({ spanId: 'sp_other_root', traceId: 'tr_other', parentSpanId: null });
  await rejects({ spanId: 'sp_cross', parentSpanId: 'sp_other_root', serviceName: 'a', operation: 'b', duration: 1 }, 400, /different trace/);
});
test('duplicate spanId -> 409', () => rejects({ ...chain[0] }, 409, /already exists/));
test('duration mismatch -> 400', () => rejects({ ...chain[1], spanId: 'sp_mismatch', duration: 999 }, 400, /does not match/));
test('endTime before startTime -> 400', () => rejects({ spanId: 'sp_neg', serviceName: 'a', operation: 'b', startTime: T, endTime: '2026-09-30T15:13:19.000Z' }, 400, /before startTime/));
