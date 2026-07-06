import NetworkListing from '../models/networkListing.js';
import Drug from '../models/drug.js';
import { getIO } from '../services/socket.js';
import { activateQueue } from '../services/marketplaceQueue.js';

// ─── TIMING WINDOWS ─────────────────────────────────────
// No real payment integration, so these are the manual-confirmation
// windows described in the design: a short window to confirm you've
// arranged payment, then a longer grace window where either side can
// still back out before stock actually moves.
const CONFIRM_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours to confirm
const REVERT_WINDOW_MS  = 60 * 60 * 1000;     // 1 hour grace/revert window after confirming

const marketplaceController = {
  // ─── LIST A DRUG ───────────────────────────────────────
  // POST /api/marketplace
  createListing: async (req, res) => {
    try {
      const { drugId, batch_number, quantity, unit_price, unit } = req.body;

      const drug = await Drug.findOne({ _id: drugId, facility_id: req.user.facility_id, isActive: true });
      if (!drug) return res.status(404).json({ message: 'Drug not found in your inventory' });

      const batch = batch_number
        ? drug.batches.find((b) => b.batch_number === batch_number)
        : drug.batches[0]; // nearest-expiry batch (already FEFO-sorted)

      if (!batch) return res.status(400).json({ message: 'No matching batch found to list' });

      const qty = Number(quantity) || batch.quantity;
      if (qty <= 0 || qty > batch.quantity) {
        return res.status(400).json({ message: `Quantity must be between 1 and ${batch.quantity} (the batch's current stock)` });
      }

      const listing = await NetworkListing.create({
        facility_id: req.user.facility_id,
        drug_id: drug._id,
        drug_name: drug.drug_name,
        generic_name: drug.generic_name,
        category: drug.category,
        unit: unit || drug.unit,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        unit_price: unit_price || batch.unit_price || 0,
        quantity_listed: qty,
        quantity_remaining: qty,
      });

      res.status(201).json({ status: 'success', message: 'Listed on the network marketplace', listing });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── BROWSE THE MARKETPLACE ────────────────────────────
  // GET /api/marketplace?drugName=&state=&sort=expiry|price|tier
  getListings: async (req, res) => {
    try {
      const { drugName, state, sort } = req.query;

      const query = {
        status: 'active',
        quantity_remaining: { $gt: 0 },
        facility_id: { $ne: req.user.facility_id },
      };
      if (drugName) query.drug_name = { $regex: drugName, $options: 'i' };

      let listings = await NetworkListing.find(query)
        .populate('facility_id', 'name phone tier tier_rank address type');

      if (state) {
        listings = listings.filter((l) => l.facility_id && l.facility_id.address && l.facility_id.address.state === state);
      }

      listings.sort((a, b) => {
        if (sort === 'price') return (a.unit_price || 0) - (b.unit_price || 0);
        if (sort === 'tier') return (b.facility_id?.tier_rank || 0) - (a.facility_id?.tier_rank || 0);
        return new Date(a.expiry_date) - new Date(b.expiry_date); // default: soonest-expiring
      });

      // Don't leak other facilities' order details — just the numbers
      // a browsing facility actually needs to decide whether to order.
      const shaped = listings.map((l) => ({
        _id: l._id,
        facility_id: l.facility_id,
        seller_phone: l.facility_id ? l.facility_id.phone : null,
        drug_name: l.drug_name,
        unit: l.unit,
        unit_price: l.unit_price,
        expiry_date: l.expiry_date,
        quantity_listed: l.quantity_listed,
        quantity_remaining: l.quantity_remaining,
        available_to_order: l.availableToOrder(),
        queue_length: l.orders.filter((o) => o.status === 'queued').length,
      }));

      res.status(200).json({ status: 'success', count: shaped.length, listings: shaped });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── MY OWN LISTINGS (seller's management view, with order queue) ──
  // GET /api/marketplace/mine
  getMyListings: async (req, res) => {
    try {
      const listings = await NetworkListing.find({ facility_id: req.user.facility_id })
        .populate('orders.facility_id', 'name phone')
        .sort({ created_at: -1 });
      res.status(200).json({ status: 'success', count: listings.length, listings });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── MY ORDERS (buyer's cart / order history across all listings) ──
  // GET /api/marketplace/orders/mine
  getMyOrders: async (req, res) => {
    try {
      const listings = await NetworkListing.find({ 'orders.facility_id': req.user.facility_id })
        .populate('facility_id', 'name phone')
        .sort({ created_at: -1 });

      const myOrders = [];
      for (const listing of listings) {
        for (const order of listing.orders) {
          if (String(order.facility_id) === String(req.user.facility_id)) {
            myOrders.push({
              order_id: order._id,
              listing_id: listing._id,
              drug_name: listing.drug_name,
              unit: listing.unit,
              seller: listing.facility_id ? listing.facility_id.name : 'Unknown',
              seller_phone: listing.facility_id ? listing.facility_id.phone : null,
              quantity: order.quantity,
              status: order.status,
              ordered_at: order.ordered_at,
              confirm_by: order.confirm_by,
              confirmed_at: order.confirmed_at,
              revert_by: order.revert_by,
            });
          }
        }
      }
      myOrders.sort((a, b) => new Date(b.ordered_at) - new Date(a.ordered_at));

      res.status(200).json({ status: 'success', count: myOrders.length, orders: myOrders });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── PLACE AN ORDER (reservation, not instant purchase) ────────
  // POST /api/marketplace/:id/order   Body: { quantity }
  placeOrder: async (req, res) => {
    try {
      const quantity = Number(req.body.quantity);
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: 'Quantity must be a positive number' });
      }

      const listing = await NetworkListing.findOne({ _id: req.params.id, status: 'active' });
      if (!listing) return res.status(404).json({ message: 'Listing not found or no longer active' });
      if (String(listing.facility_id) === String(req.user.facility_id)) {
        return res.status(400).json({ message: "You can't order your own listing" });
      }
      if (quantity > listing.quantity_remaining) {
        return res.status(400).json({ message: `Only ${listing.quantity_remaining} ${listing.unit}(s) left in this listing` });
      }

      const available = listing.availableToOrder();
      const willActivateImmediately = quantity <= available;

      listing.orders.push({
        facility_id: req.user.facility_id,
        quantity,
        status: willActivateImmediately ? 'awaiting_confirmation' : 'queued',
        confirm_by: willActivateImmediately ? new Date(Date.now() + CONFIRM_WINDOW_MS) : undefined,
      });

      await listing.save();

      const io = getIO();
      if (io) {
        io.to(listing.facility_id.toString()).emit('marketplace_order_placed', {
          message: willActivateImmediately
            ? `New order for ${quantity} ${listing.unit}(s) of ${listing.drug_name} — awaiting buyer confirmation`
            : `New queued order for ${listing.drug_name} — will activate if earlier orders fall through`,
        });
      }

      res.status(201).json({
        status: 'success',
        message: willActivateImmediately
          ? `Order placed. Confirm payment arrangement within ${CONFIRM_WINDOW_MS / 60000} minutes or it will be released to the next facility in line.`
          : "Order queued — someone else is ahead of you for this quantity. You'll be notified if it becomes available.",
        willActivateImmediately,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CONFIRM AN ORDER (buyer confirms payment was arranged) ────
  // PATCH /api/marketplace/orders/:orderId/confirm
  confirmOrder: async (req, res) => {
    try {
      const listing = await NetworkListing.findOne({ 'orders._id': req.params.orderId });
      if (!listing) return res.status(404).json({ message: 'Order not found' });

      const order = listing.orders.id(req.params.orderId);
      if (String(order.facility_id) !== String(req.user.facility_id)) {
        return res.status(403).json({ message: 'Only the ordering facility can confirm this' });
      }
      if (order.status !== 'awaiting_confirmation') {
        return res.status(400).json({ message: `Cannot confirm an order in '${order.status}' state` });
      }

      order.status = 'confirmed';
      order.confirmed_at = new Date();
      order.revert_by = new Date(Date.now() + REVERT_WINDOW_MS);
      await listing.save();

      const io = getIO();
      if (io) {
        io.to(listing.facility_id.toString()).emit('marketplace_order_confirmed', {
          message: `Order for ${order.quantity} ${listing.unit}(s) of ${listing.drug_name} confirmed — finalizes in ${REVERT_WINDOW_MS / 60000} minutes unless reverted`,
        });
      }

      res.status(200).json({
        status: 'success',
        message: `Confirmed. Either side can still revert within ${REVERT_WINDOW_MS / 60000} minutes — after that it's final.`,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CANCEL / REVERT AN ORDER ──────────────────────────
  // PATCH /api/marketplace/orders/:orderId/cancel
  // Either the buyer or the seller can cancel while queued, awaiting
  // confirmation, or still inside the revert window.
  cancelOrder: async (req, res) => {
    try {
      const listing = await NetworkListing.findOne({ 'orders._id': req.params.orderId });
      if (!listing) return res.status(404).json({ message: 'Order not found' });

      const order = listing.orders.id(req.params.orderId);
      const isBuyer = String(order.facility_id) === String(req.user.facility_id);
      const isSeller = String(listing.facility_id) === String(req.user.facility_id);
      if (!isBuyer && !isSeller) {
        return res.status(403).json({ message: 'Not authorized to cancel this order' });
      }
      if (order.status === 'confirmed' && order.revert_by && new Date() > order.revert_by) {
        return res.status(403).json({ message: 'Revert window has passed — this order is already final' });
      }
      if (!['queued', 'awaiting_confirmation', 'confirmed'].includes(order.status)) {
        return res.status(400).json({ message: `Cannot cancel an order in '${order.status}' state` });
      }

      order.status = 'cancelled';
      order.cancelled_by = isBuyer ? 'buyer' : 'seller';
      activateQueue(listing, CONFIRM_WINDOW_MS);
      await listing.save();

      res.status(200).json({ status: 'success', message: 'Order cancelled' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── WITHDRAW A LISTING ────────────────────────────────
  // PATCH /api/marketplace/:id/withdraw
  withdrawListing: async (req, res) => {
    try {
      const listing = await NetworkListing.findOne({ _id: req.params.id, facility_id: req.user.facility_id, status: 'active' });
      if (!listing) return res.status(404).json({ message: 'Listing not found or already inactive' });

      const blocking = listing.orders.find((o) => o.status === 'confirmed' && o.revert_by && new Date() < o.revert_by);
      if (blocking) {
        return res.status(400).json({ message: 'A confirmed order is still inside its revert window — wait for it to finalize before withdrawing' });
      }

      listing.orders.forEach((o) => {
        if (['queued', 'awaiting_confirmation'].includes(o.status)) {
          o.status = 'cancelled';
          o.cancelled_by = 'seller';
        }
      });
      listing.status = 'withdrawn';
      listing.withdrawn_at = new Date();
      await listing.save();

      res.status(200).json({ status: 'success', message: 'Listing withdrawn', listing });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default marketplaceController;
