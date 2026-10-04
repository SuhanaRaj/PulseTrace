import { Router } from 'express';
import { createError, deleteError, getError, getErrors } from '../controllers/errorController.js';

const router = Router();

router.route('/').get(getErrors).post(createError);
router.route('/:id').get(getError).delete(deleteError);

export default router;
