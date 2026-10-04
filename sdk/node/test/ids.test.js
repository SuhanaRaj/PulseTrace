import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSpanId, generateTraceId, ID_PATTERN } from '../src/ids.js'
// The SDK must produce ids in exactly the format the PulseTrace backend itself generates.
import * as backendIds from '../../../backend/src/utils/ids.js'

test('trace ids: tr_ + 16 hex, unique', () => {
  const ids = new Set(Array.from({ length: 20000 }, generateTraceId))
  assert.equal(ids.size, 20000)
  for (const id of [...ids].slice(0, 100)) assert.match(id, /^tr_[0-9a-f]{16}$/)
})

test('span ids: sp_ + 12 hex, unique', () => {
  const ids = new Set(Array.from({ length: 20000 }, generateSpanId))
  assert.equal(ids.size, 20000)
  for (const id of [...ids].slice(0, 100)) assert.match(id, /^sp_[0-9a-f]{12}$/)
})

test('same format as the backend generators', () => {
  assert.match(backendIds.generateTraceId(), /^tr_[0-9a-f]{16}$/)
  assert.match(backendIds.generateSpanId(), /^sp_[0-9a-f]{12}$/)
  assert.equal(generateTraceId().length, backendIds.generateTraceId().length)
  assert.equal(generateSpanId().length, backendIds.generateSpanId().length)
})

test('generated ids satisfy the id pattern used for incoming headers', () => {
  assert.ok(ID_PATTERN.test(generateTraceId()) && ID_PATTERN.test(generateSpanId()))
  for (const bad of ['', 'has space', 'semi;colon', '{{var}}', 'x'.repeat(65)]) assert.ok(!ID_PATTERN.test(bad))
})
