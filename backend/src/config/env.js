import 'dotenv/config';
import { DEFAULT_TRACE_IGNORE_PATHS } from './traceIgnore.js';

const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // HTTP tracing
  serviceName: process.env.SERVICE_NAME || 'pulsetrace-backend',
  // Browser origins allowed to call the API (the Vite dev / preview servers by default).
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Path prefixes that are NOT traced. Default: PulseTrace's own API (see config/traceIgnore.js). Override: TRACE_IGNORE_PATHS.
  traceIgnorePaths: process.env.TRACE_IGNORE_PATHS
    ? process.env.TRACE_IGNORE_PATHS.split(',').map((path) => path.trim()).filter(Boolean)
    : DEFAULT_TRACE_IGNORE_PATHS,
  // Project the server's own telemetry (automatic HTTP tracing) belongs to; also the fallback for requests without projectId.
  projectId: process.env.PROJECT_ID || undefined,
  // true = telemetry/API requests MUST carry an explicit projectId (no fallback to the server's project).
  requireProjectId: process.env.REQUIRE_PROJECT_ID === 'true',
  mongoDbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pulsetrace',
};

export default env;
