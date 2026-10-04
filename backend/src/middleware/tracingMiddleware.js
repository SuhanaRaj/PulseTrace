import { isDatabaseConnected } from '../config/database.js';
import env from '../config/env.js';
import { recordHttpSpan } from '../services/tracingService.js';
import { generateSpanId, generateTraceId } from '../utils/ids.js';
import { serverProjectId } from '../utils/projectScope.js';

// Incoming header values are untrusted: accept only short, safe identifiers.
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// Returns the header value if it is a valid id, otherwise null. A header that is present but
// rejected is logged, so a dropped x-parent-span-id / x-trace-id is never silent.
function readId(req, name, logger) {
  const raw = req.headers[name];
  if (raw === undefined) return null;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (ID_PATTERN.test(value)) return value;
  logger.warn(`[tracing] ignoring invalid ${name} header (expected ${ID_PATTERN}): ${JSON.stringify(raw)}`);
  return null;
}

/**
 * Factory (dependencies injectable so it can be unit tested).
 * The middleware never throws and never waits for the database: the response is
 * not delayed and not affected by tracing failures. Storage happens after the
 * response has finished, and any failure is only logged.
 */
export function createTracingMiddleware({
  record = recordHttpSpan,
  isDatabaseReady = isDatabaseConnected,
  serviceName = env.serviceName,
  projectId = serverProjectId(), // fixed per server (PROJECT_ID), never derived from the service name
  ignorePaths = env.traceIgnorePaths,
  logger = console,
} = {}) {
  const shouldSkip = (req) =>
    req.method === 'OPTIONS' || ignorePaths.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));

  return function tracingMiddleware(req, res, next) {
    try {
      if (!shouldSkip(req)) {
        const traceId = readId(req, 'x-trace-id', logger) || generateTraceId();
        const parentSpanId = readId(req, 'x-parent-span-id', logger);
        const spanId = generateSpanId();
        const startTime = new Date();

        // Headers are set up front so downstream services can continue the trace.
        res.setHeader('x-trace-id', traceId);
        res.setHeader('x-span-id', spanId);

        let done = false;
        const finalize = (aborted) => {
          if (done) return;
          done = true;
          try {
            if (!isDatabaseReady()) {
              logger.warn(`[tracing] database not connected, span ${spanId} not stored`);
              return;
            }
            const path = (req.originalUrl || req.url || '').split('?')[0];
            record({
              projectId, traceId, spanId, parentSpanId, serviceName,
              method: req.method, path, startTime, endTime: new Date(), statusCode: res.statusCode, aborted,
            }).catch((error) => logger.error(`[tracing] failed to store span ${spanId} (trace ${traceId}): ${error.message}`));
          } catch (error) {
            logger.error(`[tracing] failed to store span ${spanId}: ${error.message}`);
          }
        };

        res.once('finish', () => finalize(false));
        res.once('close', () => finalize(!res.writableFinished));
      }
    } catch (error) {
      logger.error(`[tracing] middleware error (request continues untraced): ${error.message}`);
    }
    next();
  };
}

export default createTracingMiddleware();
