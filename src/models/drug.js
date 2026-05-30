import mongoose from 'mongoose';

// Each physical shipment is one batch entry
// pre('save') sorts them FEFO automatically
const batchSchema = new mongoose.Schema({
  batch_number:  { type: String, required: true },
  quantity:      { type: Number, required: true, min: 0 },
  expiry_date:   { type: Date,   required: true },
  unit_price:    { type: Number, min: 0 },
  received_date: { type: Date,   default: Date.now },
},
{ _id: false });

const drugSchema = new mongoose.Schema({
  facility_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true,
  },

  drug_name:    { type: String, required: true, trim: true },
  generic_name: { type: String, trim: true },
  barcode:      { type: String, unique: true, sparse: true, trim: true },
  unit:         { type: String, default: 'tablet' },
  category:     { type: String, trim: true },

  // Always derived from sum of batches — never set manually
  total_quantity: { type: Number, default: 0, min: 0 },

  batches: [batchSchema],

  // Alert fires when total_quantity <= reorder_point
  reorder_point: { type: Number, required: true, default: 10, min: 0 },

  // Alert fires if any batch expires within this many days
  expiry_alert_days: { type: Number, default: 90 },
  

  isActive: { type: Boolean, default: true },
},
{
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

drugSchema.index({ facility_id: 1, drug_name: 1 });
drugSchema.index({ facility_id: 1, total_quantity: 1 });
drugSchema.index({ 'batches.expiry_date': 1 });

// Sort batches FEFO + recalculate total on every save
drugSchema.pre('save', function (next) {
  if (this.batches && this.batches.length) {
    this.batches.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    this.total_quantity = this.batches.reduce((sum, b) => sum + b.quantity, 0);
  } else {
    this.total_quantity = 0;
  }
});

// First element is always nearest expiry after sort
drugSchema.virtual('nearest_expiry').get(function () {
  if (!this.batches || !this.batches.length) return null;
  return this.batches[0];
});

const Drug = mongoose.model('Drug', drugSchema);
export default Drug;