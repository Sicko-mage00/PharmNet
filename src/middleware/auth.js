import jwt from 'jsonwebtoken';
import User from '../models/user.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. read token from Authorization header
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not logged in' });
    }

    // 2. verify token — throws if expired or tampered
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. fetch full user document from MongoDB using id inside token
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    // 4. attach user to request
    req.user = user;

    // 5. second gate — block unverified users from all protected routes
    if (!req.user.isKeyVerified && req.user.role !== 'super_admin') {
      const allowedUnverifiedPaths = new Set([
        // exact API endpoints
        '/api/facilities',
        // exact view endpoints (server-side Pug routes)
        '/profile',
        '/verify',
        // exact verify action (API)
        '/api/auth/verify-facility',
      ]);

      const pathOnly = req.originalUrl.split('?')[0];
      const isAllowed = allowedUnverifiedPaths.has(pathOnly);
      if (!isAllowed) {
        return res.status(403).json({
          message: 'Please verify your facility key to gain access',
        });
      }
    }
    
    // 6. all good — move to controller
    next();

  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── RESTRICT TO ──────────────────────────────────────────
// Usage: restrictTo('super_admin', 'facility_admin')
// Always comes AFTER protect — needs req.user to exist first
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