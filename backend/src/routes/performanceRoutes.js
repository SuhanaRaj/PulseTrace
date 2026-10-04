import { Router } from 'express';
import { getPerformance, getServicePerformance } from '../controllers/performanceController.js';

const router = Router();
router.get('/', getPerformance);
router.get('/services/:serviceName', getServicePerformance);
export default router;
