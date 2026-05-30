import express from 'express';
import alertController from '../controllers/alert.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/',                    alertController.getAlerts);
router.patch('/:id/confirm',       alertController.confirmAlert);
router.patch('/:id/decline',       alertController.declineAlert);
router.patch('/:id/self-resolve',  alertController.selfResolve);
router.patch('/:id/dispatch',      alertController.dispatchAlert);
router.patch('/:id/resolve',       alertController.resolveAlert);

export default router;