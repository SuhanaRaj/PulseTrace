import * as tracing from '../services/tracingService.js';

/**
 * Reusable in-process tracer. Persists to MongoDB via the tracing service.
 *
 *   const trace = await tracer.startTrace({ rootService: 'api-gateway', route: '/api/missions', method: 'GET' });
 *   const root  = await trace.startSpan({ serviceName: 'api-gateway', operation: 'GET /api/missions' });
 *   const auth  = await trace.startSpan({ serviceName: 'auth-service', operation: 'verify', parent: root });
 *   await auth.end();
 *   await root.end();
 *   await trace.end();
 *
 * or, with automatic timing + error capture:
 *
 *   await trace.withSpan({ serviceName: 'mission-service', operation: 'load', parent: root }, async (span) => {...});
 */
class SpanHandle {
  constructor(traceId, doc) {
    this.traceId = traceId;
    this.spanId = doc.spanId;
    this.doc = doc;
  }

  end({ status = 'success', error } = {}) {
    return tracing.finishSpan(this.spanId, { projectId: this.doc.projectId, status, error: serialize(error) });
  }

  fail(error) {
    return this.end({ status: 'error', error });
  }
}

class TraceHandle {
  constructor(doc) {
    this.traceId = doc.traceId;
    this.doc = doc;
  }

  async startSpan({ serviceName, operation, parent, parentSpanId }) {
    const doc = await tracing.recordSpan({
      projectId: this.doc.projectId,
      traceId: this.traceId,
      serviceName,
      operation,
      parentSpanId: parent?.spanId || parentSpanId || null,
      startTime: new Date(),
    });
    return new SpanHandle(this.traceId, doc);
  }

  async withSpan(options, fn) {
    const span = await this.startSpan(options);
    try {
      const result = await fn(span);
      await span.end();
      return result;
    } catch (error) {
      await span.fail(error);
      throw error;
    }
  }

  end(options) {
    return tracing.completeTrace(this.traceId, { ...options, projectId: this.doc.projectId });
  }
}

function serialize(error) {
  if (!error) return undefined;
  return { type: error.name || 'Error', message: error.message || String(error), stack: error.stack || null };
}

export const tracer = {
  async startTrace(options) {
    return new TraceHandle(await tracing.startTrace(options));
  },
};

export default tracer;
