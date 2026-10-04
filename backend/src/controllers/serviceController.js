import * as serviceService from '../services/serviceService.js';

export async function getServices(req, res, next) {
  try {
    res.json({ success: true, data: await serviceService.getServices(req.query) });
  } catch (error) {
    next(error);
  }
}

export async function getService(req, res, next) {
  try {
    res.json({ success: true, data: await serviceService.getService(req.params.id, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function createService(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await serviceService.addService(req.body) });
  } catch (error) {
    next(error);
  }
}

export async function updateService(req, res, next) {
  try {
    res.json({ success: true, data: await serviceService.editService(req.params.id, req.body, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function deleteService(req, res, next) {
  try {
    await serviceService.removeService(req.params.id, req.query);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
