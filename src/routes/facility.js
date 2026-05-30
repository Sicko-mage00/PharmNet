import express from 'express';
import facilityController from '../controllers/facility.js';
import { protect, restrictTo } from '../middleware/auth.js';

const facilityRoute = express.Router();

// accessible to all verified users
facilityRoute.get('/', facilityController.getAllFacilities);
facilityRoute.get('/:id', facilityController.getFacility);

// super_admin only
facilityRoute.post('/', protect, restrictTo('super_admin'), facilityController.createFacility);
facilityRoute.patch('/:id', protect, restrictTo('super_admin'), facilityController.updateFacility);
facilityRoute.patch('/:id/deactivate', protect, restrictTo('super_admin'), facilityController.deactivateFacility);

export default facilityRoute;