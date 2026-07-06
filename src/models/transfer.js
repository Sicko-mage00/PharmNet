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
    enum: ['Draft', 'Pending Approval', 'Accepted', 'Dispatched', 'Rejected', 'Reverted', 'Completed'],
    default: 'Draft'
  },
  revertWindowEndsAt: {
    type: Date,
    default: null
  },

  // ─── BROADCAST GROUPING ────────────────────────────────
  // A single request can go out to up to 4 provider facilities at once.
  // All Transfer docs created from that one request share a broadcast_id.
  // Whichever provider accepts first "wins" — every other Transfer in the
  // same broadcast_id is auto-reverted (see alertController.confirmAlert).
  broadcast_id: {
    type: mongoose.Schema.Types.ObjectId,
    index: true,
    default: null,
  },
  // How the requester arrived at quantityRequested — kept for audit/UI
  // display (e.g. "Standard Refill" vs "Custom").
  marginLabel: {
    type: String,
    default: 'Custom',
  },
  // ─── WHY THIS TRANSFER STOPPED BEING ACTIVE ────────────
  // Lets the UI tell "someone else fulfilled it" (auto_cancelled_broadcast —
  // don't nudge the requester to re-request) apart from "declined" or
  // "expired" (nobody responded — this is still unresolved, keep it
  // actionable so the requester can re-broadcast) apart from "manual"
  // (the requester themselves cancelled it).
  revert_reason: {
    type: String,
    enum: ['manual', 'declined', 'auto_cancelled_broadcast', 'expired', null],
    default: null,
  },
  notes: { type: String, trim: true },
}, { timestamps: true });

transferSchema.index({ broadcast_id: 1, status: 1 });

export default mongoose.model('Transfer', transferSchema);