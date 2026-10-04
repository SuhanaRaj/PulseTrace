import { getHealthStatus } from '../services/healthService.js';

export function getHealth(req, res) {
  res.status(200).json(getHealthStatus());
}
