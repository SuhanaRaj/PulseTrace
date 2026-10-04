import axios from 'axios'
import { createApi } from './apiFactory'

// Base URL: VITE_API_URL (legacy, full URL incl. /api) or VITE_API_BASE_URL (origin, "/api" is appended).
// With neither set, "/api" on the current origin is used (Vite dev proxy).
const origin = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
export const API_BASE_URL = import.meta.env.VITE_API_URL || (origin ? `${origin}/api` : '/api')

export const client = axios.create({ baseURL: API_BASE_URL, timeout: 10000 })

export class ApiError extends Error {
  constructor(message, { status = null, network = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.network = network
  }
}

client.interceptors.response.use(
  response => response,
  error => {
    if (error.response) {
      const { status, data } = error.response
      return Promise.reject(new ApiError(data?.message || `Request failed with status ${status}`, { status }))
    }
    if (error.code === 'ECONNABORTED') return Promise.reject(new ApiError(`The backend at ${API_BASE_URL} took too long to respond.`, { network: true }))
    return Promise.reject(new ApiError(`Cannot reach the PulseTrace backend at ${API_BASE_URL}. Make sure it is running.`, { network: true }))
  },
)

const created = createApi(client)

// Every function resolves with the backend's JSON body unchanged ({ success, data } or { success, data, pagination }).
// Mapping to UI shapes lives in adapters.js. Telemetry calls take { projectId, ...filters } - see apiFactory.js.
export const api = created.api
export const getOverviewData = created.getOverviewData
