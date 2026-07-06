import express              from 'express';
import alertController      from '../controllers/alert.js';
import { protect }          from '../middleware/auth.js';

const alertRoute = express.Router();

// All routes require auth
alertRoute.use(protect);

// ── GET ───────────────────────────────────────────────
alertRoute.get('/',                         alertController.getAlerts);
alertRoute.get('/network-matches',          alertController.getNetworkMatches);

// ── MARK READ ─────────────────────────────────────────
// Called when a user opens a drug's chat panel
alertRoute.patch('/read/:drugName',         alertController.markReadByDrug);

// ── ALERT LIFECYCLE ───────────────────────────────────
alertRoute.patch('/:id/confirm',            alertController.confirmAlert);
alertRoute.patch('/:id/decline',            alertController.declineAlert);
alertRoute.patch('/:id/self-resolve',       alertController.selfResolve);
alertRoute.patch('/:id/dispatch',           alertController.dispatchAlert);
alertRoute.patch('/:id/resolve',            alertController.resolveAlert);

// ── TRANSFER FLOW (single facility — kept for back-compat) ───
alertRoute.post('/transfer/draft',          alertController.createDraftTransfer);
alertRoute.patch('/transfer/:id/transmit',  alertController.transmitTransfer);
alertRoute.patch('/transfer/:id/revert',    alertController.revertTransfer);

// ── BROADCAST TRANSFER FLOW (up to 4 facilities, first-to-accept wins) ──
alertRoute.post('/transfer/broadcast',                     alertController.createBroadcastRequest);
alertRoute.patch('/transfer/broadcast/:broadcastId/transmit', alertController.transmitBroadcast);

export default alertRoute;