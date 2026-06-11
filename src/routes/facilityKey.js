import express from 'express';
import facilityKeyController from '../controllers/facilityKey.js';
import { protect, restrictTo } from '../middleware/auth.js';

const facilityKeyRoute = express.Router();

facilityKeyRoute.use(protect);

// super_admin only
facilityKeyRoute.post('/generate',            restrictTo('super_admin'), facilityKeyController.generateKey);
facilityKeyRoute.get('/',                     restrictTo('super_admin'), facilityKeyController.listKeys);
facilityKeyRoute.patch('/:id/deactivate',     restrictTo('super_admin'), facilityKeyController.deactivateKey);
facilityKeyRoute.patch('/:id/reactivate',     restrictTo('super_admin'), facilityKeyController.reactivateKey);

export default facilityKeyRoute;
