import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  facility_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true
  },
  drug_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Drug',
    required: true
  },
  sold_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quantity_sold: {
    type: Number,
    required: true,
    min: 1
  },
  batch_number: {
    type: String
  },
  unit_price: {
    type: Number
  },
  patient_ref: {
    type: String
  },
  snapshot: {
    drug_name: { type: String },
    quantity_before: { type: Number },
    quantity_after: { type: Number },
    reorder_point: { type: Number },
    rop_triggered: { type: Boolean, default: false },
    nearest_expiry: { type: Date }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

const Sale = mongoose.model('Sale', saleSchema);
export default Sale;