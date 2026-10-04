import { Router } from 'express';
import { getSettings, patchSettings } from '../controllers/settingsController.js';

const router = Router();
router.route('/').get(getSettings).patch(patchSettings);
export default router;
