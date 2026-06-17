import express from 'express';
import alertController from '../controllers/alert.js';
import { protect } from '../middleware/auth.js';

const alertRoute = express.Router();

// all alert routes — must be logged in
alertRoute.use(protect); 

// Existing System Alerts
alertRoute.get('/',                        alertController.getAlerts);

// NEW: Categorization Engine Route (MUST be above /:id routes)
alertRoute.get('/network-matches',         alertController.getNetworkMatches);

// Existing ID-based Routes
alertRoute.patch('/:id/confirm',           alertController.confirmAlert);
alertRoute.patch('/:id/decline',           alertController.declineAlert);
alertRoute.patch('/:id/self-resolve',      alertController.selfResolve);
alertRoute.patch('/:id/dispatch',          alertController.dispatchAlert);
alertRoute.patch('/:id/resolve',           alertController.resolveAlert);

// OPay-Style Inter-Facility Transfers
alertRoute.post('/transfer/draft',         alertController.createDraftTransfer);
alertRoute.patch('/transfer/:id/transmit', alertController.transmitTransfer);
alertRoute.patch('/transfer/:id/revert',   alertController.revertTransfer);

export default alertRoute;