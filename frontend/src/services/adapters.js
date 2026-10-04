// Pure mapping functions: backend response shapes -> the shapes the existing UI components expect.
// No React, no axios, no import.meta.env, so they can be unit tested with plain Node.
import { ms } from '../utils/formatters.js'

const PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#60a5fa', '#2dd4bf']
const ACRONYMS = new Set(['api', 'db', 'id', 'ui', 'http', 'sql', 'url', 'dns', 'cdn'])
const HEALTH = { healthy: 'healthy', degraded: 'degraded', down: 'failing' }

export function prettyName(slug = '') {
  const words = String(slug).split(/[-_\s]+/).filter(Boolean)
  if (!words.length) return String(slug)
  return words.map(w => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')
}
export function colorFor(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
export const healthOf = status => HEALTH[status] || status || 'unknown'
const rate = (part, total) => (total ? (part / total) * 100 : 0)

/* ---------- Services ---------- */
// /api/services supplies the service list. Its own metrics are based on ROOT traces only (leaf services such as a
// database would show 0), so request/error/latency numbers come from the span-based service map + performance data.
export function adaptServices(services = [], mapNodes = [], slowestServices = []) {
  const metrics = new Map(mapNodes.map(n => [n.id, n.data || {}]))
  const perf = new Map(slowestServices.map(s => [s.serviceName, s]))
  return services.map(s => {
    const m = metrics.get(s.name) || {}
    const requests = m.requestCount ?? 0
    const errors = m.errorCount ?? 0
    return {
      id: s.name, name: prettyName(s.name), health: healthOf(s.status), environment: s.environment, color: colorFor(s.name),
      requests, errors, errorPct: rate(errors, requests), latency: m.averageLatency ?? 0,
      p95: perf.has(s.name) ? perf.get(s.name).p95 : null, createdAt: s.createdAt, updatedAt: s.updatedAt,
    }
  })
}

/* ---------- Traces ---------- */
export const adaptTrace = t => ({
  id: t.traceId, service: prettyName(t.rootService), serviceId: t.rootService, route: t.route, method: t.method,
  status: t.status, duration: t.duration, timestamp: t.timestamp,
})

// Flatten the nested tree (children) into the waterfall rows the UI renders, with offsets relative to the first span.
export function adaptTraceTree({ trace, spans = [] }) {
  const flat = []
  const walk = (nodes, depth) => nodes.forEach(s => {
    flat.push({
      id: s.spanId, parentSpanId: s.parentSpanId, traceId: s.traceId, name: s.operation, service: prettyName(s.serviceName),
      serviceId: s.serviceName, duration: s.duration, status: s.status, startTime: s.startTime, endTime: s.endTime, depth,
    })
    walk(s.children || [], depth + 1)
  })
  walk(spans, 0)
  const startMs = s => new Date(s.startTime).getTime()
  const origin = flat.length ? Math.min(...flat.map(startMs)) : new Date(trace.timestamp).getTime()
  flat.forEach(s => { s.start = Math.max(0, startMs(s) - origin) })
  const total = Math.max(1, ...flat.map(s => s.start + s.duration))
  return { trace: adaptTrace(trace), spans: flat, total, ticks: [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(total * f)) }
}

/* ---------- Errors ---------- */
// The backend returns individual error records (with occurrenceCount for identical service+type+message).
// The UI shows error groups, so identical records are grouped.
export function groupErrors(records = [], now = Date.now()) {
  const groups = new Map()
  records.forEach(r => {
    const key = [r.serviceName, r.errorType, r.message].join('\u0000')
    const t = new Date(r.timestamp).getTime()
    const g = groups.get(key) || {
      id: r.id || r._id, title: r.message, errorType: r.errorType, service: prettyName(r.serviceName), serviceId: r.serviceName,
      loaded: 0, count: 0, firstTs: t, lastTs: t, stack: r.stackTrace || null, traceId: r.traceId || null,
    }
    g.loaded += 1
    g.count = Math.max(g.count, r.occurrenceCount || 0, g.loaded)
    if (t < g.firstTs) g.firstTs = t
    if (t >= g.lastTs) { g.lastTs = t; g.traceId = r.traceId || g.traceId }
    if (!g.stack && r.stackTrace) g.stack = r.stackTrace
    groups.set(key, g)
  })
  return [...groups.values()]
    .sort((a, b) => b.lastTs - a.lastTs)
    .map(g => ({ ...g, first: new Date(g.firstTs).toLocaleString(), last: relative(g.lastTs, now) }))
}
function relative(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/* ---------- Time series / distributions (computed from real records) ---------- */
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function bucketTraces(traces = [], rangeMs, buckets = 12, now = Date.now()) {
  const start = now - rangeMs
  const size = rangeMs / buckets
  const out = Array.from({ length: buckets }, (_, i) => ({ t: start + i * size, requests: 0, errors: 0, total: 0 }))
  traces.forEach(tr => {
    const t = new Date(tr.timestamp).getTime()
    if (!(t >= start && t <= now)) return
    const b = out[Math.min(buckets - 1, Math.floor((t - start) / size))]
    b.requests += 1
    if (tr.status === 'error') b.errors += 1
    b.total += tr.duration
  })
  return out.map(b => ({ time: clock(b.t), requests: b.requests, errors: b.errors, latency: b.requests ? Math.round(b.total / b.requests) : null }))
}

export function bucketTimestamps(timestamps = [], buckets = 12) {
  const ts = timestamps.map(t => new Date(t).getTime()).filter(Number.isFinite)
  if (!ts.length) return []
  const min = Math.min(...ts)
  const max = Math.max(...ts)
  if (min === max) return [{ time: clock(min), errors: ts.length }]
  const size = (max - min + 1) / buckets
  const out = Array.from({ length: buckets }, (_, i) => ({ time: clock(min + i * size), errors: 0 }))
  ts.forEach(t => { out[Math.min(buckets - 1, Math.floor((t - min) / size))].errors += 1 })
  return out
}

export function durationHistogram(durations = [], buckets = 8) {
  const values = durations.filter(Number.isFinite)
  if (!values.length) return []
  const size = Math.max(1, Math.ceil((Math.max(...values) + 1) / buckets))
  const bins = Array.from({ length: buckets }, (_, i) => ({ range: `${ms(i * size)}–${ms((i + 1) * size)}`, count: 0 }))
  values.forEach(v => { bins[Math.min(buckets - 1, Math.floor(v / size))].count += 1 })
  return bins
}

/* ---------- Service map ---------- */
// Layered left-to-right layout from the edges: a service sits one column to the right of its deepest caller.
export function layoutNodes(nodes, edges) {
  const depth = new Map(nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false
    edges.forEach(e => {
      if (!depth.has(e.source) || !depth.has(e.target)) return
      const d = depth.get(e.source) + 1
      if (d > depth.get(e.target) && d < nodes.length) { depth.set(e.target, d); changed = true }
    })
    if (!changed) break
  }
  const columns = new Map()
  nodes.forEach(n => { const d = depth.get(n.id); columns.set(d, [...(columns.get(d) || []), n.id]) })
  const tallest = Math.max(1, ...[...columns.values()].map(c => c.length))
  const positions = new Map()
  columns.forEach((ids, d) => {
    ids.sort().forEach((id, i) => positions.set(id, { x: 20 + d * 280, y: 40 + i * 130 + ((tallest - ids.length) * 130) / 2 }))
  })
  return positions
}

const edgeLabel = d => (d ? `${d.requestCount} req · ${ms(d.averageLatency)}${d.errorCount ? ` · ${d.errorCount} err` : ''}` : undefined)

export function adaptServiceMap({ nodes = [], edges = [] } = {}) {
  const positions = layoutNodes(nodes, edges)
  const ids = new Set(nodes.map(n => n.id))
  return {
    nodes: nodes.map(n => {
      const d = n.data || {}
      const requests = d.requestCount ?? 0
      const errors = d.errorCount ?? 0
      return {
        id: n.id, type: 'service', position: positions.get(n.id),
        data: { service: { id: n.id, name: prettyName(d.label || n.id), health: healthOf(d.status), color: colorFor(n.id), environment: d.environment, requests, errors, errorPct: rate(errors, requests), latency: d.averageLatency ?? 0 } },
      }
    }),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({
      id: e.id, source: e.source, target: e.target, animated: true, style: { stroke: '#3b82f6', strokeOpacity: 0.65 },
      label: edgeLabel(e.data), labelStyle: { fill: '#94a3b8', fontSize: 11 }, labelBgStyle: { fill: '#101522' }, labelBgPadding: [6, 3], labelBgBorderRadius: 4,
    })),
  }
}

/* ---------- Overview ---------- */
export function adaptActivity(traces = [], errors = [], now = Date.now()) {
  const items = [
    ...traces.map(t => ({ ts: new Date(t.timestamp).getTime(), kind: t.status === 'error' ? 'error' : 'ok', text: t.status === 'error' ? 'Trace failed' : 'Trace completed successfully', detail: `${t.method} ${t.route} • ${ms(t.duration)}` })),
    ...errors.map(e => ({ ts: new Date(e.timestamp).getTime(), kind: 'error', text: 'Error recorded', detail: `${e.message} • ${prettyName(e.serviceName)}` })),
  ].filter(i => Number.isFinite(i.ts))
  return items.sort((a, b) => b.ts - a.ts).slice(0, 4).map(i => ({ ...i, ago: relative(i.ts, now) }))
}
