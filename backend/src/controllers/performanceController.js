import * as performanceService from '../services/performanceService.js';

export async function getPerformance(req, res, next) {
  try { res.json({ success: true, data: await performanceService.getPerformance(req.query) }); } catch (error) { next(error); }
}

export async function getServicePerformance(req, res, next) {
  try { res.json({ success: true, data: await performanceService.getServicePerformance(req.params.serviceName, req.query) }); } catch (error) { next(error); }
}
