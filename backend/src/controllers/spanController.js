import * as spanService from '../services/spanService.js';

export async function getSpansByTraceId(req, res, next) {
  try {
    res.json({ success: true, data: await spanService.getTraceSpans(req.params.traceId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function createSpan(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await spanService.addSpan(req.body) });
  } catch (error) {
    next(error);
  }
}

export async function finishSpan(req, res, next) {
  try {
    res.json({ success: true, data: await spanService.closeSpan(req.params.spanId, { ...req.body, projectId: req.body?.projectId ?? req.query.projectId }) });
  } catch (error) {
    next(error);
  }
}
