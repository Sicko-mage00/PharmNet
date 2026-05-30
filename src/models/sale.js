import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  facility_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true,
  },
  drug_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Drug',
    required: true,
  },
  sold_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  quantity_sold: { type: Number, required: true, min: 1 },
  batch_number:  { type: String },
  unit_price:    { type: Number, min: 0 },
  patient_ref:   { type: String, trim: true },

  // State captured at moment of sale — audit trail + research metrics
  snapshot: {
    drug_name:       String,
    quantity_before: Number,
    quantity_after:  Number,
    reorder_point:   Number,
    rop_triggered:   { type: Boolean, default: false },
    fefo_triggered:  { type: Boolean, default: false },
    nearest_expiry:  Date,
  },
},
{
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

saleSchema.index({ facility_id: 1, created_at: -1 });
saleSchema.index({ drug_id: 1, created_at: -1 });

const Sale = mongoose.model('Sale', saleSchema);
export default Sale;