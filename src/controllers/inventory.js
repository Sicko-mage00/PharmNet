import mongoose from 'mongoose';
import Drug from '../models/drug.js';
import Alert from '../models/alert.js'; 
import { emitAlert } from '../services/socket.js'; 
import { getSafeMargins } from '../services/quantityMargins.js';

// ── NEW: Pascal Case Formatter ──
const toTitleCase = (str) => {
  if (!str) return '';
  return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

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
        
        // BUG FIX: Removed "> 0" so it triggers instantly for expired batches added manually
        if (daysToExpiry <= (drug.expiry_alert_days || 180)) {
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
                    // BUG FIX: Dynamic notes specifically for expired vs expiring
                    notes: daysToExpiry <= 0 
                        ? `System generated: Batch EXPIRED!` 
                        : `System generated: Batch expires in ${daysToExpiry} days.`
                });
                emitAlert(newAlert, true);
                alerts_created++;
            }
        }
    }
    return alerts_created;
};

const inventoryController = {

  getAllDrugs: async (req, res) => {
    try {
      // 1. SAFEGUARD: If no req.user, the Auth middleware failed to attach it
      if (!req.user) {
        console.error("DEBUG: getAllDrugs called but req.user is undefined!");
        return res.status(401).json({ message: "Unauthorized - Please login again." });
      }

      console.log("DEBUG: Facility ID for this request:", req.user.facility_id);

      // 2. SAFEGUARD: If facility_id is missing
      if (!req.user.facility_id) {
        console.error("DEBUG: req.user exists, but facility_id is missing!");
        return res.status(400).json({ message: "Facility ID not set in session." });
      }

      const drugs = await Drug.find({ 
        facility_id: req.user.facility_id, 
        isActive: true 
      }).sort({ drug_name: 1 });

      res.status(200).json({ status: 'success', count: drugs.length, drugs });
    } catch (err) {
      console.error("DEBUG: Inventory DB error:", err);
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  getDrug: async (req, res) => {
    try {
      const drug = await Drug.findOne({ _id: req.params.id, facility_id: req.user.facility_id, isActive: true });
      if (!drug) return res.status(404).json({ message: 'Drug not found' });
      res.status(200).json({ status: 'success', drug, safeMargins: getSafeMargins(drug) });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  addDrug: async (req, res) => {
    try {
      let {
        drug_name,
        generic_name,
        barcode,
        unit,
        category,
        reorder_point,
        expiry_alert_days,
        batches,
      } = req.body;

      if (!drug_name) {
        return res.status(400).json({
          message: 'Drug name is required',
        });
      }

      drug_name = toTitleCase(drug_name);

      if (generic_name) {
        generic_name = toTitleCase(generic_name);
      }

      let initialBatches = [];

      if (batches && batches.length > 0) {
        const {
          batch_number,
          quantity,
          expiry_date,
          unit_price,
          batch_barcode,
        } = batches[0];

        const batchNum =
          batch_number ||
          await generateBatchNumber(
            Drug,
            req.user.facility_id,
            drug_name
          );

          initialBatches = [{
            batch_number: batchNum,
            quantity,
            expiry_date,
            unit_price,
            ...(batch_barcode && batch_barcode.trim() ? { barcode: batch_barcode.trim() } : {}),
          }];
      }

      const drugData = {
        facility_id: req.user.facility_id,
        drug_name,
        generic_name,
        unit,
        category,
        reorder_point,
        expiry_alert_days,
        batches: initialBatches,
      };

      if (barcode && barcode.trim()) {
        drugData.barcode = barcode.trim();
      }

      const drug = await Drug.create(drugData);

      await checkAndTriggerAlerts(
        drug,
        req.user.facility_id
      );

      res.status(201).json({
        status: 'success',
        message: 'Drug added successfully',
        drug,
      });

    } catch (err) {
      console.error(err); // TEMP - remove after debugging
      res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  },

  updateDrug: async (req, res) => {
    try {
      let { drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days } = req.body;
      
      // Apply Pascal Case formatting
      drug_name = toTitleCase(drug_name);
      generic_name = toTitleCase(generic_name);

      const drug = await Drug.findOneAndUpdate(
          { _id: req.params.id, facility_id: req.user.facility_id, isActive: true },
          { drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days },
          { returnDocument: 'after', runValidators: true }
      );
      if (!drug) return res.status(404).json({ message: 'Drug not found' });
      
      await checkAndTriggerAlerts(drug, req.user.facility_id);

      res.status(200).json({ status: 'success', message: 'Drug updated', drug });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  addBatch: async (req, res) => {
    try {
      const {
        batch_number,
        quantity,
        expiry_date,
        unit_price,
        batch_barcode,
      } = req.body;

      if (!quantity || !expiry_date) {
        return res.status(400).json({
          message: 'Quantity and expiry date are required',
        });
      }

      const drug = await Drug.findOne({
        _id: req.params.id,
        facility_id: req.user.facility_id,
        isActive: true,
      });

      if (!drug) {
        return res.status(404).json({
          message: 'Drug not found',
        });
      }

      const batchNum =
        batch_number ||
        await generateBatchNumber(
          Drug,
          req.user.facility_id,
          drug.drug_name
        );

      drug.batches.push({
        batch_number: batchNum,
        quantity,
        expiry_date,
        unit_price,
        barcode: batch_barcode,
      });

      await drug.save();

      await checkAndTriggerAlerts(
        drug,
        req.user.facility_id
      );

      res.status(200).json({
        status: 'success',
        message: 'Batch added successfully',
        drug,
      });

    } catch (err) {
      res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  },

  deleteBatch: async (req, res) => {
    try {
      const { id, batch_number } = req.params;
      const drug = await Drug.findOne({ _id: id, facility_id: req.user.facility_id, isActive: true });
      
      if (!drug) return res.status(404).json({ message: 'Drug not found' });

      drug.batches = drug.batches.filter(b => b.batch_number !== batch_number);
      await drug.save();

      res.status(200).json({ status: 'success', message: 'Batch deleted' });
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
      res.status(200).json({ status: 'success', message: 'Drug deactivated', drug });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  deleteDrug: async (req, res) => {
    try {
      const drug = await Drug.findOneAndDelete({ _id: req.params.id, facility_id: req.user.facility_id });
      if (!drug) return res.status(404).json({ message: 'Drug not found' });
      
      // Cascading Delete: Wipe all alerts associated with this deleted drug
      await Alert.deleteMany({ drug_id: req.params.id });

      res.status(200).json({ status: 'success', message: 'Drug and associated alerts completely deleted' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }
};

export default inventoryController;