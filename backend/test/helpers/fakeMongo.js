// Tiny in-memory stand-in for the Mongoose models (filters incl. $or/$exists/$in/$ne, upsert, $set). No MongoDB.
export function createFakeDb() {
  let seq = 1
  const store = { traces: [], spans: [], errors: [], services: [] }
  const matches = (row, q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(row, sub))
    const val = row[k]
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$exists' in v) return (val !== undefined) === v.$exists
      if ('$in' in v) return v.$in.includes(val)
      if ('$ne' in v) return val !== v.$ne
    }
    if (v === null) return val === null || val === undefined
    return String(val) === String(v)
  })
  const wrap = (row) => ({
    ...row,
    toObject() { const { toObject, save, ...rest } = this; return { ...rest } },
    async save() { const { toObject, save, ...rest } = this; Object.assign(row, rest); return this },
  })
  const chain = (rows) => {
    let out = rows
    const api = {
      sort(spec) { const [[key, dir]] = Object.entries(spec); out = [...out].sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0)); return api },
      select() { return api }, skip(n) { out = out.slice(n); return api }, limit(n) { out = out.slice(0, n); return api },
      then(resolve, reject) { return Promise.resolve(out.map(wrap)).then(resolve, reject) },
    }
    return api
  }
  const collection = (name, unique = []) => ({
    find: (q = {}) => chain(store[name].filter((r) => matches(r, q))),
    findOne: async (q) => { const r = store[name].find((x) => matches(x, q)); return r ? wrap(r) : null },
    exists: async (q) => (store[name].some((r) => matches(r, q)) ? { _id: 1 } : null),
    countDocuments: async (q = {}) => store[name].filter((r) => matches(r, q)).length,
    create: async (doc) => {
      for (const key of unique) if (store[name].some((r) => r[key] === doc[key])) throw Object.assign(new Error('E11000'), { code: 11000 })
      const row = { _id: `id${seq++}`, ...doc }; store[name].push(row); return wrap(row)
    },
    updateOne: async (q, update, opts = {}) => {
      const row = store[name].find((r) => matches(r, q))
      if (row) { Object.assign(row, update.$set || {}); return }
      if (opts.upsert) store[name].push({ _id: `id${seq++}`, ...(update.$setOnInsert || {}), ...(update.$set || {}) })
    },
  })
  const models = { Trace: collection('traces', ['traceId']), Span: collection('spans', ['spanId']), Service: collection('services'), Error: collection('errors') }
  return { store, models, reset() { Object.keys(store).forEach((k) => { store[k] = [] }) } }
}
