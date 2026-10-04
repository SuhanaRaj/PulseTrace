export const fmt = n => new Intl.NumberFormat('en-US').format(n)
export const ms = n => n >= 1000 ? `${(n/1000).toFixed(2)}s` : `${n}ms`
export const pct = n => `${n.toFixed(2)}%`
export const timeAgo = (value, now = Date.now()) => {
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
export const dateTime = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—' }
