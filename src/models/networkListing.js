import mongoose from 'mongoose';

// ─── ORDER QUEUE (per listing) ─────────────────────────────
// There's no real payment system, so "buying" works as a first-come
// reservation queue instead of instant purchase:
//   1. A facility places an order -> 'awaiting_confirmation', holding
//      that quantity out of the pool other facilities can order.
//   2. If they don't confirm (i.e. arrange/complete payment outside the
//      app) within confirm_by, the order 'expires' and the HELD quantity
//      is released back — the next order in the queue (if any, and if
//      quantity still fits) becomes the active hold.
//   3. Once confirmed, a revert/grace window opens (revert_by). The
//      listing stays visible on the marketplace during this window
//      (as "reserved," not purchasable for that quantity) so either
//      side can still back out.
//   4. Once revert_by passes with no cancellation, the order is
//      finalized: stock actually moves, the quantity is permanently
//      removed from the listing, and it shows up as "sold" in the
//      buyer's order history.
const listingOrderSchema = new mongoose.Schema({
  facility_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', required: true },
  quantity: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: [
      'awaiting_confirmation', // holding a slot, waiting on the buyer to confirm payment was arranged
      'confirmed',             // confirmed — now in the revert/grace window
      'completed',             // revert window passed — stock has actually moved
      'expired',               // didn't confirm in time — released back to the queue
      'cancelled',             // either party backed out during awaiting_confirmation or the revert window
    ],
    default: 'awaiting_confirmation',
    index: true,
  },
  ordered_at:   { type: Date, default: Date.now },
  confirm_by:   { type: Date, required: true }, // deadline to confirm payment arrangement
  confirmed_at: Date,
  revert_by:    Date, // grace/revert deadline, set once confirmed
  cancelled_by: { type: String, enum: ['buyer', 'seller', null], default: null },
  notes: { type: String, trim: true },
}, { timestamps: true });

const networkListingSchema = new mongoose.Schema({
  facility_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true,
    index: true,
  },

  drug_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
  drug_name:    { type: String, required: true, trim: true },
  generic_name: { type: String, trim: true },
  category:     { type: String, trim: true },
  unit:         {
    type: String,
    enum: ['Carton', 'Roll', 'Pack', 'Card', 'Bottle', 'Pieces'],
    required: true,
  },

  batch_number: { type: String },
  expiry_date:  { type: Date, required: true },

  unit_price: { type: Number, min: 0, default: 0 },

  // Original amount listed vs what's actually still open for new orders
  // (quantity_listed minus whatever is currently held/completed).
  quantity_listed:    { type: Number, required: true, min: 1 },
  quantity_remaining: { type: Number, required: true, min: 0 },

  orders: [listingOrderSchema],

  status: {
    type: String,
    enum: ['active', 'sold_out', 'withdrawn', 'expired'],
    default: 'active',
    index: true,
  },

  withdrawn_at: Date,
},
{
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

networkListingSchema.index({ status: 1, expiry_date: 1 });
networkListingSchema.index({ facility_id: 1, status: 1 });
networkListingSchema.index({ drug_name: 1, status: 1 });

// How much is currently held by orders that are still "live" (awaiting
// confirmation or confirmed-but-in-revert-window) — this quantity is
// NOT available for anyone else to order.
networkListingSchema.methods.heldQuantity = function () {
  return this.orders
    .filter((o) => ['awaiting_confirmation', 'confirmed'].includes(o.status))
    .reduce((sum, o) => sum + o.quantity, 0);
};

networkListingSchema.methods.availableToOrder = function () {
  return Math.max(0, this.quantity_remaining - this.heldQuantity());
};

const NetworkListing = mongoose.model('NetworkListing', networkListingSchema);
export default NetworkListing;
