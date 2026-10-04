import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettingsInput } from '../src/services/settingsService.js';

test('settings defaults are valid', () => {
  assert.equal(DEFAULT_SETTINGS.key, 'default');
  assert.equal(DEFAULT_SETTINGS.environment, 'development');
  assert.equal(DEFAULT_SETTINGS.refreshInterval, 5000);
  assert.equal(DEFAULT_SETTINGS.liveUpdates, true);
});

test('settings input is normalized', () => {
  const value = validateSettingsInput({
    workspaceName: '  My Workspace  ',
    environment: 'staging',
    theme: 'system',
    errorNotifications: false,
    refreshInterval: '10000',
    liveUpdates: false,
  });

  assert.deepEqual(value, {
    workspaceName: 'My Workspace',
    environment: 'staging',
    theme: 'system',
    errorNotifications: false,
    refreshInterval: 10000,
    liveUpdates: false,
  });
});

test('settings input rejects unknown keys', () => {
  assert.throws(() => validateSettingsInput({ unknown: true }), /Unknown setting/);
});

test('settings input rejects invalid refresh intervals', () => {
  assert.throws(() => validateSettingsInput({ refreshInterval: 999 }), /refreshInterval/);
  assert.throws(() => validateSettingsInput({ refreshInterval: 61000 }), /refreshInterval/);
});

test('settings input rejects invalid enum and boolean values', () => {
  assert.throws(() => validateSettingsInput({ environment: 'qa' }), /environment/);
  assert.throws(() => validateSettingsInput({ theme: 'light' }), /theme/);
  assert.throws(() => validateSettingsInput({ liveUpdates: 'yes' }), /liveUpdates/);
});
