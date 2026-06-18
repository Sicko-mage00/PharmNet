import mongoose from 'mongoose';
import Drug from '../models/drug.js';
import Alert from '../models/alert.js'; 
import { emitAlert } from '../services/socket.js'; 

// ── THE DSS TRIGGER ENGINE (Inventory Hook) ──
const checkAndTriggerAlerts = async (drug, facility_id) => {
    let alerts_created = 0;

    // 1. ROP (Low Stock) Check
    if (drug.total_quantity <= drug.reorder_point) {
        const existingROP = await Alert.findOne({ 
            type: 'ROP', drug_id: drug._id, status: 'pending', source_facility: facility_id 
        });

        if (!existingROP) {
            const newAlert = await Alert.create({
                type: 'ROP',
                drug_id: drug._id,
                drug_name: drug.drug_name,
                source_facility: facility_id,
                target_facility: facility_id, 
                quantity_available: drug.total_quantity,
                quantity_needed: drug.reorder_point * 2, 
                status: 'pending',
                notes: 'System generated: Stock dropped below reorder point.'
            });
            emitAlert(newAlert, true);
            alerts_created++;
        }
    }

    // 2. FEFO (Expiry) Check
    const today = new Date();
    for (const batch of drug.batches) {
        const daysToExpiry = Math.ceil((new Date(batch.expiry_date) - today) / (1000 * 60 * 60 * 24));
        
        if (daysToExpiry <= (drug.expiry_alert_days || 180) && daysToExpiry > 0) {
            const existingFEFO = await Alert.findOne({ 
                type: 'FEFO', drug_id: drug._id, batch_number: batch.batch_number, 
                status: 'pending', source_facility: facility_id 
            });

            if (!existingFEFO) {
                const newAlert = await Alert.create({
                    type: 'FEFO',
                    drug_id: drug._id,
                    drug_name: drug.drug_name,
                    batch_number: batch.batch_number,
                    expiry_date: batch.expiry_date,
                    source_facility: facility_id,
                    target_facility: facility_id,
                    quantity_available: batch.quantity,
                    status: 'pending',
                    notes: `System generated: Batch expires in ${daysToExpiry} days.`
                });
                emitAlert(newAlert, true);
                alerts_created++;
            }
        }
    }
    return alerts_created;
};

const inventoryController = {

  // ─── ADD DRUG ──────────────────────────────────────────
  addDrug: async (req, res) => {
    try {
      const {
            drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days,
            quantity, expiry_date, unit_price, batch_barcode
        } = req.body;

      const batch_number = req.body.batch_number || 'BATCH-001';

      if (!drug_name || !quantity || !expiry_date || !reorder_point) {
        return res.status(400).json({ message: 'drug_name, quantity, expiry_date and reorder_point are required' });
      }

      const drug = await Drug.create({
            facility_id: req.user.facility_id,
            drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days,
            batches: [{ batch_number, quantity, expiry_date, unit_price, barcode: batch_barcode }],
        }); 

      // Trigger DSS Scan
      await checkAndTriggerAlerts(drug, req.user.facility_id);

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
            
            // Trigger DSS Scan (in case reorder point was changed to trigger an alert)
            await checkAndTriggerAlerts(drug, req.user.facility_id);

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
        const { quantity, expiry_date, unit_price, batch_barcode } = req.body;
        
        const drug = await Drug.findOne({ _id: req.params.id, facility_id: req.user.facility_id });
        if (!drug) return res.status(404).json({ message: 'Drug not found' });

        const nextNum = drug.batches.length + 1;
        const autoBatchString = `BATCH-${String(nextNum).padStart(3, '0')}`;
        const batch_number = req.body.batch_number || autoBatchString;

        if (!quantity || !expiry_date) return res.status(400).json({ message: 'quantity and expiry_date are required' });

        drug.batches.push({ batch_number, quantity, expiry_date, unit_price, barcode: batch_barcode });
        await drug.save();

        // Trigger DSS Scan
        await checkAndTriggerAlerts(drug, req.user.facility_id);

        res.status(200).json({ status: 'success', message: 'Batch added successfully', drug });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default inventoryController;