import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['ROP', 'FEFO'],
    required: true,
    index: true,
  },

  drug_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
  drug_name: { type: String },

  source_facility: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true,
  },
  target_facility: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true,
  },

  quantity_available: { type: Number },
  quantity_needed:    { type: Number },
  expiry_date:        { type: Date },

  triggered_by_sale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale',
  },

  status: {
    type: String,
    enum: [
      'pending',       // waiting for source to respond
      'confirmed',     // source agreed — first to respond wins
      'dispatched',    // source delivered drugs to target
      'cancelled',     // another source confirmed first
      'declined',      // source explicitly refused
      'self_resolved', // target handled it externally
      'resolved',      // physical transfer completed, target has received drugs
      'expired',       // nobody responded in 24hrs
    ],
    default: 'pending',
    index: true,
  },

  response_deadline: { type: Date, default: null }, // set when alert is created

  acknowledged_at: Date,
  resolved_at:     Date,
  dispatched_at: Date,

  expires_at: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24hrs
  },

  notes: { type: String, trim: true },
},
{
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

alertSchema.index({ target_facility: 1, status: 1, created_at: -1 });
alertSchema.index({ source_facility: 1, status: 1, created_at: -1 });

const Alert = mongoose.model('Alert', alertSchema);
export default Alert;