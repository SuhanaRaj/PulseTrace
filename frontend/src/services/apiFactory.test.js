import test from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from './apiFactory.js'

function fakeHttp() {
  const calls = []
  const reply = url => {
    if (url.startsWith('/traces') && !url.includes('/tree') && url.split('/').length === 2) return { success: true, data: [], pagination: { page: 1, limit: 1, total: 7, totalPages: 7 } }
    if (url === '/errors') return { success: true, data: [], pagination: { total: 3 } }
    return { success: true, data: [] }
  }
  return { calls, get: async (url, config) => { calls.push({ method: 'GET', url, params: config?.params }); return { data: reply(url) } }, patch: async (url, body) => { calls.push({ method: 'PATCH', url, body }); return { data: { success: true, data: body } } } }
}

test('every telemetry endpoint sends the projectId it was called with', async () => {
  const http = fakeHttp()
  const { api } = createApi(http)
  await api.getTraces({ projectId: 'api-suite', limit: 20, status: 'error' })
  await api.getTrace({ projectId: 'api-suite', traceId: 'tr_1' })
  await api.getTraceTree({ projectId: 'api-suite', traceId: 'tr_1' })
  await api.getTraceSpans({ projectId: 'api-suite', traceId: 'tr_1' })
  await api.getErrors({ projectId: 'api-suite', limit: 100 })
  await api.getPerformance({ projectId: 'api-suite' })
  await api.getServices({ projectId: 'api-suite' })
  await api.getServiceMap({ projectId: 'api-suite' })
  assert.deepEqual(http.calls.map(c => c.url), ['/traces', '/traces/tr_1', '/traces/tr_1/tree', '/spans/trace/tr_1', '/errors', '/performance', '/services', '/service-map'])
  assert.ok(http.calls.every(c => c.params.projectId === 'api-suite'))
  assert.deepEqual(http.calls[0].params, { projectId: 'api-suite', limit: 20, status: 'error' }, 'filters are preserved next to projectId')
})

test('switching project changes the request (no stale/global project state)', async () => {
  const http = fakeHttp()
  const { api } = createApi(http)
  await api.getServices({ projectId: 'pulsetrace' })
  await api.getServices({ projectId: 'api-suite' })
  await api.getServices({ projectId: 'pulsetrace' })
  assert.deepEqual(http.calls.map(c => c.params.projectId), ['pulsetrace', 'api-suite', 'pulsetrace'])
})

test('a missing projectId is a rejected promise, not an unscoped request', async () => {
  const http = fakeHttp()
  const { api } = createApi(http)
  for (const call of [() => api.getTraces({}), () => api.getTraces(), () => api.getErrors({ limit: 5 }), () => api.getPerformance(), () => api.getServices({}), () => api.getServiceMap({}), () => api.getTraceTree({ traceId: 'tr_1' }), () => api.getTrace({ traceId: 'tr_1' })]) {
    await assert.rejects(call(), /projectId is required/)
  }
  assert.equal(http.calls.length, 0, 'nothing was sent')
})

test('trace ids are URL-encoded', async () => {
  const http = fakeHttp()
  await createApi(http).api.getTraceTree({ projectId: 'pulsetrace', traceId: 'tr/odd id' })
  assert.equal(http.calls[0].url, '/traces/tr%2Fodd%20id/tree')
})

test('projects and settings are not project-scoped', async () => {
  const http = fakeHttp()
  const { api } = createApi(http)
  await api.getProjects()
  await api.getHealth()
  await api.getSettings()
  await api.updateSettings({ theme: 'dark' })
  assert.deepEqual(http.calls.map(c => c.url), ['/projects', '/health', '/settings', '/settings'])
  assert.ok(http.calls.slice(0, 3).every(c => c.params?.projectId === undefined))
})

test('overview data: all five requests carry the project and the result is assembled', async () => {
  const http = fakeHttp()
  const { getOverviewData } = createApi(http)
  const data = await getOverviewData('api-suite')
  assert.equal(http.calls.length, 5)
  assert.ok(http.calls.every(c => c.params.projectId === 'api-suite'))
  assert.equal(data.totalTraces, 7)
  assert.deepEqual(data.services, [])
})
