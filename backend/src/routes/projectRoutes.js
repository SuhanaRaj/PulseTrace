import { Router } from 'express';
import { getProjects } from '../controllers/projectController.js';

const router = Router();
router.get('/', getProjects);
export default router;
