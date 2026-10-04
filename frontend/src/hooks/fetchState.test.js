import test from 'node:test'
import assert from 'node:assert/strict'
import { startLoading } from './fetchState.js'

const shown = { data: { rows: ['pulsetrace data'] }, error: null, loading: false }
test('same request (reload): previous data stays visible while refreshing', () => {
  assert.deepEqual(startLoading(shown, false), { data: shown.data, error: null, loading: true })
})
test('different request (project switched): the old project data is dropped immediately', () => {
  assert.deepEqual(startLoading(shown, true), { data: null, error: null, loading: true })
})
test('a previous error is cleared when loading starts', () => {
  assert.equal(startLoading({ data: null, error: new Error('x'), loading: false }, false).error, null)
})
