import User from '../models/user.js';

// The seeded super admin email — only this account can assign roles
const SEEDED_ADMIN_EMAIL = process.env.SEEDED_ADMIN_EMAIL || 'okepeter83@gmail.com';

const adminController = {

  getAllUsers: async (req, res) => {
    try {
      // exclude the seeded super admin from the list
      const users = await User.find({ email: { $ne: SEEDED_ADMIN_EMAIL } })
        .populate('facility_id', 'name')
        .select('-password')
        .sort({ created_at: -1 });

      res.status(200).json({
        status:           'success',
        count:            users.length,
        users,
        canAssignRoles:   req.user.email === SEEDED_ADMIN_EMAIL,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  changeUserRole: async (req, res) => {
    try {
      // ONLY the seeded admin can change roles
      if (req.user.email !== SEEDED_ADMIN_EMAIL) {
        return res.status(403).json({ message: 'Only the primary admin can assign roles' });
      }

      const { role } = req.body;
      const allowed  = ['pharmacist', 'facility_admin', 'super_admin'];

      if (!role || !allowed.includes(role)) {
        return res.status(400).json({ message: `Role must be one of: ${allowed.join(', ')}` });
      }

      if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot change your own role' });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { role },
        { new: true, runValidators: true }
      ).populate('facility_id', 'name').select('-password');

      if (!user) return res.status(404).json({ message: 'User not found' });

      res.status(200).json({ status: 'success', message: 'Role updated', user });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  deactivateUser: async (req, res) => {
    try {
      if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot deactivate your own account' });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      ).select('-password');

      if (!user) return res.status(404).json({ message: 'User not found' });

      res.status(200).json({ status: 'success', message: 'User deactivated' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  deleteKey: async (req, res) => {
    try {
      const FacilityKey = (await import('../models/facilityKey.js')).default;
      await FacilityKey.findByIdAndDelete(req.params.id);
      res.status(200).json({ status: 'success', message: 'Key deleted' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  deleteFacility: async (req, res) => {
    try {
      const Facility = (await import('../models/facility.js')).default;
      await Facility.findByIdAndDelete(req.params.id);
      res.status(200).json({ status: 'success', message: 'Facility deleted' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default adminController;