// Operation-name normalization: HTTP spans must not produce "GET GET /path" in the Performance API.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const db = { traces: [], spans: [], errors: [], services: [] };
const match = (row, q) => Object.entries(q).every(([k, v]) => row[k] === v);
const fakeModel = (name) => ({
  findOne: async (q) => db[name].find((r) => match(r, q)) || null,
  exists: async (q) => (db[name].find((r) => match(r, q)) ? { _id: 1 } : null),
  find: () => ({ select: async () => db[name] }),
  create: async (doc) => { db[name].push({ ...doc }); return { ...doc }; },
  updateOne: async (q, u) => { if (!db[name].find((r) => match(r, q))) db[name].push({ ...u.$setOnInsert }); },
});
mock.module('../src/models/Trace.js', { defaultExport: fakeModel('traces') });
mock.module('../src/models/Span.js', { defaultExport: fakeModel('spans') });
mock.module('../src/models/Service.js', { defaultExport: fakeModel('services') });
mock.module('../src/models/Error.js', { defaultExport: fakeModel('errors') });
mock.module('../src/config/env.js', { defaultExport: { nodeEnv: 'test' } });

const { recordHttpSpan, startTrace, recordSpan } = await import('../src/services/tracingService.js');
const { getPerformance } = await import('../src/services/performanceService.js');
const t0 = new Date('2026-10-01T10:00:00.000Z');

test('HTTP span: trace.route is the path, span.operation is "METHOD path"', async () => {
  await recordHttpSpan({ traceId: 'tr_h', spanId: 'sp_h', serviceName: 'api-gateway', method: 'GET', path: '/api/missions', startTime: t0, endTime: new Date(t0.getTime() + 20), statusCode: 200 });
  const trace = db.traces.find((t) => t.traceId === 'tr_h');
  assert.equal(trace.route, '/api/missions');
  assert.equal(trace.method, 'GET');
  assert.equal(db.spans.find((s) => s.spanId === 'sp_h').operation, 'GET /api/missions');
});

test('manually created trace/span (seed convention) is unchanged', async () => {
  await startTrace({ traceId: 'tr_m', rootService: 'api-gateway', route: '/v1/missions/launch', method: 'POST', duration: 100, status: 'success' });
  await recordSpan({ traceId: 'tr_m', spanId: 'sp_m', serviceName: 'api-gateway', operation: 'POST /v1/missions/launch', duration: 100 });
  assert.equal(db.traces.find((t) => t.traceId === 'tr_m').route, '/v1/missions/launch');
  assert.equal(db.spans.find((s) => s.spanId === 'sp_m').operation, 'POST /v1/missions/launch');
});

test('Performance API endpoints are "METHOD path" with no duplicated method', async () => {
  const { slowestEndpoints } = await getPerformance();
  const names = slowestEndpoints.map((e) => e.operation).sort();
  assert.deepEqual(names, ['GET /api/missions', 'POST /v1/missions/launch']);
  assert.ok(!names.some((n) => /^([A-Z]+) \1 /.test(n)));
});
