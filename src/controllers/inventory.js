import Drug from '../models/drug.js';

const inventoryController = {

  // ─── ADD DRUG ──────────────────────────────────────────
  // POST /api/inventory
  addDrug: async (req, res) => {
    try {
      const {
            drug_name, // required
            generic_name,
            barcode,
            unit,
            category,
            reorder_point, // required
            expiry_alert_days,
            batch_number, // required for initial stock entry
            quantity, // required 
            expiry_date, // required
            unit_price,
        } = req.body;

      if (!drug_name || !batch_number || !quantity || !expiry_date || !reorder_point) {
        return res.status(400).json({
          message: 'drug_name, batch_number, quantity, expiry_date and reorder_point are required',
        });
      }

      // facility_id comes from the logged in user — not from req.body
      // a pharmacist can only add drugs to their own facility
      const drug = await Drug.create({
            facility_id: req.user.facility_id,
            drug_name,
            generic_name,
            barcode,
            unit,
            category,
            reorder_point,
            expiry_alert_days,
            batches: [{
            batch_number,
            quantity,
            expiry_date,
            unit_price,
            }],
            // total_quantity is calculated automatically by pre('save') hook
        }); 

      res.status(201).json({
        status: 'success',
        message: 'Drug added successfully',
        drug,
      });

    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'A drug with this barcode already exists' });
        }
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── GET ALL DRUGS ─────────────────────────────────────
  // GET /api/inventory
  getAllDrugs: async (req, res) => {
    try {
      const drugs = await Drug.find({
        facility_id: req.user.facility_id,
        isActive: true,
      }).sort({ drug_name: 1 });

        res.status(200).json({
            status: 'success',
            count: drugs.length,
            drugs,
        });

    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── GET SINGLE DRUG ───────────────────────────────────
  // GET /api/inventory/:id
  getDrug: async (req, res) => {
    try {
        const drug = await Drug.findOne({
            _id: req.params.id,
            facility_id: req.user.facility_id, // ensures facility isolation
        });

        if (!drug) {
            return res.status(404).json({ message: 'Drug not found' });
        }

        res.status(200).json({
            status: 'success',
            drug,
        });

    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── UPDATE DRUG ───────────────────────────────────────
  // PATCH /api/inventory/:id
  // updates drug details — NOT stock levels
  // stock is managed through batches
  updateDrug: async (req, res) => {
        try {
        const {
            drug_name,
            generic_name,
            barcode,
            unit,
            category,
            reorder_point,
            expiry_alert_days,
        } = req.body;

            const drug = await Drug.findOneAndUpdate(
                { _id: req.params.id, facility_id: req.user.facility_id },
                { drug_name, generic_name, barcode, unit, category, reorder_point, expiry_alert_days },
                { returnDocument: 'after', runValidators: true }
            );

            if (!drug) {
                return res.status(404).json({ message: 'Drug not found' });
            }

            res.status(200).json({
                status: 'success',
                message: 'Drug updated successfully',
                drug,
            });

        } catch (err) {
            res.status(500).json({ message: 'Server error', error: err.message });
        }
    },

  // ─── DEACTIVATE DRUG ───────────────────────────────────
  // DELETE /api/inventory/:id
  // soft delete — never actually remove drug records
  deactivateDrug: async (req, res) => {
    try {
        const drug = await Drug.findOneAndUpdate(
            { _id: req.params.id, facility_id: req.user.facility_id },
            { isActive: false },
            { returnDocument: 'after' }
        );

        if (!drug) {
            return res.status(404).json({ message: 'Drug not found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Drug deactivated successfully',
        });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── ADD BATCH ─────────────────────────────────────────
  // POST /api/inventory/:id/batch
  // when a facility restocks — adds a new shipment batch to existing drug
  addBatch: async (req, res) => {
    try {
        const { batch_number, quantity, expiry_date, unit_price } = req.body;

        if (!batch_number || !quantity || !expiry_date) {
            return res.status(400).json({
            message: 'batch_number, quantity and expiry_date are required',
            });
        }

        const drug = await Drug.findOne({
            _id: req.params.id,
            facility_id: req.user.facility_id,
        });

        if (!drug) {
            return res.status(404).json({ message: 'Drug not found' });
        }

        // push new batch — pre('save') will sort FEFO and recalculate total
        drug.batches.push({ batch_number, quantity, expiry_date, unit_price });
        await drug.save();

        res.status(200).json({
            status: 'success',
            message: 'Batch added successfully',
            drug,
        });

    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

};

export default inventoryController;