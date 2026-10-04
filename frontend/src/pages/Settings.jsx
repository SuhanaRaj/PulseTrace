import { useEffect, useMemo, useState } from 'react'
import { Check, CircleHelp, ExternalLink, RotateCcw, Save, Server, Wifi, Zap } from 'lucide-react'
import { api } from '../services/api'
import { useApi } from '../hooks/useApi'
import { ErrorState, Loading } from '../components/common/UI'

const DEFAULTS = {
  key: 'default',
  workspaceName: 'PulseTrace Workspace',
  environment: 'development',
  theme: 'dark',
  errorNotifications: true,
  refreshInterval: 5000,
  liveUpdates: true,
}

const INTEGRATIONS = [
  { name: 'REST API', description: 'Dashboard API connection', status: 'Connected', icon: Server },
  { name: 'WebSocket stream', description: 'Reserved for real-time trace events', status: 'Coming soon', icon: Wifi },
  { name: 'OpenTelemetry', description: 'Collector integration is planned for the SDK phase', status: 'Planned', icon: Zap },
]

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`h-6 w-11 rounded-full p-1 transition ${checked ? 'bg-cyan-500' : 'bg-slate-700'}`}
    >
      <i className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

export default function Settings() {
  const { data, error, loading, reload } = useApi(api.getSettings, [])
  const [form, setForm] = useState(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    if (data?.data) setForm({ ...DEFAULTS, ...data.data })
  }, [data])

  const dirty = useMemo(() => {
    if (!data?.data) return false
    const current = { ...DEFAULTS, ...data.data }
    return ['workspaceName', 'environment', 'theme', 'errorNotifications', 'refreshInterval', 'liveUpdates']
      .some(key => form[key] !== current[key])
  }, [data, form])

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))

  const reset = () => {
    if (data?.data) setForm({ ...DEFAULTS, ...data.data })
    setSaveError(null)
    setSaved(false)
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const result = await api.updateSettings({
        workspaceName: form.workspaceName,
        environment: form.environment,
        theme: form.theme,
        errorNotifications: form.errorNotifications,
        refreshInterval: Number(form.refreshInterval),
        liveUpdates: form.liveUpdates,
      })
      setForm({ ...DEFAULTS, ...result.data })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Loading text="Loading settings…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  return (
    <form onSubmit={save} className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">Configure how your PulseTrace workspace behaves.</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <button type="button" onClick={reset} className="control flex items-center gap-2"><RotateCcw size={14} /> Reset</button>}
          <button type="submit" disabled={saving || !dirty} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
            <Save size={15} /> {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="panel border border-rose-500/30 p-4 text-sm text-rose-300">
          <p className="font-medium">Could not save settings</p>
          <p className="mt-1 text-slate-400">{saveError.message}</p>
        </div>
      )}

      <section className="panel p-5">
        <div>
          <h2 className="font-medium">Workspace</h2>
          <p className="mt-1 text-xs text-slate-500">Basic information used throughout the dashboard.</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-400">
            Workspace name
            <input value={form.workspaceName} onChange={e => update('workspaceName', e.target.value)} maxLength={80} className="control mt-2 w-full" />
            <span className="mt-1 block text-xs text-slate-600">{form.workspaceName.length}/80</span>
          </label>
          <label className="text-sm text-slate-400">
            Default environment
            <select value={form.environment} onChange={e => update('environment', e.target.value)} className="control mt-2 w-full">
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-medium">Dashboard preferences</h2>
        <div className="mt-4 divide-y divide-slate-800">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div>
              <p className="text-sm">Theme preference</p>
              <p className="mt-1 text-xs text-slate-500">Choose the dashboard appearance.</p>
            </div>
            <select value={form.theme} onChange={e => update('theme', e.target.value)} className="control">
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <p className="text-sm">Error notifications</p>
              <p className="mt-1 text-xs text-slate-500">Keep error alert preferences enabled for the workspace.</p>
            </div>
            <Toggle checked={form.errorNotifications} onChange={value => update('errorNotifications', value)} label="Error notifications" />
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-medium">Data & live updates</h2>
        <p className="mt-1 text-xs text-slate-500">These values are stored by PulseTrace and are ready for the real-time layer.</p>
        <div className="mt-4 divide-y divide-slate-800">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div>
              <p className="text-sm">Refresh interval</p>
              <p className="mt-1 text-xs text-slate-500">Polling interval used by future live dashboard updates.</p>
            </div>
            <select value={form.refreshInterval} onChange={e => update('refreshInterval', Number(e.target.value))} className="control">
              <option value={1000}>1 second</option>
              <option value={5000}>5 seconds</option>
              <option value={10000}>10 seconds</option>
              <option value={30000}>30 seconds</option>
              <option value={60000}>60 seconds</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <p className="text-sm">Live updates</p>
              <p className="mt-1 text-xs text-slate-500">Enable live-update preference for the workspace.</p>
            </div>
            <Toggle checked={form.liveUpdates} onChange={value => update('liveUpdates', value)} label="Live updates" />
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Integrations</h2>
            <p className="mt-1 text-xs text-slate-500">Current PulseTrace integration status.</p>
          </div>
          <CircleHelp size={17} className="text-slate-600" />
        </div>
        <div className="mt-4 space-y-3">
          {INTEGRATIONS.map(({ name, description, status, icon: Icon }) => (
            <div key={name} className="soft-panel flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-400"><Icon size={15} /></div>
                <div>
                  <p className="text-sm">{name}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] ${status === 'Connected' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {status}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-1 text-xs text-slate-600"><ExternalLink size={12} /> Integration endpoints will become configurable when the reusable PulseTrace SDK is extracted.</p>
      </section>
    </form>
  )
}
