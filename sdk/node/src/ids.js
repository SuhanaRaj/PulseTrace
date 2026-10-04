import { randomBytes } from 'node:crypto'

// Same formats as the PulseTrace backend (backend/src/utils/ids.js): tr_<16 hex> / sp_<12 hex>.
export const generateTraceId = () => `tr_${randomBytes(8).toString('hex')}`
export const generateSpanId = () => `sp_${randomBytes(6).toString('hex')}`

// Ids received in headers are untrusted: only short, safe identifiers are accepted.
export const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
