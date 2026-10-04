import Settings from '../models/Settings.js';
import env from '../config/env.js';

export const DEFAULT_SETTINGS = Object.freeze({
  key: 'default',
  workspaceName: 'PulseTrace Workspace',
  environment: env.nodeEnv === 'production'
    ? 'production'
    : env.nodeEnv === 'staging'
      ? 'staging'
      : 'development',
  theme: 'dark',
  errorNotifications: true,
  refreshInterval: 5000,
  liveUpdates: true,
});

function cleanSettings(document) {
  const value = document.toObject ? document.toObject() : document;
  const { _id, __v, createdAt, updatedAt, ...settings } = value;
  return settings;
}

export function validateSettingsInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('Settings payload must be an object.');
    error.statusCode = 400;
    throw error;
  }

  const allowed = new Set([
    'workspaceName',
    'environment',
    'theme',
    'errorNotifications',
    'refreshInterval',
    'liveUpdates',
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      const error = new Error(`Unknown setting: ${key}.`);
      error.statusCode = 400;
      throw error;
    }
  }

  if (input.workspaceName !== undefined) {
    if (typeof input.workspaceName !== 'string' || !input.workspaceName.trim() || input.workspaceName.trim().length > 80) {
      const error = new Error('workspaceName must be a non-empty string of at most 80 characters.');
      error.statusCode = 400;
      throw error;
    }
  }

  if (input.environment !== undefined && !['production', 'staging', 'development'].includes(input.environment)) {
    const error = new Error('environment must be production, staging, or development.');
    error.statusCode = 400;
    throw error;
  }

  if (input.theme !== undefined && !['dark', 'system'].includes(input.theme)) {
    const error = new Error('theme must be dark or system.');
    error.statusCode = 400;
    throw error;
  }

  if (input.errorNotifications !== undefined && typeof input.errorNotifications !== 'boolean') {
    const error = new Error('errorNotifications must be a boolean.');
    error.statusCode = 400;
    throw error;
  }

  if (input.refreshInterval !== undefined) {
    const refreshInterval = Number(input.refreshInterval);
    if (!Number.isInteger(refreshInterval) || refreshInterval < 1000 || refreshInterval > 60000) {
      const error = new Error('refreshInterval must be between 1000 and 60000 milliseconds.');
      error.statusCode = 400;
      throw error;
    }
  }

  if (input.liveUpdates !== undefined && typeof input.liveUpdates !== 'boolean') {
    const error = new Error('liveUpdates must be a boolean.');
    error.statusCode = 400;
    throw error;
  }

  return {
    ...input,
    ...(input.workspaceName !== undefined ? { workspaceName: input.workspaceName.trim() } : {}),
    ...(input.refreshInterval !== undefined ? { refreshInterval: Number(input.refreshInterval) } : {}),
  };
}

export async function getSettings() {
  const settings = await Settings.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: DEFAULT_SETTINGS },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return cleanSettings(settings);
}

export async function updateSettings(input) {
  const updates = validateSettingsInput(input);

  const settings = await Settings.findOneAndUpdate(
    { key: 'default' },
    { $set: updates, $setOnInsert: DEFAULT_SETTINGS },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  return cleanSettings(settings);
}
