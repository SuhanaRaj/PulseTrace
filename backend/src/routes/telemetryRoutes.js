import { Router } from 'express';
import { ingestBatch } from '../controllers/telemetryController.js';

const router = Router();
router.post('/batch', ingestBatch);
export default router;
