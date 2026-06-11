import User from '../models/user.js';

const adminController = {

  // ─── GET ALL USERS ─────────────────────────────────────
  // GET /api/admin/users
  // super_admin only
  getAllUsers: async (req, res) => {
    try {
      const users = await User.find()
        .populate('facility_id', 'name')
        .select('-password')
        .sort({ created_at: -1 });

      res.status(200).json({
        status: 'success',
        count:  users.length,
        users,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CHANGE USER ROLE ──────────────────────────────────
  // PATCH /api/admin/users/:id/role
  // super_admin only
  changeUserRole: async (req, res) => {
    try {
      const { role } = req.body;

      const allowed = ['pharmacist', 'facility_admin', 'super_admin'];
      if (!role || !allowed.includes(role)) {
        return res.status(400).json({ message: `role must be one of: ${allowed.join(', ')}` });
      }

      // prevent super_admin from demoting themselves
      if (req.params.id === req.user.id.toString()) {
        return res.status(400).json({ message: 'You cannot change your own role' });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { role },
        { new: true, runValidators: true }
      ).populate('facility_id', 'name').select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.status(200).json({
        status:  'success',
        message: 'Role updated successfully',
        user,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DEACTIVATE USER ───────────────────────────────────
  // PATCH /api/admin/users/:id/deactivate
  // super_admin only
  deactivateUser: async (req, res) => {
    try {
      if (req.params.id === req.user.id.toString()) {
        return res.status(400).json({ message: 'You cannot deactivate your own account' });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.status(200).json({
        status:  'success',
        message: 'User deactivated successfully',
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

};

export default adminController;
