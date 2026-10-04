import { useProject } from '../../context/ProjectContext'
export default function ProjectSelector() {
  const { projects, projectId, selectProject, ready } = useProject()
  return <label className="flex items-center gap-2 text-xs text-slate-500"><span className="hidden sm:inline">Project</span><select aria-label="Project" className="control py-1.5 text-xs" disabled={!ready} value={projectId || ''} onChange={e => selectProject(e.target.value)}>{!ready && <option value="">Loading…</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
}
