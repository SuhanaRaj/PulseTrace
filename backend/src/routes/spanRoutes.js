import { Router } from 'express';
import { createSpan, finishSpan, getSpansByTraceId } from '../controllers/spanController.js';

const router = Router();

router.post('/', createSpan);
router.get('/trace/:traceId', getSpansByTraceId);
router.patch('/:spanId/finish', finishSpan);
// Legacy alias kept for backward compatibility: GET /api/spans/:traceId
router.get('/:traceId', getSpansByTraceId);

export default router;
