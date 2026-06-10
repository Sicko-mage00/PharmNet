import User from '../models/user.js';
import Facility from '../models/facility.js';
import FacilityKey from '../models/facilityKey.js';

const authController = {

  register: async (req, res) => {
    try {
      const { firstName, lastName, email, phone, password } = req.body;

      const user = await User.create({
        email,
        firstName,
        lastName,
        phone,
        password,  // pre('save') hook hashes this
      });
      
      const fullName = `${user.lastName} ${user.firstName}`;

      res.status(201).json({
          status: 'success',
          message: 'Registration successful',
          name: fullName,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      const user = await User.findOne({ email }).select('+password');

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      if (!user.isActive) {
        return res.status(403).json({ message: 'Account deactivated. Contact your admin.' });
      }

      // store in server-side session — cookie sent automatically
      req.session.userId      = user._id.toString();
      req.session.role        = user.role;
      req.session.facility_id = user.facility_id ? user.facility_id.toString() : null;

      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });

      const fullName = `${user.lastName} ${user.firstName}`;

      res.status(200).json({
        status:    'success',
        message:   'Login successful',
        name:      fullName,
        role:      user.role,
        facility:  user.facility_id ? user.facility_id.name : null,
        email:     user.email,
        isKeyVerified: user.isKeyVerified,
      });

    } catch (err) {
      res.status(500).json({ message: 'Server login error', error: err.message });
    }
  },

  logout: (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error(err);
      res.status(200).json({ status: 'success', message: 'Logged out' });
    });
  },

  getProfile: async (req, res) => {
    try {
      const user = await User.findById(req.user.id)
        .populate('facility_id', 'name location');
      res.status(200).json({ status: 'success', user });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },

  verifyFacility: async (req, res) => {
    try {
      const { code, facility_id } = req.body;
  
      if (!code || !facility_id) {
        return res.status(400).json({ message: 'Code and facility are required' });
      }
  
      // find the key matching both code and facility
      const key = await FacilityKey.findOne({ code, facility_id });

      // after updating user, fetch the facility name
      const facility = await Facility.findById(key.facility_id).select('name');
  
      if (!key) {
        return res.status(404).json({ message: 'Invalid key' });
      }
  
      // check validity
      if (!key.isValid) {
        return res.status(400).json({ message: 'Key is expired or no longer valid' });
      }
  
      // link facility and role to user, mark as verified
      await User.findByIdAndUpdate(req.user.id, {
        facility_id: key.facility_id,
        role: key.role,
        isKeyVerified: true,
      }, { new: true });
  
      // increment usage count
      key.usedCount += 1;
      if (key.usedCount >= key.maxUses) {
        key.isActive = false; // auto-deactivate when exhausted
      }
      await key.save();
  
      res.status(200).json({
        message: 'Facility verified successfully',
        role: key.role,
        facility: facility ? facility.name : null,
      });
  
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }
};


export default authController;