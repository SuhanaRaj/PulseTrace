import * as traceService from '../services/traceService.js';

export async function getTraces(req, res, next) {
  try {
    const result = await traceService.getAllTraces(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getTrace(req, res, next) {
  try {
    res.json({ success: true, data: await traceService.getTrace(req.params.traceId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function createTrace(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await traceService.addTrace(req.body) });
  } catch (error) {
    next(error);
  }
}

export async function completeTrace(req, res, next) {
  try {
    res.json({ success: true, data: await traceService.completeTrace(req.params.traceId, { ...req.body, projectId: req.body?.projectId ?? req.query.projectId }) });
  } catch (error) {
    next(error);
  }
}

export async function getTraceTree(req, res, next) {
  try {
    res.json({ success: true, data: await traceService.getTraceTree(req.params.traceId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function deleteTrace(req, res, next) {
  try {
    await traceService.removeTrace(req.params.traceId, req.query);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
