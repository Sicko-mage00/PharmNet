import FacilityKey from '../models/facilityKey.js';
import Facility from '../models/facility.js';
import crypto from 'crypto';

const facilityKeyController = {

  generateKey: async (req, res) => {
    try {
      const { facility_id, role, maxUses, expiresInDays } = req.body;

      if (!facility_id || !role) {
        return res.status(400).json({ message: 'facility_id and role are required' });
      }

      const facility = await Facility.findById(facility_id);
      if (!facility) {
        return res.status(404).json({ message: 'Facility not found' });
      }

      // generate random unique code e.g A3F2B1C9
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();

      const expiresAt = new Date(
        Date.now() + (expiresInDays || 7) * 24 * 60 * 60 * 1000
      );

      const key = await FacilityKey.create({
        facility_id,
        name: facility.name, // store facility name for easy reference in listings
        code,
        role,
        maxUses: maxUses || 1,
        expiresAt,
        createdBy: req.user.id,
      });

      res.status(201).json({
        message: 'Key generated successfully',
        key: {
          code: key.code,
          facility: facility.name,
          role: key.role,
          maxUses: key.maxUses,
          expiresAt: key.expiresAt,
        },
      });

    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: 'Key collision — try again' });
      }
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  listKeys: async (req, res) => {
    try {
      const keys = await FacilityKey.find()
        .populate('facility_id', 'name')
        .populate('createdBy', 'firstName lastName')
        .sort({ created_at: -1 });

      res.status(200).json({ status: 'success', keys });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  deactivateKey: async (req, res) => {
    try {
      const key = await FacilityKey.findById(req.params.id);
      if (!key) {
        return res.status(404).json({ message: 'Key not found' });
      }

      key.isActive = false;
      await key.save();

      res.status(200).json({ message: 'Key deactivated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

};

export default facilityKeyController;