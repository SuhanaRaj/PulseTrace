import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import { useApi } from '../hooks/useApi'
import { ErrorState, Loading } from '../components/common/UI'
import { readStoredProject, resolveSelectedProject, writeStoredProject } from './projectState'

const ProjectContext = createContext(null)
const storage = () => { try { return window.localStorage } catch { return null } }

// Loads GET /api/projects once and holds the selected project (persisted in localStorage).
export function ProjectProvider({ children }) {
  const { data, error, loading, reload } = useApi(() => api.getProjects(), [])
  const projects = data?.data || []
  const [stored, setStored] = useState(() => readStoredProject(storage()))
  const projectId = data ? resolveSelectedProject(projects, stored) : null // unknown stored ids fall back to the default

  useEffect(() => { if (projectId) writeStoredProject(storage(), projectId) }, [projectId])
  const selectProject = useCallback(id => { if (projects.some(p => p.id === id)) setStored(id) }, [projects])

  const value = useMemo(() => ({
    projects, projectId, project: projects.find(p => p.id === projectId) || null, selectProject,
    ready: Boolean(projectId), loading, error, reload,
  }), [projects, projectId, selectProject, loading, error, reload])
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject() {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('useProject must be used inside <ProjectProvider>')
  return value
}

// Renders the pages only once a project is known. Keyed by project, so switching projects remounts the page:
// every page re-fetches and no state or data from the previous project can remain on screen.
export function ProjectGate({ children }) {
  const { ready, error, reload, projectId } = useProject()
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!ready) return <Loading text="Loading projects…" />
  return <div key={projectId}>{children}</div>
}
