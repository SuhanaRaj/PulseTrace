import { getServiceMap } from '../services/serviceMapService.js';

export async function getMap(req, res, next) {
  try { res.json({ success: true, data: await getServiceMap(req.query) }); } catch (error) { next(error); }
}
