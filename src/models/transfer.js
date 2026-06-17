import mongoose from 'mongoose';

const transferSchema = new mongoose.Schema({
  requesterFacility: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true
  },
  providerFacility: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true
  },
  drugId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Drug', 
    required: true
  },
  transactionType: {
    type: String,
    enum: ['Discounted Offload', 'Standard Requisition'],
    required: true
  },
  quantityRequested: {
    type: Number,
    required: true
  },
  unit: {
    type: String,
    enum: ['Carton', 'Roll', 'Pack', 'Card', 'Bottle', 'Pieces'],
    required: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Pending Approval', 'Accepted', 'Rejected', 'Reverted', 'Completed'],
    default: 'Draft'
  },
  revertWindowEndsAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('Transfer', transferSchema);