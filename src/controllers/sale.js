import Sale from '../models/sale.js';
import Drug from '../models/drug.js';
import logicEngine from '../services/logicEngine.js';
import { matchROP, matchFEFO } from '../services/matcher.js';
import { emitAlert } from '../services/socket.js';

const saleController = {

  recordSale: async (req, res) => {
    try {
      const { drug_id, quantity_sold, unit_price, patient_ref } = req.body;

      if (!drug_id || !quantity_sold) {
        return res.status(400).json({ message: 'drug_id and quantity_sold are required' });
      }

      // ── Step 1: fetch drug ─────────────────────────────
      const drug = await Drug.findOne({
        _id: drug_id,
        facility_id: req.user.facility_id,
        isActive: true,
      });

      if (!drug) {
        return res.status(404).json({ message: 'Drug not found' });
      }

      // ── Step 2: check stock ────────────────────────────
      if (drug.total_quantity < quantity_sold) {
        return res.status(400).json({
          message: `Insufficient stock. Available: ${drug.total_quantity}`,
        });
      }

      // ── Step 3: deduct FEFO ────────────────────────────
      // Ensure FEFO ordering deterministically at sale-time.
      drug.batches = (drug.batches || []).sort(
        (a, b) => new Date(a.expiry_date) - new Date(b.expiry_date)
      );

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
      await drug.save();

      const quantity_after = drug.total_quantity;

      // ── Step 4: logic engine ───────────────────────────
      const engineResult = logicEngine(drug);

      // ── Step 5: create sale ────────────────────────────
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
          rop_triggered:   engineResult.rop_triggered,
          fefo_triggered:  engineResult.fefo_triggered,
          nearest_expiry:  drug.batches.length ? drug.batches[0].expiry_date : null,
        },
      });

      // ── Step 6: matcher ────────────────────────────────
      const alerts = [];

      if (engineResult.rop_triggered) {
        const ropResults = await matchROP(engineResult.rop_data, sale._id);
        for (const result of ropResults) {
          alerts.push(result);
          emitAlert(result.alert, result.matched);
        }
      }

      if (engineResult.fefo_triggered) {
        const fefoResults = await matchFEFO(engineResult.fefo_data, sale._id);
        for (const result of fefoResults) {
          alerts.push(result);
          emitAlert(result.alert, result.matched);
        }
      }

      res.status(201).json({
        status:           'success',
        message:          'Sale recorded',
        sale,
        alerts_triggered: alerts.length,
        alerts,
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
      const sale = await Sale.findOne({
        _id: req.params.id,
        facility_id: req.user.facility_id,
      })
        .populate('drug_id', 'drug_name unit')
        .populate('sold_by', 'firstName lastName');

      if (!sale) {
        return res.status(404).json({ message: 'Sale not found' });
      }

      res.status(200).json({ status: 'success', sale });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default saleController;