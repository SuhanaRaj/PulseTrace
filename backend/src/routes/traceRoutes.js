import { Router } from 'express';
import { completeTrace, createTrace, deleteTrace, getTrace, getTraceTree, getTraces } from '../controllers/traceController.js';

const router = Router();

router.route('/').get(getTraces).post(createTrace);
router.post('/:traceId/complete', completeTrace);
router.get('/:traceId/tree', getTraceTree);
router.route('/:traceId').get(getTrace).delete(deleteTrace);

export default router;
