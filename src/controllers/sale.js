import mongoose from 'mongoose';
import Sale from '../models/sale.js';
import Drug from '../models/drug.js';
import Alert from '../models/alert.js'; // We now trigger alerts directly!
import { emitAlert, getIO } from '../services/socket.js';

const saleController = {

  recordSale: async (req, res) => {
    try {
      const { drug_id, quantity_sold, unit_price, patient_ref } = req.body;

      if (!drug_id || !quantity_sold) {
        return res.status(400).json({ message: 'drug_id and quantity_sold are required' });
      }

      // ── Step 1: fetch drug ──
      const drug = await Drug.findOne({ _id: drug_id, facility_id: req.user.facility_id, isActive: true });
      if (!drug) return res.status(404).json({ message: 'Drug not found' });

      // ── Step 2: check stock ──
      if (drug.total_quantity < quantity_sold) {
        return res.status(400).json({ message: `Insufficient stock. Available: ${drug.total_quantity}` });
      }

      // ── Step 3: deduct FEFO (Oldest expiry first) ──
      drug.batches = (drug.batches || []).sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

      const quantity_before = drug.total_quantity;
      let remaining = quantity_sold;
      let dispensed_batch = drug.batches.length ? drug.batches[0].batch_number : null;

      for (const batch of drug.batches) {
        if (remaining <= 0) break;
        if (batch.quantity >= remaining) {
          batch.quantity -= remaining;
          dispensed_batch = batch.batch_number;
          remaining = 0;
        } else {
          remaining -= batch.quantity;
          batch.quantity = 0;
        }
      }

      drug.batches = drug.batches.filter(b => b.quantity > 0);
      await drug.save(); // total_quantity auto-updates here via Mongoose hooks

      const quantity_after = drug.total_quantity;
      let rop_triggered = false;
      let alerts_created = 0;

      // ── Step 4: THE DSS TRIGGER ENGINE (ROP) ──
      if (quantity_after <= drug.reorder_point) {
          rop_triggered = true;
          // Duplication Prevention: Check if an active ROP alert already exists
          const existingROP = await Alert.findOne({ 
              type: 'ROP', drug_id: drug._id, status: 'pending', 
              source_facility: req.user.facility_id, target_facility: req.user.facility_id 
          });

          if (!existingROP) {
              const newAlert = await Alert.create({
                  type: 'ROP',
                  drug_id: drug._id,
                  drug_name: drug.drug_name,
                  source_facility: req.user.facility_id,
                  target_facility: req.user.facility_id, // Internal alert = same facility
                  quantity_available: quantity_after,
                  quantity_needed: drug.reorder_point * 2, // Standard DSS logic: request double the minimum
                  status: 'pending',
                  notes: 'System generated: Inventory dropped below reorder point.'
              });
              emitAlert(newAlert, true);
              alerts_created++;
          }
      }

      // ── Step 5: THE DSS TRIGGER ENGINE (FEFO) ──
      const today = new Date();
      for (const batch of drug.batches) {
          const daysToExpiry = Math.ceil((new Date(batch.expiry_date) - today) / (1000 * 60 * 60 * 24));
          
          if (daysToExpiry <= (drug.expiry_alert_days || 180) && daysToExpiry > 0) {
              const existingFEFO = await Alert.findOne({ 
                  type: 'FEFO', drug_id: drug._id, batch_number: batch.batch_number, status: 'pending',
                  source_facility: req.user.facility_id, target_facility: req.user.facility_id
              });

              if (!existingFEFO) {
                  const newAlert = await Alert.create({
                      type: 'FEFO',
                      drug_id: drug._id,
                      drug_name: drug.drug_name,
                      batch_number: batch.batch_number,
                      expiry_date: batch.expiry_date,
                      source_facility: req.user.facility_id,
                      target_facility: req.user.facility_id,
                      quantity_available: batch.quantity,
                      status: 'pending',
                      notes: `System generated: Batch expires in ${daysToExpiry} days.`
                  });
                  emitAlert(newAlert, true);
                  alerts_created++;
              }
          }
      }

      // ── Step 6: Create Sale Record ──
      const sale = await Sale.create({
        facility_id:  req.user.facility_id,
        drug_id:      drug._id,
        sold_by:      req.user._id,
        quantity_sold,
        batch_number: dispensed_batch,
        unit_price,
        patient_ref,
        snapshot: {
          drug_name:       drug.drug_name,
          quantity_before,
          quantity_after,
          reorder_point:   drug.reorder_point,
          rop_triggered:   rop_triggered,
          nearest_expiry:  drug.batches.length ? drug.batches[0].expiry_date : null,
        },
      });

      res.status(201).json({
        status: 'success',
        message: 'Sale recorded successfully',
        sale,
        alerts_triggered: alerts_created
      });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  getAllSales: async (req, res) => {
    try {
      const sales = await Sale.find({ facility_id: req.user.facility_id })
        .populate('drug_id', 'drug_name unit')
        .populate('sold_by', 'firstName lastName')
        .sort({ created_at: -1 });

      res.status(200).json({ status: 'success', count: sales.length, sales });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  getSale: async (req, res) => {
    try {
      const sale = await Sale.findOne({ _id: req.params.id, facility_id: req.user.facility_id })
        .populate('drug_id', 'drug_name unit')
        .populate('sold_by', 'firstName lastName');

      if (!sale) return res.status(404).json({ message: 'Sale not found' });
      res.status(200).json({ status: 'success', sale });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default saleController;