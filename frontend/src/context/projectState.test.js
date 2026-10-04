import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROJECT_ID, STORAGE_KEY, readStoredProject, resolveSelectedProject, writeStoredProject } from './projectState.js'

const PROJECTS = [{ id: 'pulsetrace', name: 'PulseTrace' }, { id: 'api-suite', name: 'API Suite' }]
const memoryStorage = (initial = {}) => { const data = { ...initial }; return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, data } }

test('default project is PulseTrace when nothing is stored', () => {
  assert.equal(DEFAULT_PROJECT_ID, 'pulsetrace')
  assert.equal(resolveSelectedProject(PROJECTS, readStoredProject(memoryStorage())), 'pulsetrace')
})
test('a stored valid project is restored (selection persists across refresh)', () => {
  const storage = memoryStorage()
  writeStoredProject(storage, 'api-suite')
  assert.equal(storage.data[STORAGE_KEY], 'api-suite')
  assert.equal(STORAGE_KEY, 'pulsetrace.selectedProject')
  assert.equal(resolveSelectedProject(PROJECTS, readStoredProject(storage)), 'api-suite')
})
test('an invalid / unknown stored project falls back to PulseTrace', () => {
  for (const bad of ['nope', '', 'API-SUITE', null, undefined]) assert.equal(resolveSelectedProject(PROJECTS, bad), 'pulsetrace')
})
test('a stored project that no longer exists falls back; the corrected id is what gets persisted', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: 'retired-project' })
  const resolved = resolveSelectedProject(PROJECTS, readStoredProject(storage))
  assert.equal(resolved, 'pulsetrace')
  writeStoredProject(storage, resolved)
  assert.equal(readStoredProject(storage), 'pulsetrace')
})
test('falls back to the first project if the default is not offered; null when there are none', () => {
  assert.equal(resolveSelectedProject([{ id: 'api-suite', name: 'API Suite' }], 'nope'), 'api-suite')
  assert.equal(resolveSelectedProject([], 'api-suite'), null)
})
test('unavailable or throwing storage never breaks selection', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readStoredProject(broken), null)
  assert.doesNotThrow(() => writeStoredProject(broken, 'api-suite'))
  assert.equal(readStoredProject(undefined), null)
})
