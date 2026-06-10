import jwt from 'jsonwebtoken';
import User from '../models/user.js';

export const protect = async (req, res, next) => {
  try {

    // 1. check session exists
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Not logged in' });
    }

    // 2. fetch full user from DB using session
    const user = await User.findById(req.session.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    // 3. attach user to request
    req.user = user;

    // 4. second gate — block unverified users
    if (!req.user.isKeyVerified && req.user.role !== 'super_admin') {
      const pathOnly = req.originalUrl.split('?')[0];

      const allowedPaths = [
        '/api/facilities',
        '/api/auth/verify-facility',
        '/api/auth/profile',
        '/verify',
        '/profile',
        '/admin',
      ];

      const isAllowed = allowedPaths.some(p => pathOnly.startsWith(p));

      if (!isAllowed) {
        return res.status(403).json({
          message: 'Please verify your facility key to gain access',
        });
      }
    }

    // 5. all good
    next();

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};

export const sameFacility = (req, res, next) => {
  if (req.user.role === 'super_admin') return next();

  const requestedFacility = req.params.facility_id || req.body.facility_id;

  if (requestedFacility && requestedFacility !== req.user.facility_id?.toString()) {
    return res.status(403).json({
      message: 'Access denied — you can only access your own facility data',
    });
  }
  next();
};