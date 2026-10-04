# API Suite integration (local)

API Suite is intentionally kept as a separate application. Install/use the SDK from
`sdk/node` and configure it with the API Suite project identity.

Example `package.json` dependency from an API Suite checkout adjacent to PulseTrace:

```json
{
  "dependencies": {
    "@pulsetrace/node": "file:../PulseTrace/sdk/node"
  }
}
```

Then:

```js
import { PulseTrace } from '@pulsetrace/node'

const pulseTrace = new PulseTrace({
  endpoint: process.env.PULSETRACE_ENDPOINT || 'http://localhost:5000',
  projectId: 'api-suite',
  serviceName: 'api-suite',
  environment: process.env.NODE_ENV || 'development',
})

app.use(pulseTrace.middleware())

// Optional, after application routes:
app.use(pulseTrace.errorHandler())
```

API Suite must not connect to the PulseTrace MongoDB directly.
