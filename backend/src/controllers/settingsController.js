import * as settingsService from '../services/settingsService.js';

export async function getSettings(req, res, next) {
  try {
    res.json({ success: true, data: await settingsService.getSettings() });
  } catch (error) {
    next(error);
  }
}

export async function patchSettings(req, res, next) {
  try {
    res.json({ success: true, data: await settingsService.updateSettings(req.body) });
  } catch (error) {
    next(error);
  }
}
