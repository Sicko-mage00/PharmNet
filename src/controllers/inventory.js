import mongoose from 'mongoose';
import Drug from '../models/drug.js';

const inventoryController = {

  // ─── ADD DRUG ──────────────────────────────────────────
  addDrug: async (req, res) => {
    try {
      const {
            drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days,
            quantity, expiry_date, unit_price,
        } = req.body;

      // ── BACKEND SAFEGUARD: Auto-generate batch if missing ──
      const batch_number = req.body.batch_number || ('BCH-' + Math.random().toString(36).substr(2, 5).toUpperCase() + Date.now().toString().slice(-4));

      if (!drug_name || !quantity || !expiry_date || !reorder_point) {
        return res.status(400).json({ message: 'drug_name, quantity, expiry_date and reorder_point are required' });
      }

      const drug = await Drug.create({
            facility_id: req.user.facility_id,
            drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days,
            batches: [{ batch_number, quantity, expiry_date, unit_price }],
        }); 

      res.status(201).json({ status: 'success', message: 'Drug added successfully', drug });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'A drug with this barcode already exists' });
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  getAllDrugs: async (req, res) => {
    try {
      const drugs = await Drug.find({ facility_id: req.user.facility_id, isActive: true }).sort({ drug_name: 1 });
      res.status(200).json({ status: 'success', count: drugs.length, drugs });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  getDrug: async (req, res) => {
    try {
      const drug = await Drug.findOne({ _id: req.params.id, facility_id: req.user.facility_id });
      if (!drug) return res.status(404).json({ message: 'Drug not found' });
      res.status(200).json({ status: 'success', drug });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  updateDrug: async (req, res) => {
        try {
            const { drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days } = req.body;
            const drug = await Drug.findOneAndUpdate(
                { _id: req.params.id, facility_id: req.user.facility_id },
                { drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days },
                { returnDocument: 'after', runValidators: true }
            );
            if (!drug) return res.status(404).json({ message: 'Drug not found' });
            res.status(200).json({ status: 'success', message: 'Drug updated', drug });
        } catch (err) {
            res.status(500).json({ message: 'Server error', error: err.message });
        }
    },

  deactivateDrug: async (req, res) => {
    try {
        const drug = await Drug.findOneAndUpdate(
            { _id: req.params.id, facility_id: req.user.facility_id },
            { isActive: false },
            { returnDocument: 'after' }
        );
        if (!drug) return res.status(404).json({ message: 'Drug not found' });
        res.status(200).json({ status: 'success', message: 'Drug deactivated' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── ADD BATCH ─────────────────────────────────────────
  addBatch: async (req, res) => {
    try {
        const { quantity, expiry_date, unit_price } = req.body;
        // ── BACKEND SAFEGUARD ──
        const batch_number = req.body.batch_number || ('BCH-' + Math.random().toString(36).substr(2, 5).toUpperCase() + Date.now().toString().slice(-4));

        if (!quantity || !expiry_date) return res.status(400).json({ message: 'quantity and expiry_date are required' });
        
        const drug = await Drug.findOne({ _id: req.params.id, facility_id: req.user.facility_id });
        if (!drug) return res.status(404).json({ message: 'Drug not found' });

        drug.batches.push({ batch_number, quantity, expiry_date, unit_price });
        await drug.save();

        res.status(200).json({ status: 'success', message: 'Batch added successfully', drug });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default inventoryController;