// Unit test of the middleware with a fake req/res (no Express, no MongoDB). Run: npm run test:logic
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

mock.module('../src/config/database.js', { namedExports: { isDatabaseConnected: () => true } });
mock.module('../src/config/env.js', { defaultExport: { serviceName: 'svc', traceIgnorePaths: ['/api/health'] } });
mock.module('../src/services/tracingService.js', { namedExports: { recordHttpSpan: async () => {} } });

const { createTracingMiddleware } = await import('../src/middleware/tracingMiddleware.js');

function run({ method = 'GET', url = '/api/missions?x=1', headers = {}, statusCode = 200, record, ready = true, aborted = false }) {
  const calls = [];
  const logs = [];
  const mw = createTracingMiddleware({
    record: record || (async (d) => { calls.push(d); }),
    isDatabaseReady: () => ready,
    serviceName: 'svc',
    ignorePaths: ['/api/health'],
    logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  });
  const req = { method, originalUrl: url, path: url.split('?')[0], headers };
  const res = Object.assign(new EventEmitter(), { statusCode, writableFinished: !aborted, headers: {}, setHeader(k, v) { this.headers[k] = v; } });
  let nextCalls = 0;
  mw(req, res, () => { nextCalls += 1; });
  res.emit(aborted ? 'close' : 'finish');
  if (!aborted) res.emit('close');
  return { calls, logs, res, nextCalls };
}
const tick = () => new Promise((r) => setImmediate(r));

test('no x-trace-id: generates ids and sets response headers', async () => {
  const { calls, res, nextCalls } = run({});
  await tick();
  assert.equal(nextCalls, 1);
  assert.match(res.headers['x-trace-id'], /^tr_[0-9a-f]{16}$/);
  assert.match(res.headers['x-span-id'], /^sp_[0-9a-f]{12}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].traceId, res.headers['x-trace-id']);
  assert.equal(calls[0].spanId, res.headers['x-span-id']);
  assert.equal(calls[0].parentSpanId, null);
  assert.equal(calls[0].path, '/api/missions');
});
test('x-trace-id and x-parent-span-id are reused', async () => {
  const { calls, res } = run({ headers: { 'x-trace-id': 'tr_test_manual', 'x-parent-span-id': 'sp_test_gateway' } });
  await tick();
  assert.equal(res.headers['x-trace-id'], 'tr_test_manual');
  assert.equal(calls[0].traceId, 'tr_test_manual');
  assert.equal(calls[0].parentSpanId, 'sp_test_gateway');
});
test('unsafe header values are ignored, not trusted', async () => {
  const { res } = run({ headers: { 'x-trace-id': 'bad id; $where' } });
  assert.match(res.headers['x-trace-id'], /^tr_[0-9a-f]{16}$/);
});
test('malformed x-parent-span-id (e.g. unresolved Postman {{variable}}) is logged, not silently dropped', async () => {
  const { calls, logs, nextCalls } = run({ headers: { 'x-trace-id': 'tr_test_manual', 'x-parent-span-id': '{{parentSpan}}' } });
  await tick();
  assert.equal(nextCalls, 1);
  assert.equal(calls[0].parentSpanId, null);
  assert.ok(logs.some((l) => /invalid x-parent-span-id/.test(l) && /\{\{parentSpan\}\}/.test(l)));
});
test('valid headers produce no warnings', async () => {
  const { logs } = run({ headers: { 'x-trace-id': 'tr_9df0dd5e3db554a1', 'x-parent-span-id': 'sp_598ec9bc9a86' } });
  await tick();
  assert.equal(logs.length, 0);
});
test('health check and OPTIONS are not traced', async () => {
  for (const o of [{ url: '/api/health' }, { url: '/api/health/db' }, { method: 'OPTIONS' }]) {
    const { calls, res, nextCalls } = run(o);
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(res.headers['x-trace-id'], undefined);
    assert.equal(nextCalls, 1);
  }
});
test('status code is passed through for the service to classify', async () => {
  const { calls } = run({ statusCode: 404 });
  await tick();
  assert.equal(calls[0].statusCode, 404);
});
test('storage failure is logged and does not break the request', async () => {
  const { logs, nextCalls } = run({ record: async () => { throw new Error('mongo down'); } });
  await tick();
  assert.equal(nextCalls, 1);
  assert.ok(logs.some((l) => /mongo down/.test(l)));
});
test('synchronous record failure is also swallowed', async () => {
  const { logs } = run({ record: () => { throw new Error('boom'); } });
  await tick();
  assert.ok(logs.some((l) => /boom/.test(l)));
});
test('database not connected: skipped with a warning', async () => {
  const { calls, logs, nextCalls } = run({ ready: false });
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(nextCalls, 1);
  assert.ok(logs.length === 1);
});
test('aborted request is recorded once, flagged aborted', async () => {
  const { calls } = run({ aborted: true });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].aborted, true);
});
