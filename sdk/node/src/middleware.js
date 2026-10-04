import { performance } from 'node:perf_hooks'
import { ID_PATTERN, generateSpanId, generateTraceId } from './ids.js'

export const TRACE_HEADER = 'x-trace-id'
export const PARENT_SPAN_HEADER = 'x-parent-span-id'
export const SPAN_HEADER = 'x-span-id'

function readId(headers, name, logger) {
  const raw = headers[name]
  if (raw === undefined) return null
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (ID_PATTERN.test(value)) return value
  logger.warn(`[pulsetrace] ignoring invalid ${name} header: ${JSON.stringify(raw)}`)
  return null
}

const pathOf = req => (req.originalUrl || req.url || '/').split('?')[0] || '/'

// Express route pattern when known ("/api/users/:id") so spans of the same endpoint group together; otherwise the path.
export function resolveRoute(req) {
  const pattern = req.route && typeof req.route.path === 'string' ? req.route.path : null
  if (pattern === null) return pathOf(req)
  const joined = `${typeof req.baseUrl === 'string' ? req.baseUrl : ''}${pattern}`.replace(/\/{2,}/g, '/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined || '/'
}

/**
 * Builds the Express/Connect-style middleware for a PulseTrace client.
 * Never throws and never delays the response: telemetry is sent after the response has finished.
 */
export function createMiddleware(client) {
  const { config, storage, emit, captured, logger } = client
  const shouldSkip = req => req.method === 'OPTIONS' || config.ignorePaths.some(p => pathOf(req) === p || pathOf(req).startsWith(`${p}/`))

  return function pulseTraceMiddleware(req, res, next) {
    let context = null
    try {
      if (config.enabled && !shouldSkip(req)) {
        const traceId = readId(req.headers, TRACE_HEADER, logger) || generateTraceId()
        const parentSpanId = readId(req.headers, PARENT_SPAN_HEADER, logger)
        const spanId = generateSpanId()
        const startTime = new Date()
        const started = performance.now()
        context = Object.freeze({ traceId, spanId, parentSpanId, projectId: config.projectId, serviceName: config.serviceName, environment: config.environment, startTime })

        res.setHeader(TRACE_HEADER, traceId)
        res.setHeader(SPAN_HEADER, spanId)

        // Snapshot the route when the response starts (Express still knows baseUrl + route pattern at that point).
        let route = null
        const writeHead = res.writeHead
        res.writeHead = function patchedWriteHead(...args) {
          try { if (route === null) route = resolveRoute(req) } catch { /* fall back at finish */ }
          return writeHead.apply(this, args)
        }

        let done = false
        const finalize = aborted => {
          if (done) return
          done = true
          try {
            const duration = Math.max(0, Math.round(performance.now() - started))
            const endTime = new Date(startTime.getTime() + duration)
            const resolvedRoute = route ?? resolveRoute(req)
            const method = String(req.method || 'GET').toUpperCase()
            const operation = `${method} ${resolvedRoute}`
            const statusCode = res.statusCode
            const failed = aborted || statusCode >= 400
            const thrown = captured.get(req)
            const span = {
              traceId, spanId, parentSpanId, projectId: config.projectId, serviceName: config.serviceName, environment: config.environment,
              operation, method, route: resolvedRoute, status: failed ? 'error' : 'success',
              startTime: startTime.toISOString(), endTime: endTime.toISOString(), duration,
            }
            const errors = failed || thrown ? [{
              traceId, spanId, projectId: config.projectId, serviceName: config.serviceName,
              errorType: thrown ? (thrown.name || 'Error') : `HTTP ${statusCode}`,
              message: thrown ? String(thrown.message || thrown) : aborted ? `${operation} aborted: client closed the connection before the response completed` : `${operation} responded with ${statusCode}`,
              stackTrace: thrown?.stack || null, timestamp: endTime.toISOString(),
            }] : []
            if (thrown && !failed) span.status = 'error'
            emit({ spans: [span], errors })
          } catch (error) {
            logger.error(`[pulsetrace] failed to record span ${spanId}: ${error.message}`)
          }
        }
        res.once('finish', () => finalize(false))
        res.once('close', () => finalize(!res.writableFinished))
      }
    } catch (error) {
      context = null
      logger.error(`[pulsetrace] middleware error (request continues untraced): ${error.message}`)
    }
    // Downstream handlers (and everything they await) can read the context through client.getContext().
    return context ? storage.run(context, () => next()) : next()
  }
}
