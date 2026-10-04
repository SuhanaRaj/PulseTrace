// Builds the API functions on top of any HTTP client ({ get, patch }) - kept free of axios/Vite so it is unit-testable.
// Every telemetry call REQUIRES a projectId and sends it as ?projectId=... (the backend scopes all queries by it).
const enc = value => encodeURIComponent(value)
const need = projectId => {
  if (!projectId) throw new Error('A projectId is required for this API call.')
  return projectId
}

export function createApi(http) {
  const get = (url, params) => http.get(url, { params }).then(r => r.data)
  const patch = (url, body) => http.patch(url, body).then(r => r.data)
  // async: a missing projectId becomes a rejected promise instead of a synchronous throw inside a React effect
  const scoped = (url, params = {}) => (async () => get(url, { ...params, projectId: need(params.projectId) }))()
  const byTrace = (suffix, { projectId, traceId } = {}) => (async () => get(`/traces/${enc(traceId)}${suffix}`, { projectId: need(projectId) }))()

  const api = {
    getHealth: () => get('/health'), // { status, service, database, timestamp }
    getProjects: () => get('/projects'), // { success, data: [{ id, name }] }
    getTraces: params => scoped('/traces', params),
    getTrace: args => byTrace('', args),
    getTraceTree: args => byTrace('/tree', args),
    getTraceSpans: ({ projectId, traceId } = {}) => (async () => get(`/spans/trace/${enc(traceId)}`, { projectId: need(projectId) }))(),
    getErrors: params => scoped('/errors', params),
    getPerformance: params => scoped('/performance', params),
    getServiceMap: params => scoped('/service-map', params),
    getServices: params => scoped('/services', params),
    getSettings: () => get('/settings'), // settings are workspace-wide, not per project
    updateSettings: settings => patch('/settings', settings),
  }

  // Several calls the Overview needs, in parallel (client-side composition only; no new backend endpoint).
  async function getOverviewData(projectId) {
    const [recent, errorTraces, performance, services, errors] = await Promise.all([
      api.getTraces({ projectId, limit: 100 }),
      api.getTraces({ projectId, limit: 1, status: 'error' }),
      api.getPerformance({ projectId }),
      api.getServices({ projectId }),
      api.getErrors({ projectId, limit: 5 }),
    ])
    return {
      traces: recent.data, totalTraces: recent.pagination.total, errorTraces: errorTraces.pagination.total,
      performance: performance.data, services: services.data, errors: errors.data,
    }
  }

  return { api, getOverviewData }
}
