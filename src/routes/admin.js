import express from 'express';
import adminController from '../controllers/admin.js';
import { protect, restrictTo } from '../middleware/auth.js';

const adminRoute = express.Router();

// all admin routes — must be logged in AND super_admin
adminRoute.use(protect, restrictTo('super_admin'));

adminRoute.get('/users',                    adminController.getAllUsers);
adminRoute.patch('/users/:id/role',         adminController.changeUserRole);
adminRoute.patch('/users/:id/deactivate',   adminController.deactivateUser);

adminRoute.delete('/keys/:id',       protect, restrictTo('super_admin'), adminController.deleteKey);
adminRoute.delete('/facilities/:id', protect, restrictTo('super_admin'), adminController.deleteFacility);
export default adminRoute;
