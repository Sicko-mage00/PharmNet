import Drug from '../models/drug.js';

// THE LOGIC ENGINE
// Called after every sale transaction
// Takes the updated drug document and runs two checks:
//   1. ROP check — is stock below reorder point?
//   2. FEFO check — is the nearest expiring batch about to expire?
// Returns an object with flags and data for the matcher

const logicEngine = (drug) => {

  // ── result object — starts with both flags false ───────
    const result = {
        rop_triggered:  false,
        fefo_triggered: false,
        rop_data:       null,
        fefo_data:      null,
    };

  // ROP CHECK 
  // Fires when total_quantity drops to or below reorder_point
  // e.g reorder_point = 50, total_quantity = 40 → triggered
    if (drug.total_quantity <= drug.reorder_point) {
        result.rop_triggered = true;
        result.rop_data = {
            drug_id:        drug._id,
            drug_name:      drug.drug_name,
            facility_id:    drug.facility_id,
            total_quantity: drug.total_quantity,
            reorder_point:  drug.reorder_point,
            // how much is needed to get back to reorder_point level
            quantity_needed: drug.reorder_point - drug.total_quantity,
        };
    }

  // FEFO CHECK 
  // Fires when the nearest expiring batch expires within
  // expiry_alert_days from today
  // e.g expiry_alert_days = 90, batch expires in 60 days → triggered
    if (drug.batches && drug.batches.length > 0) {

    // batches are already sorted FEFO by pre('save') hook
    // so batches[0] is always the nearest expiring batch
    const nearestBatch = drug.batches[0];

    const today = new Date();
    const expiryDate = new Date(nearestBatch.expiry_date);

    // difference in days between today and expiry date
    const daysUntilExpiry = Math.ceil(
        (expiryDate - today) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiry <= drug.expiry_alert_days && daysUntilExpiry >= 0) {
        result.fefo_triggered = true;
        result.fefo_data = {
            drug_id:          drug._id,
            drug_name:        drug.drug_name,
            facility_id:      drug.facility_id,
            batch_number:     nearestBatch.batch_number,
            quantity:         nearestBatch.quantity,
            expiry_date:      nearestBatch.expiry_date,
            days_until_expiry: daysUntilExpiry,
        };
    }
  }

  return result;
};

export default logicEngine;