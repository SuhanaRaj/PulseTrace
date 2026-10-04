// PulseTrace's own dashboard / management / ingestion API is never traced by the automatic HTTP tracing
// (otherwise using the dashboard, or external SDKs posting telemetry, would create telemetry about itself).
// /api/telemetry is the SDK ingestion endpoint: tracing it would make every ingestion request produce a new
// trace, i.e. a feedback loop. Anything NOT listed here (your application's own routes) is still traced.
export const DEFAULT_TRACE_IGNORE_PATHS = [
  '/api/health',
  '/api/traces',
  '/api/spans',
  '/api/errors',
  '/api/performance',
  '/api/service-map',
  '/api/services',
  '/api/settings',
  '/api/projects',
  '/api/telemetry',
];
