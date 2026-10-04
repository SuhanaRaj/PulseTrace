import { Router } from 'express';
import { createService, deleteService, getService, getServices, updateService } from '../controllers/serviceController.js';

const router = Router();

router.route('/').get(getServices).post(createService);
router.route('/:id').get(getService).patch(updateService).delete(deleteService);

export default router;
