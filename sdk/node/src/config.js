import { ID_PATTERN } from './ids.js'

export class PulseTraceConfigError extends Error {
  constructor(problems) {
    super(`Invalid PulseTrace configuration: ${problems.join('; ')}`)
    this.name = 'PulseTraceConfigError'
    this.problems = problems
  }
}

export const INGEST_PATH = '/api/telemetry/batch'
const SILENT = { warn() {}, error() {} }
const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0

/**
 * Validates and normalizes the options passed to `new PulseTrace(...)`.
 * Required: endpoint, projectId, serviceName. Throws PulseTraceConfigError listing every problem.
 */
export function resolveConfig(options) {
  const problems = []
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new PulseTraceConfigError(['options object is required ({ endpoint, projectId, serviceName })'])
  }
  const o = options

  let endpoint
  if (!isNonEmptyString(o.endpoint)) problems.push('endpoint is required (e.g. "http://localhost:5000")')
  else {
    try {
      const url = new URL(o.endpoint.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.push('endpoint must start with http:// or https://')
      else endpoint = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
    } catch { problems.push(`endpoint is not a valid URL: ${JSON.stringify(o.endpoint)}`) }
  }

  const projectId = isNonEmptyString(o.projectId) ? o.projectId.trim() : undefined
  if (!projectId) problems.push('projectId is required (e.g. "api-suite")')
  else if (!ID_PATTERN.test(projectId)) problems.push('projectId may only contain letters, digits, ".", "_" and "-" (max 64 characters)')

  const serviceName = isNonEmptyString(o.serviceName) ? o.serviceName.trim() : undefined
  if (!serviceName) problems.push('serviceName is required')
  else if (serviceName.length > 128) problems.push('serviceName must be at most 128 characters')

  let environment = process.env.NODE_ENV || 'development'
  if (o.environment !== undefined) {
    if (!isNonEmptyString(o.environment) || o.environment.trim().length > 64) problems.push('environment must be a non-empty string (max 64 characters)')
    else environment = o.environment.trim()
  }

  let timeout = 5000
  if (o.timeout !== undefined) {
    if (typeof o.timeout !== 'number' || !Number.isFinite(o.timeout) || o.timeout <= 0 || o.timeout > 60000) problems.push('timeout must be a number of milliseconds between 1 and 60000')
    else timeout = o.timeout
  }

  const numberOption = (name, fallback, min, max) => {
    let value = fallback
    if (o[name] !== undefined) {
      if (typeof o[name] !== 'number' || !Number.isFinite(o[name]) || o[name] < min || o[name] > max) {
        problems.push(`${name} must be a number between ${min} and ${max}`)
      } else value = o[name]
    }
    return value
  }

  // const batchSize = numberOption('batchSize', 20, 1, 500)
  // const flushInterval = numberOption('flushInterval', 1000, 10, 60000)
  // const maxQueueSize = numberOption('maxQueueSize', 5000, 1, 100000)
  // const maxRetries = numberOption('maxRetries', 2, 0, 5)
  // const retryDelay = numberOption('retryDelay', 250, 0, 60000)

  const batchSize = numberOption('batchSize', 20, 1, 500)
  const flushInterval = numberOption('flushInterval', 25, 10, 60000)
  const maxQueueSize = numberOption('maxQueueSize', 5000, 1, 100000)
  const maxRetries = numberOption('maxRetries', 1, 0, 5)
  const retryDelay = numberOption('retryDelay', 10, 0, 60000)

  let enabled = true
  if (o.enabled !== undefined) {
    if (typeof o.enabled !== 'boolean') problems.push('enabled must be a boolean')
    else enabled = o.enabled
  }

  let ignorePaths = []
  if (o.ignorePaths !== undefined) {
    if (!Array.isArray(o.ignorePaths) || o.ignorePaths.some(p => typeof p !== 'string' || !p.startsWith('/'))) problems.push('ignorePaths must be an array of path prefixes starting with "/"')
    else ignorePaths = [...o.ignorePaths]
  }

  let logger = console
  if (o.logger === false || o.logger === null) logger = SILENT
  else if (o.logger !== undefined) {
    if (typeof o.logger?.warn !== 'function' || typeof o.logger?.error !== 'function') problems.push('logger must provide warn() and error() (or be false to silence the SDK)')
    else logger = o.logger
  }

  if (o.onError !== undefined && typeof o.onError !== 'function') problems.push('onError must be a function')

  const fetchImpl = o.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') problems.push('no fetch implementation available (use Node 18+ or pass options.fetch)')

  if (problems.length) throw new PulseTraceConfigError(problems)
  return Object.freeze({
    endpoint, ingestUrl: `${endpoint}${INGEST_PATH}`, projectId, serviceName, environment, timeout, enabled,
    batchSize, flushInterval, maxQueueSize, maxRetries, retryDelay,
    ignorePaths: Object.freeze(ignorePaths), logger, onError: o.onError, fetch: fetchImpl,
  })
}
