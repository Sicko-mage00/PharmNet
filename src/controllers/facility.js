import Facility from '../models/facility.js';

const facilityController = {

  // ─── CREATE FACILITY ───────────────────────────────────
  // POST /api/facilities
  // super_admin only
  createFacility: async (req, res) => {
    try {
        const { name, address, phone, type } = req.body;

        if (!name || !address || !phone) {
            return res.status(400).json({ message: 'name, address and phone are required' });
        }

        const facility = await Facility.create({
            name,
            address,
            phone,
            type,
        });

        res.status(201).json({
            status: 'success',
            message: 'Facility created successfully',
            facility,
        });

    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: 'Facility with this name already exists' });
      }
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── GET ALL FACILITIES ────────────────────────────────
  // GET /api/facilities
  // accessible to all logged in users — needed for verify-facility dropdown
  getAllFacilities: async (req, res) => {
    try {
      const facilities = await Facility.find({ isActive: true })
        .select('name phone address type isNetworkMember')
        .sort({ name: 1 });

      res.status(200).json({
        status: 'success',
        count: facilities.length,
        facilities,
      });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // GET SINGLE FACILITY 
  // GET /api/facilities/:id
  getFacility: async (req, res) => {
    try {
        const facility = await Facility.findById(req.params.id);

        if (!facility) {
            return res.status(404).json({ message: 'Facility not found' });
        }

        res.status(200).json({
            status: 'success',
            facility,
        });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  //UPDATE FACILITY 
  // PATCH /api/facilities/:id
  // super_admin only
  updateFacility: async (req, res) => {
    try {
        const { name, phone, address, type } = req.body;

        const facility = await Facility.findByIdAndUpdate(
            req.params.id,
            { name, phone, address, type },
            { returnDocument: 'after', runValidators: true }
        );

        if (!facility) {
            return res.status(404).json({ message: 'Facility not found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Facility updated successfully',
            facility,
        });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DEACTIVATE FACILITY ───────────────────────────────
  // PATCH /api/facilities/:id/deactivate
  // super_admin only
  deactivateFacility: async (req, res) => {
    try {
        const facility = await Facility.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { returnDocument: 'after' }
        );

        if (!facility) {
            return res.status(404).json({ message: 'Facility not found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Facility deactivated successfully',
        });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

};

export default facilityController;