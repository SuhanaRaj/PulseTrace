import { AsyncLocalStorage } from 'node:async_hooks'
import { PulseTraceConfigError, resolveConfig } from './config.js'
import { createMiddleware, PARENT_SPAN_HEADER, SPAN_HEADER, TRACE_HEADER } from './middleware.js'
import { createTransport } from './transport.js'
import { performance } from 'node:perf_hooks'
import { generateSpanId, generateTraceId } from './ids.js'

const ERROR_LOG_INTERVAL_MS = 30000

export class PulseTrace {
  #storage = new AsyncLocalStorage() // per client instance: no global mutable state
  #captured = new WeakMap() // request -> error seen by errorHandler()
  #lastLoggedAt = 0
  #transport

  constructor(options) {
    this.config = resolveConfig(options)
    this.#transport = createTransport({
      ingestUrl: this.config.ingestUrl,
      timeout: this.config.timeout,
      fetch: this.config.fetch,
      batchSize: this.config.batchSize,
      flushInterval: this.config.flushInterval,
      maxQueueSize: this.config.maxQueueSize,
      maxRetries: this.config.maxRetries,
      retryDelay: this.config.retryDelay,
      reportError: error => this.#reportError(error),
    })
  }

  /** Express middleware: app.use(pulseTrace.middleware()). Register it before your routes. */
  middleware() {
    return createMiddleware({
      config: this.config, storage: this.#storage, captured: this.#captured, logger: this.config.logger,
      emit: batch => { this.#transport.enqueue(batch) },
    })
  }

  /**
   * Starts a manual/non-HTTP span.
   *
   * The span inherits the current AsyncLocalStorage trace and parent span when
   * called inside a traced request. Outside a request it creates a new trace.
   */
  startSpan(operation) {
    if (!this.config.enabled) return createNoopSpan()

    const name = typeof operation === 'string' && operation.trim()
      ? operation.trim()
      : 'manual'

    const parent = this.getContext()
    const traceId = parent?.traceId || generateTraceId()
    const parentSpanId = parent?.spanId || null
    const spanId = generateSpanId()
    const start = new Date()
    const started = performanceNow()

    let ended = false
    let status = 'success'
    let recordedError = null

    const end = () => {
      if (ended) return
      ended = true
      const duration = Math.max(0, Math.round(performanceNow() - started))
      const endTime = new Date(start.getTime() + duration)

      const span = {
        projectId: this.config.projectId,
        traceId,
        spanId,
        parentSpanId,
        serviceName: this.config.serviceName,
        environment: this.config.environment,
        operation: name,
        method: 'INTERNAL',
        route: name,
        status: status === 'error' ? 'error' : 'success',
        startTime: start.toISOString(),
        endTime: endTime.toISOString(),
        duration,
      }

      const errors = recordedError ? [{
        projectId: this.config.projectId,
        traceId,
        spanId,
        serviceName: this.config.serviceName,
        errorType: recordedError.name || 'Error',
        message: String(recordedError.message || recordedError),
        stackTrace: recordedError.stack || null,
        timestamp: endTime.toISOString(),
      }] : []

      this.#transport.enqueue({ spans: [span], errors })

      return span
    }

    return {
      traceId,
      spanId,
      parentSpanId,
      operation: name,
      recordError(error) {
        status = 'error'
        recordedError = error instanceof Error ? error : new Error(String(error))
        return this
      },
      end,
    }
  }

  /** Flush buffered telemetry. Safe to call from graceful shutdown handlers. */
  flush() {
    return this.#transport.flush()
  }

  /** Flush pending telemetry and stop the SDK transport timer. */
  shutdown(options) {
    return this.#transport.shutdown(options)
  }

  /** Optional Express error handler (register after your routes): records the thrown error + stack, then calls next(err). */
  errorHandler() {
    return (error, req, res, next) => {
      if (error && typeof error === 'object') this.#captured.set(req, error)
      next(error)
    }
  }

  /** Trace context of the request currently being handled (undefined outside a traced request). */
  getContext() {
    return this.#storage.getStore()
  }

  /** Headers to send on an outgoing call so the downstream service continues this trace. */
  getPropagationHeaders() {
    const context = this.getContext()
    return context ? { [TRACE_HEADER]: context.traceId, [PARENT_SPAN_HEADER]: context.spanId } : {}
  }

  #reportError(error) {
    try {
      if (this.config.onError) return this.config.onError(error)
      const now = Date.now()
      if (now - this.#lastLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        this.#lastLoggedAt = now
        this.config.logger.warn(`[pulsetrace] ${error.message}`)
      }
    } catch { /* reporting must never throw */ }
  }
}

export { PulseTraceConfigError, TRACE_HEADER, PARENT_SPAN_HEADER, SPAN_HEADER, generateTraceId, generateSpanId }
export default PulseTrace


function performanceNow() {
  return performance.now()
}

function createNoopSpan() {
  return {
    traceId: undefined,
    spanId: undefined,
    parentSpanId: undefined,
    operation: 'noop',
    recordError() { return this },
    end() { return undefined },
  }
}
