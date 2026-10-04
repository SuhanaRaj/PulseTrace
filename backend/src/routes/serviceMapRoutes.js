import { Router } from 'express';
import { getMap } from '../controllers/serviceMapController.js';

const router = Router();
router.get('/', getMap);
export default router;
