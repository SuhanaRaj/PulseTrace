import * as telemetryService from '../services/telemetryService.js';

export async function ingestBatch(req, res, next) {
  try {
    const result = await telemetryService.ingestBatch(req.body);
    const statusCode = telemetryService.httpStatusFor(result);
    res.status(statusCode).json({ success: statusCode !== 422, data: result });
  } catch (error) {
    next(error);
  }
}
