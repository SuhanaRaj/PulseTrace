// Project isolation: every read/write is scoped by projectId. Uses an in-memory fake of the Mongoose models
// (filters, $or/$exists, upsert, updateMany) - no MongoDB. Run: npm run test:logic
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- tiny in-memory Mongoose-like collections ---------- */
let seq = 1;
const store = { traces: [], spans: [], errors: [], services: [] };
const matches = (row, q) => Object.entries(q).every(([k, v]) => {
  if (k === '$or') return v.some((sub) => matches(row, sub));
  const val = row[k];
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('$exists' in v) return (val !== undefined) === v.$exists;
    if ('$in' in v) return v.$in.includes(val);
  }
  if (v === null) return val === null || val === undefined;
  return String(val) === String(v);
});
const wrap = (row) => ({
  ...row,
  toObject() { const { toObject, save, ...rest } = this; return { ...rest }; },
  async save() { const { toObject, save, ...rest } = this; Object.assign(row, rest); return this; },
});
const chain = (rows) => {
  let out = rows;
  const api = {
    sort(spec) { const [[key, dir]] = Object.entries(spec); out = [...out].sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0)); return api; },
    select() { return api; },
    skip(n) { out = out.slice(n); return api; },
    limit(n) { out = out.slice(0, n); return api; },
    then(resolve, reject) { return Promise.resolve(out.map(wrap)).then(resolve, reject); },
  };
  return api;
};
const collection = (name, unique = []) => ({
  find: (q = {}) => chain(store[name].filter((r) => matches(r, q))),
  findOne: async (q) => { const r = store[name].find((x) => matches(x, q)); return r ? wrap(r) : null; },
  exists: async (q) => (store[name].some((r) => matches(r, q)) ? { _id: 1 } : null),
  countDocuments: async (q = {}) => store[name].filter((r) => matches(r, q)).length,
  create: async (doc) => {
    for (const key of unique) if (store[name].some((r) => r[key] === doc[key])) throw Object.assign(new Error('E11000'), { code: 11000 });
    const row = { _id: `id${seq++}`, ...doc }; store[name].push(row); return wrap(row);
  },
  updateOne: async (q, update, opts = {}) => {
    const row = store[name].find((r) => matches(r, q));
    if (row) { Object.assign(row, update.$set || {}); return; }
    if (opts.upsert) store[name].push({ _id: `id${seq++}`, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
  },
  updateMany: async (q, update) => {
    const rows = store[name].filter((r) => matches(r, q));
    rows.forEach((r) => Object.assign(r, update.$set));
    return { matchedCount: rows.length, modifiedCount: rows.length };
  },
  findOneAndDelete: async (q) => { const i = store[name].findIndex((r) => matches(r, q)); return i < 0 ? null : wrap(store[name].splice(i, 1)[0]); },
  findOneAndUpdate: async (q, changes) => { const r = store[name].find((x) => matches(x, q)); if (!r) return null; Object.assign(r, changes); return wrap(r); },
  deleteMany: async (q) => { store[name] = store[name].filter((r) => !matches(r, q)); },
});
const env = { nodeEnv: 'test' };
mock.module('../src/config/env.js', { defaultExport: env });
mock.module('../src/config/database.js', { namedExports: { isDatabaseConnected: () => true } });
mock.module('../src/models/Trace.js', { defaultExport: collection('traces', ['traceId']) });
mock.module('../src/models/Span.js', { defaultExport: collection('spans', ['spanId']) });
mock.module('../src/models/Service.js', { defaultExport: collection('services') });
mock.module('../src/models/Error.js', { defaultExport: collection('errors') });

const { PROJECTS, isValidProjectId } = await import('../src/config/projects.js');
const { resolveProjectId } = await import('../src/utils/projectScope.js');
const tracing = await import('../src/services/tracingService.js');
const traceService = await import('../src/services/traceService.js');
const spanService = await import('../src/services/spanService.js');
const errorService = await import('../src/services/errorService.js');
const serviceService = await import('../src/services/serviceService.js');
const { getPerformance } = await import('../src/services/performanceService.js');
const { getServiceMap } = await import('../src/services/serviceMapService.js');
const { backfillProjectId, countUnmigrated } = await import('../src/services/projectMigration.js');
const { createTracingMiddleware } = await import('../src/middleware/tracingMiddleware.js');

const T = (ms) => new Date(Date.parse('2026-10-03T10:00:00.000Z') + ms);
const rejectsWith = (promise, status, re) => assert.rejects(promise, (e) => e.statusCode === status && (!re || re.test(e.message)));

/* ---------- fixture: PulseTrace seed-like data + API Suite data, both with a "database" service ---------- */
async function reset() {
  Object.keys(store).forEach((k) => { store[k] = []; });
  env.requireProjectId = false; env.projectId = undefined;
  // PulseTrace: gateway -> auth, gateway -> mission (error), durations small
  await tracing.startTrace({ projectId: 'pulsetrace', traceId: 'tr_p1', rootService: 'api-gateway', route: '/v1/missions/launch', method: 'POST', duration: 100, status: 'error', startTime: T(0) });
  await tracing.recordSpan({ traceId: 'tr_p1', spanId: 'sp_p_gw', serviceName: 'api-gateway', operation: 'POST /v1/missions/launch', startTime: T(0), endTime: T(100), status: 'error', errorMessage: 'Database connection timed out', errorType: 'DatabaseTimeout' });
  await tracing.recordSpan({ traceId: 'tr_p1', spanId: 'sp_p_auth', parentSpanId: 'sp_p_gw', serviceName: 'auth-service', operation: 'Validate token', startTime: T(10), endTime: T(40) });
  await tracing.recordSpan({ traceId: 'tr_p1', spanId: 'sp_p_db', parentSpanId: 'sp_p_gw', serviceName: 'database', operation: 'query', startTime: T(50), endTime: T(90) });
  // API Suite: api-suite -> database, much slower
  await tracing.startTrace({ projectId: 'api-suite', traceId: 'tr_a1', rootService: 'api-suite', route: '/orders', method: 'GET', duration: 5000, status: 'error', startTime: T(0) });
  await tracing.recordSpan({ projectId: 'api-suite', traceId: 'tr_a1', spanId: 'sp_a_root', serviceName: 'api-suite', operation: 'GET /orders', startTime: T(0), endTime: T(5000), status: 'error', errorMessage: 'Database connection timed out', errorType: 'DatabaseTimeout' });
  await tracing.recordSpan({ traceId: 'tr_a1', spanId: 'sp_a_db', parentSpanId: 'sp_a_root', serviceName: 'database', operation: 'query', startTime: T(10), endTime: T(4000) });
}

test('project definitions: exactly pulsetrace and api-suite', () => {
  assert.deepEqual(PROJECTS, [{ id: 'pulsetrace', name: 'PulseTrace' }, { id: 'api-suite', name: 'API Suite' }]);
  assert.ok(isValidProjectId('api-suite') && !isValidProjectId('nope') && !isValidProjectId(undefined));
});

test('resolveProjectId: valid, default, invalid and strict mode', async () => {
  await reset();
  assert.equal(resolveProjectId('api-suite'), 'api-suite');
  assert.equal(resolveProjectId(undefined), 'pulsetrace');
  assert.equal(resolveProjectId(''), 'pulsetrace');
  for (const bad of ['nope', 'PULSETRACE', ['pulsetrace', 'api-suite'], {}, 5]) assert.throws(() => resolveProjectId(bad), (e) => e.statusCode === 400 && /Invalid projectId/.test(e.message) && /pulsetrace, api-suite/.test(e.message));
  env.requireProjectId = true;
  assert.throws(() => resolveProjectId(undefined), (e) => e.statusCode === 400 && /required/.test(e.message));
  assert.equal(resolveProjectId('api-suite'), 'api-suite');
});

test('records carry the right projectId; spans/services/errors inherit it (never from serviceName)', async () => {
  await reset();
  assert.equal(store.traces.find((t) => t.traceId === 'tr_p1').projectId, 'pulsetrace');
  assert.equal(store.traces.find((t) => t.traceId === 'tr_a1').projectId, 'api-suite');
  assert.ok(store.spans.filter((s) => s.traceId === 'tr_p1').every((s) => s.projectId === 'pulsetrace'));
  assert.ok(store.spans.filter((s) => s.traceId === 'tr_a1').every((s) => s.projectId === 'api-suite'));
  assert.ok(store.errors.every((e) => e.projectId === (e.traceId === 'tr_p1' ? 'pulsetrace' : 'api-suite')));
  // "database" exists once per project, independently
  assert.deepEqual(store.services.filter((s) => s.name === 'database').map((s) => s.projectId).sort(), ['api-suite', 'pulsetrace']);
});

test('GET traces: each project sees only its own; default is pulsetrace; invalid is a 400', async () => {
  await reset();
  const p = await traceService.getAllTraces({ projectId: 'pulsetrace' });
  const a = await traceService.getAllTraces({ projectId: 'api-suite' });
  assert.deepEqual(p.data.map((t) => t.traceId), ['tr_p1']);
  assert.deepEqual(a.data.map((t) => t.traceId), ['tr_a1']);
  assert.equal(p.pagination.total, 1);
  assert.deepEqual((await traceService.getAllTraces({})).data.map((t) => t.traceId), ['tr_p1']);
  await rejectsWith(traceService.getAllTraces({ projectId: 'nope' }), 400, /Invalid projectId/);
});

test('trace, tree and spans cannot cross project boundaries', async () => {
  await reset();
  assert.equal((await traceService.getTrace('tr_a1', { projectId: 'api-suite' })).trace.traceId, 'tr_a1');
  await rejectsWith(traceService.getTrace('tr_a1', { projectId: 'pulsetrace' }), 404);
  await rejectsWith(traceService.getTrace('tr_a1', {}), 404); // default project is pulsetrace
  await rejectsWith(traceService.getTraceTree('tr_p1', { projectId: 'api-suite' }), 404);
  const tree = await traceService.getTraceTree('tr_a1', { projectId: 'api-suite' });
  assert.deepEqual(tree.spans.map((s) => [s.spanId, s.children.map((c) => c.spanId)]), [['sp_a_root', ['sp_a_db']]]);
  assert.deepEqual(await spanService.getTraceSpans('tr_a1', { projectId: 'pulsetrace' }), []);
  assert.equal((await spanService.getTraceSpans('tr_a1', { projectId: 'api-suite' })).length, 2);
});

test('writes: explicit project must match the trace; parents cannot cross projects', async () => {
  await reset();
  await rejectsWith(tracing.recordSpan({ projectId: 'pulsetrace', traceId: 'tr_a1', serviceName: 'x', operation: 'y', duration: 1 }), 404, /Trace not found/);
  await rejectsWith(tracing.recordSpan({ traceId: 'tr_a1', parentSpanId: 'sp_p_gw', serviceName: 'x', operation: 'y', duration: 1 }), 400, /different trace/);
  await rejectsWith(tracing.completeTrace('tr_a1', { projectId: 'pulsetrace' }), 404);
  await rejectsWith(tracing.finishSpan('sp_a_root', {}), 404); // default project is pulsetrace
  await rejectsWith(traceService.removeTrace('tr_a1', {}), 404);
  assert.ok(store.traces.some((t) => t.traceId === 'tr_a1'), 'api-suite trace must survive');
  assert.equal((await tracing.completeTrace('tr_a1', { projectId: 'api-suite' })).trace.projectId, 'api-suite');
});

test('a traceId owned by another project is never touched by automatic tracing', async () => {
  await reset();
  const before = JSON.stringify(store);
  await rejectsWith(tracing.recordHttpSpan({ projectId: 'pulsetrace', traceId: 'tr_a1', spanId: 'sp_x', serviceName: 'pulsetrace-backend', method: 'GET', path: '/x', startTime: T(0), endTime: T(5), statusCode: 200 }), 404);
  assert.equal(JSON.stringify(store.spans.filter((s) => s.spanId === 'sp_x')), '[]');
  assert.equal(store.traces.filter((t) => t.traceId === 'tr_a1').length, 1);
  assert.notEqual(before, undefined);
});

test('errors are project-scoped, including occurrenceCount grouping', async () => {
  await reset();
  const p = await errorService.getAllErrors({ projectId: 'pulsetrace' });
  const a = await errorService.getAllErrors({ projectId: 'api-suite' });
  assert.ok(p.data.length >= 1 && p.data.every((e) => e.projectId === 'pulsetrace'));
  assert.ok(a.data.length >= 1 && a.data.every((e) => e.projectId === 'api-suite'));
  // identical type+message exists in both projects (different services) but is counted per project
  assert.ok(p.data.concat(a.data).every((e) => e.occurrenceCount === 1));
  const apiSuiteError = a.data[0];
  await rejectsWith(errorService.getError(apiSuiteError.id, { projectId: 'pulsetrace' }), 404);
  assert.equal((await errorService.getError(apiSuiteError.id, { projectId: 'api-suite' })).projectId, 'api-suite');
  await rejectsWith(errorService.removeError(apiSuiteError.id, {}), 404);
  assert.equal((await errorService.getAllErrors({ projectId: 'api-suite' })).data.length, a.data.length);
});

test('addError: inherits the trace project, explicit mismatch is a 404, no trace falls back to the server project', async () => {
  await reset();
  const inherited = await errorService.addError({ traceId: 'tr_a1', serviceName: 'api-suite', errorType: 'Boom', message: 'bang' });
  assert.equal(inherited.projectId, 'api-suite');
  await rejectsWith(errorService.addError({ projectId: 'pulsetrace', traceId: 'tr_a1', serviceName: 's', errorType: 'E', message: 'm' }), 404);
  assert.equal((await errorService.addError({ serviceName: 's', errorType: 'E', message: 'm' })).projectId, 'pulsetrace');
  assert.equal((await errorService.addError({ projectId: 'api-suite', serviceName: 's', errorType: 'E', message: 'm' })).projectId, 'api-suite');
});

test('performance is computed only from the requested project', async () => {
  await reset();
  const p = await getPerformance({ projectId: 'pulsetrace' });
  const a = await getPerformance({ projectId: 'api-suite' });
  assert.equal(p.averageLatency, 100);
  assert.equal(a.averageLatency, 5000);
  assert.deepEqual(p.slowestEndpoints.map((e) => e.operation), ['POST /v1/missions/launch']);
  assert.deepEqual(a.slowestEndpoints.map((e) => e.operation), ['GET /orders']);
  assert.ok(!p.slowestServices.some((s) => s.serviceName === 'api-suite'));
  assert.ok(!a.slowestServices.some((s) => s.serviceName === 'api-gateway' || s.serviceName === 'auth-service'));
  const database = (r) => r.slowestServices.find((s) => s.serviceName === 'database');
  assert.equal(database(p).averageLatency, 40);
  assert.equal(database(a).averageLatency, 3990);
  assert.equal((await getPerformance({ projectId: 'pulsetrace' })).p99, 100);
  await rejectsWith(getPerformance({ projectId: 'nope' }), 400);
});

test('services are project-scoped (same name allowed in both projects)', async () => {
  await reset();
  const p = await serviceService.getServices({ projectId: 'pulsetrace' });
  const a = await serviceService.getServices({ projectId: 'api-suite' });
  assert.deepEqual(p.map((s) => s.name).sort(), ['api-gateway', 'auth-service', 'database']);
  assert.deepEqual(a.map((s) => s.name).sort(), ['api-suite', 'database']);
  assert.equal(p.find((s) => s.name === 'api-gateway').requestRate, 1);
  await rejectsWith(serviceService.getService(a[0].id, { projectId: 'pulsetrace' }), 404);
  const created = await serviceService.addService({ name: 'billing', environment: 'dev', status: 'healthy', projectId: 'api-suite' });
  assert.equal(created.projectId, 'api-suite');
  const moved = await serviceService.editService(created._id, { status: 'degraded', projectId: 'pulsetrace' }, { projectId: 'api-suite' });
  assert.equal(moved.projectId, 'api-suite', 'a service cannot be moved between projects through an update');
  await rejectsWith(serviceService.removeService(created._id, {}), 404);
});

test('service map: separate graphs, no cross-project nodes or edges', async () => {
  await reset();
  const p = await getServiceMap({ projectId: 'pulsetrace' });
  const a = await getServiceMap({ projectId: 'api-suite' });
  assert.deepEqual(p.edges.map((e) => e.id), ['api-gateway-auth-service', 'api-gateway-database']);
  assert.deepEqual(a.edges.map((e) => e.id), ['api-suite-database']);
  assert.deepEqual(p.nodes.map((n) => n.id).sort(), ['api-gateway', 'auth-service', 'database']);
  assert.deepEqual(a.nodes.map((n) => n.id).sort(), ['api-suite', 'database']);
  // the shared "database" name carries per-project metrics only
  assert.equal(p.nodes.find((n) => n.id === 'database').data.averageLatency, 40);
  assert.equal(a.nodes.find((n) => n.id === 'database').data.averageLatency, 3990);
});

test('empty project: zero traces, errors, services, empty map and performance', async () => {
  await reset();
  Object.keys(store).forEach((k) => { store[k] = store[k].filter((r) => r.projectId !== 'api-suite'); });
  assert.equal((await traceService.getAllTraces({ projectId: 'api-suite' })).pagination.total, 0);
  assert.equal((await errorService.getAllErrors({ projectId: 'api-suite' })).data.length, 0);
  assert.deepEqual(await serviceService.getServices({ projectId: 'api-suite' }), []);
  assert.deepEqual(await getServiceMap({ projectId: 'api-suite' }), { nodes: [], edges: [] });
  const perf = await getPerformance({ projectId: 'api-suite' });
  assert.deepEqual([perf.averageLatency, perf.p95, perf.slowestServices.length, perf.slowestEndpoints.length], [0, 0, 0, 0]);
});

test('automatic HTTP tracing: project is fixed per server and independent of the service name', async () => {
  await reset();
  const calls = [];
  const run = (opts) => {
    const mw = createTracingMiddleware({ record: async (d) => { calls.push(d); }, isDatabaseReady: () => true, ignorePaths: [], logger: console, ...opts });
    const handlers = {};
    const res = { statusCode: 200, writableFinished: true, setHeader() {}, once: (e, h) => { handlers[e] = h; } };
    mw({ method: 'GET', originalUrl: '/api/missions', path: '/api/missions', headers: {} }, res, () => {});
    handlers.finish();
  };
  run({ serviceName: 'api-suite' }); // service name looks like a project but must NOT decide it
  run({ serviceName: 'pulsetrace-backend', projectId: 'api-suite' });
  run({});
  assert.deepEqual(calls.map((c) => c.projectId), ['pulsetrace', 'api-suite', 'pulsetrace']);
  // end to end through the real service: lands in the configured project
  await tracing.recordHttpSpan({ projectId: 'pulsetrace', traceId: 'tr_http', spanId: 'sp_http', serviceName: 'pulsetrace-backend', method: 'GET', path: '/api/missions', startTime: T(0), endTime: T(12), statusCode: 404 });
  assert.equal(store.traces.find((t) => t.traceId === 'tr_http').projectId, 'pulsetrace');
  assert.equal(store.spans.find((s) => s.spanId === 'sp_http').projectId, 'pulsetrace');
  assert.ok(store.errors.some((e) => e.traceId === 'tr_http' && e.projectId === 'pulsetrace'));
  env.projectId = 'api-suite'; // PROJECT_ID configuration
  assert.equal(createTracingMiddleware({ ignorePaths: [] }) instanceof Function, true);
  env.projectId = 'bogus';
  assert.throws(() => createTracingMiddleware({ ignorePaths: [] }), /Invalid projectId/);
});

test('migration: backfills only documents without projectId, is idempotent and non-destructive', async () => {
  await reset();
  // legacy documents (no projectId) alongside already-tagged api-suite data
  store.traces.push({ _id: 'l1', traceId: 'tr_legacy', rootService: 'api-gateway', route: '/old', method: 'GET', duration: 1, status: 'success' });
  store.spans.push({ _id: 'l2', spanId: 'sp_legacy', traceId: 'tr_legacy', serviceName: 'api-gateway' });
  store.errors.push({ _id: 'l3', serviceName: 'api-gateway', errorType: 'E', message: 'old' });
  store.services.push({ _id: 'l4', name: 'notification-service', environment: 'development', status: 'healthy' });
  store.services.push({ _id: 'l5', projectId: null, name: 'auth-legacy', environment: 'development', status: 'healthy' });
  const models = { traces: (await import('../src/models/Trace.js')).default, spans: (await import('../src/models/Span.js')).default, errors: (await import('../src/models/Error.js')).default, services: (await import('../src/models/Service.js')).default };
  const counts = () => Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v.length]));
  const before = counts();
  const apiSuiteBefore = JSON.stringify(Object.values(store).flat().filter((r) => r.projectId === 'api-suite'));

  assert.deepEqual(await countUnmigrated(models), { traces: 1, spans: 1, errors: 1, services: 2 });
  const dry = await backfillProjectId(models, { dryRun: true });
  assert.deepEqual(Object.values(dry).map((r) => [r.matched, r.modified]), [[1, 0], [1, 0], [1, 0], [2, 0]]);
  assert.deepEqual(await countUnmigrated(models), { traces: 1, spans: 1, errors: 1, services: 2 }, 'dry run changes nothing');

  const first = await backfillProjectId(models);
  assert.deepEqual(Object.values(first).map((r) => r.modified), [1, 1, 1, 2]);
  assert.deepEqual(await countUnmigrated(models), { traces: 0, spans: 0, errors: 0, services: 0 });
  assert.equal(store.traces.find((t) => t.traceId === 'tr_legacy').projectId, 'pulsetrace');

  const second = await backfillProjectId(models); // idempotent
  assert.deepEqual(Object.values(second).map((r) => r.modified), [0, 0, 0, 0]);
  assert.deepEqual(counts(), before, 'nothing deleted or duplicated');
  assert.equal(JSON.stringify(Object.values(store).flat().filter((r) => r.projectId === 'api-suite')), apiSuiteBefore, 'existing projectIds untouched');
  // after migration the legacy data is visible under PulseTrace and invisible under API Suite
  assert.ok((await traceService.getAllTraces({ projectId: 'pulsetrace', limit: 100 })).data.some((t) => t.traceId === 'tr_legacy'));
  assert.ok(!(await traceService.getAllTraces({ projectId: 'api-suite', limit: 100 })).data.some((t) => t.traceId === 'tr_legacy'));
});
