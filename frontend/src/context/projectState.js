// Pure project-selection rules (no React) so they can be unit tested.
export const STORAGE_KEY = 'pulsetrace.selectedProject'
export const DEFAULT_PROJECT_ID = 'pulsetrace'

export function readStoredProject(storage) {
  try { return storage?.getItem(STORAGE_KEY) || null } catch { return null }
}
export function writeStoredProject(storage, projectId) {
  try { storage?.setItem(STORAGE_KEY, projectId) } catch { /* private mode / quota: selection just won't persist */ }
}
// Stored id if it is still a known project, otherwise the default (never an unknown id).
export function resolveSelectedProject(projects = [], stored = null) {
  const ids = projects.map(p => p.id)
  if (stored && ids.includes(stored)) return stored
  if (ids.includes(DEFAULT_PROJECT_ID)) return DEFAULT_PROJECT_ID
  return ids[0] ?? null
}
