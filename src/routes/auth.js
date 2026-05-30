import express from 'express';
import authController from '../controllers/auth.js';
import { protect } from '../middleware/auth.js';


const authRoute = express.Router();
//public 
authRoute.post('/register', authController.register);
authRoute.post('/login',    authController.login);
authRoute.post('/logout',   authController.logout);

//LOGGED IN — unverified allowed 
authRoute.get('/profile',          protect, authController.getProfile);
authRoute.post('/verify-facility', protect, authController.verifyFacility);

//SUPER ADMIN ONLY
// authRoute.post('/register-admin', protect, restrictTo('super_admin'), validatePassword, authController.register);

export default authRoute;