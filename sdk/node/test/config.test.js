import test from 'node:test'
import assert from 'node:assert/strict'
import { PulseTrace, PulseTraceConfigError } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

const valid = { endpoint: 'http://localhost:5000', projectId: 'api-suite', serviceName: 'api-suite', environment: 'development' }

test('valid configuration is accepted and normalized', () => {
  const pt = new PulseTrace(valid)
  assert.equal(pt.config.endpoint, 'http://localhost:5000')
  assert.equal(pt.config.ingestUrl, 'http://localhost:5000/api/telemetry/batch')
  assert.deepEqual([pt.config.projectId, pt.config.serviceName, pt.config.environment], ['api-suite', 'api-suite', 'development'])
  assert.deepEqual([pt.config.timeout, pt.config.enabled, pt.config.ignorePaths.length], [5000, true, 0])
})

test('trailing slashes are removed and a path prefix is kept', () => {
  assert.equal(resolveConfig({ ...valid, endpoint: 'http://localhost:5000///' }).ingestUrl, 'http://localhost:5000/api/telemetry/batch')
  assert.equal(resolveConfig({ ...valid, endpoint: 'https://example.com/pulse/' }).ingestUrl, 'https://example.com/pulse/api/telemetry/batch')
})

test('environment is optional (defaults to NODE_ENV or "development") and values are trimmed', () => {
  const { environment, ...withoutEnv } = valid
  assert.equal(resolveConfig(withoutEnv).environment, process.env.NODE_ENV || 'development')
  assert.equal(resolveConfig({ ...valid, projectId: ' api-suite ', serviceName: ' svc ', environment: ' staging ' }).environment, 'staging')
  assert.equal(resolveConfig({ ...valid, projectId: ' api-suite ' }).projectId, 'api-suite')
})

test('endpoint, projectId and serviceName are required', () => {
  for (const field of ['endpoint', 'projectId', 'serviceName']) {
    const options = { ...valid }
    delete options[field]
    assert.throws(() => new PulseTrace(options), e => e instanceof PulseTraceConfigError && e.problems.some(p => p.startsWith(`${field} is required`)), field)
    assert.throws(() => new PulseTrace({ ...valid, [field]: '   ' }), PulseTraceConfigError)
    assert.throws(() => new PulseTrace({ ...valid, [field]: 42 }), PulseTraceConfigError)
  }
})

test('every problem is reported at once', () => {
  assert.throws(() => new PulseTrace({}), e => e.problems.length === 3 && /endpoint.*projectId.*serviceName/.test(e.message))
})

test('invalid configuration is rejected', () => {
  const cases = [
    [undefined, /options object is required/], [null, /options object is required/], ['http://x', /options object is required/], [[], /options object is required/],
    [{ ...valid, endpoint: 'not a url' }, /not a valid URL/], [{ ...valid, endpoint: 'ftp://localhost' }, /http:\/\/ or https:\/\//],
    [{ ...valid, projectId: 'bad id!' }, /projectId may only contain/], [{ ...valid, projectId: 'x'.repeat(65) }, /projectId may only contain/],
    [{ ...valid, serviceName: 'x'.repeat(129) }, /at most 128/], [{ ...valid, environment: '' }, /environment must be/],
    [{ ...valid, timeout: 0 }, /timeout/], [{ ...valid, timeout: '5s' }, /timeout/], [{ ...valid, timeout: 999999 }, /timeout/],
    [{ ...valid, enabled: 'yes' }, /enabled must be a boolean/], [{ ...valid, ignorePaths: 'health' }, /ignorePaths/], [{ ...valid, ignorePaths: ['health'] }, /ignorePaths/],
    [{ ...valid, logger: {} }, /logger must provide/], [{ ...valid, onError: 'nope' }, /onError must be a function/], [{ ...valid, fetch: 'nope' }, /no fetch implementation/],
  ]
  for (const [options, pattern] of cases) assert.throws(() => resolveConfig(options), e => e instanceof PulseTraceConfigError && pattern.test(e.message), String(pattern))
})

test('options are copied: mutating the caller object afterwards does not change the client', () => {
  const options = { ...valid, ignorePaths: ['/health'] }
  const pt = new PulseTrace(options)
  options.ignorePaths.push('/x'); options.projectId = 'pulsetrace'
  assert.deepEqual([...pt.config.ignorePaths], ['/health'])
  assert.equal(pt.config.projectId, 'api-suite')
  assert.throws(() => { pt.config.projectId = 'other' }, TypeError) // frozen (ESM is strict mode)
})

test('logger:false silences the SDK', () => {
  const quiet = resolveConfig({ ...valid, logger: false }).logger
  assert.doesNotThrow(() => { quiet.warn('x'); quiet.error('y') })
})
