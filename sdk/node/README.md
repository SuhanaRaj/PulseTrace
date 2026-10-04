# @pulsetrace/node (v0.1, local package)

Zero-dependency Node.js SDK that reports HTTP telemetry from an Express (or Connect-style) backend to PulseTrace.
Not published to npm yet: use it from this repo (`"@pulsetrace/node": "file:../PulseTrace/sdk/node"`).

```js
import express from 'express'
import { PulseTrace } from '@pulsetrace/node'

const pulseTrace = new PulseTrace({
  endpoint: 'http://localhost:5000',   // required - PulseTrace backend
  projectId: 'api-suite',              // required - must be a project known to PulseTrace
  serviceName: 'api-suite',            // required
  environment: 'development',          // optional (default NODE_ENV or "development")
})

const app = express()
app.use(pulseTrace.middleware())       // before your routes
// ... routes ...
app.use(pulseTrace.errorHandler())     // optional, after routes: records thrown errors + stack traces
```

Options: `timeout` (ms, default 5000), `enabled` (default true), `ignorePaths` (path prefixes, e.g. `['/health']`),
`logger` (default `console`, `false` = silent), `onError(error)`, `fetch` (default global fetch, Node 18+).

Per request the middleware: reuses `x-trace-id` or generates one, generates the span id, reads `x-parent-span-id`,
sets `x-trace-id` / `x-span-id` on the response, measures duration, and POSTs the finished span (and an error item
for 4xx/5xx) to `<endpoint>/api/telemetry/batch`. It never throws and never delays the response.

`pulseTrace.getContext()` returns `{ traceId, spanId, parentSpanId, projectId, serviceName, environment, startTime }`
for the current request (AsyncLocalStorage). `pulseTrace.getPropagationHeaders()` returns the headers to put on an
outgoing call so the downstream service continues the trace.

Telemetry contract: see `backend/src/services/telemetryService.js`. Test: `npm test`.


## Batching and graceful shutdown

Telemetry is buffered in memory and sent in batches. Defaults:

- `batchSize`: 20 logical telemetry payloads
- `flushInterval`: 1000 ms
- `maxQueueSize`: 5000 queued payloads
- `maxRetries`: 2 retries after the initial attempt
- `retryDelay`: 250 ms with exponential backoff

These can be configured:

```js
const pulseTrace = new PulseTrace({
  endpoint: 'http://localhost:5000',
  projectId: 'api-suite',
  serviceName: 'api-suite',
  batchSize: 20,
  flushInterval: 1000,
  maxQueueSize: 5000,
  maxRetries: 2,
  retryDelay: 250,
})
```

For graceful shutdown:

```js
await pulseTrace.shutdown()
```

The SDK never makes telemetry delivery failures fail the monitored request.

## Manual spans

Manual spans can be nested inside an HTTP request:

```js
const span = pulseTrace.startSpan('Database Query')

try {
  const result = await User.find({})
  span.end()
} catch (error) {
  span.recordError(error)
  span.end()
}
```

A manual span automatically inherits the current trace and parent span through `AsyncLocalStorage`. Outside an HTTP request it starts a new trace.

Manual spans use `method: "INTERNAL"` and do not require an HTTP route at the SDK API level.
