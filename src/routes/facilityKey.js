import express from 'express';
import facilityKeyController from '../controllers/facilityKey.js';
import { protect, restrictTo } from '../middleware/auth.js';

const facilityKeyRoute = express.Router();

// all routes require login
facilityKeyRoute.use(protect);

// super_admin only
facilityKeyRoute.post('/', restrictTo('super_admin'), facilityKeyController.generateKey);
facilityKeyRoute.get('/', restrictTo('super_admin'), facilityKeyController.listKeys);
facilityKeyRoute.patch('/:id/deactivate', restrictTo('super_admin'), facilityKeyController.deactivateKey);

export default facilityKeyRoute;