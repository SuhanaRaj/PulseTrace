import * as errorService from '../services/errorService.js';

export async function getErrors(req, res, next) {
  try {
    const result = await errorService.getAllErrors(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getError(req, res, next) {
  try {
    res.json({ success: true, data: await errorService.getError(req.params.id, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function createError(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await errorService.addError(req.body) });
  } catch (error) {
    next(error);
  }
}

export async function deleteError(req, res, next) {
  try {
    await errorService.removeError(req.params.id, req.query);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
