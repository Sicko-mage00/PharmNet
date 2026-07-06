import NetworkListing from '../models/networkListing.js';
import Drug from '../models/drug.js';
import Transfer from '../models/transfer.js';
import { getIO } from './socket.js';

// Promote queued orders into 'awaiting_confirmation' as capacity frees
// up, strictly FIFO — an order never jumps ahead of an earlier one that
// simply hasn't fit yet. Shared between the controller (on order/cancel)
// and this background processor (after an order expires).
export const activateQueue = (listing, confirmWindowMs) => {
  const queued = listing.orders
    .filter((o) => o.status === 'queued')
    .sort((a, b) => a.ordered_at - b.ordered_at);

  let available = listing.availableToOrder();
  for (const o of queued) {
    if (o.quantity <= available) {
      o.status = 'awaiting_confirmation';
      o.confirm_by = new Date(Date.now() + confirmWindowMs);
      available -= o.quantity;
    } else {
      break;
    }
  }
};

const CONFIRM_WINDOW_MS = 2 * 60 * 60 * 1000;

// Actually moves stock: seller batch/total decrements, buyer inventory
// credited (find-or-create), audit Transfer logged so it shows up in
// both facilities' alerts feed automatically.
const finalizeOrder = async (listing, order) => {
  const sellerDrug = await Drug.findById(listing.drug_id);
  if (sellerDrug) {
    const batch = sellerDrug.batches.find((b) => b.batch_number === listing.batch_number);
    if (batch) {
      batch.quantity = Math.max(0, batch.quantity - order.quantity);
    } else {
      sellerDrug.total_quantity = Math.max(0, sellerDrug.total_quantity - order.quantity);
    }
    await sellerDrug.save();
  }

  let buyerDrug = await Drug.findOne({ facility_id: order.facility_id, drug_name: listing.drug_name });
  const newBatch = {
    batch_number: `MKT-${listing._id.toString().slice(-6)}-${Date.now()}`,
    quantity: order.quantity,
    expiry_date: listing.expiry_date,
    unit_price: listing.unit_price,
  };
  if (buyerDrug) {
    buyerDrug.batches.push(newBatch);
    await buyerDrug.save();
  } else {
    await Drug.create({
      facility_id: order.facility_id,
      drug_name: listing.drug_name,
      generic_name: listing.generic_name,
      category: listing.category,
      unit: listing.unit,
      reorder_point: 50,
      batches: [newBatch],
    });
  }

  await Transfer.create({
    requesterFacility: order.facility_id,
    providerFacility: listing.facility_id,
    drugId: listing.drug_id,
    transactionType: 'Discounted Offload',
    quantityRequested: order.quantity,
    unit: listing.unit,
    status: 'Completed',
    marginLabel: 'Marketplace Purchase',
    notes: `Bought ${order.quantity} ${listing.unit}(s) of ${listing.drug_name} from the network marketplace`,
  });

  order.status = 'completed';
  listing.quantity_remaining = Math.max(0, listing.quantity_remaining - order.quantity);
  if (listing.quantity_remaining <= 0) listing.status = 'sold_out';
};

export const processMarketplaceQueue = async () => {
  try {
    const io = getIO();
    const now = new Date();

    // ── Expire orders that never got confirmed in time ──
    const listingsWithExpiring = await NetworkListing.find({
      status: 'active',
      'orders.status': 'awaiting_confirmation',
      'orders.confirm_by': { $lt: now },
    });

    for (const listing of listingsWithExpiring) {
      let changed = false;
      for (const order of listing.orders) {
        if (order.status === 'awaiting_confirmation' && order.confirm_by < now) {
          order.status = 'expired';
          changed = true;
          if (io) {
            io.to(order.facility_id.toString()).emit('marketplace_order_expired', {
              message: `Your order for ${listing.drug_name} expired \u2014 you didn't confirm in time. It's moved to the next facility in line.`,
            });
          }
        }
      }
      if (changed) {
        activateQueue(listing, CONFIRM_WINDOW_MS);
        await listing.save();

        if (io) {
          const nowActive = listing.orders.find((o) => o.status === 'awaiting_confirmation');
          if (nowActive) {
            io.to(nowActive.facility_id.toString()).emit('marketplace_order_placed', {
              message: `Your queued order for ${listing.drug_name} is now active \u2014 confirm payment arrangement to secure it.`,
            });
          }
        }
      }
    }

    // ── Finalize confirmed orders whose revert window has passed ──
    const listingsWithConfirmed = await NetworkListing.find({
      'orders.status': 'confirmed',
      'orders.revert_by': { $lt: now },
    });

    for (const listing of listingsWithConfirmed) {
      let changed = false;
      for (const order of listing.orders) {
        if (order.status === 'confirmed' && order.revert_by < now) {
          await finalizeOrder(listing, order);
          changed = true;
          if (io) {
            io.to(order.facility_id.toString()).emit('marketplace_order_completed', {
              message: `Your order for ${listing.drug_name} is finalized \u2014 added to your inventory.`,
            });
            io.to(listing.facility_id.toString()).emit('marketplace_order_completed', {
              message: `Sale of ${listing.drug_name} finalized and deducted from your stock.`,
            });
          }
        }
      }
      if (changed) await listing.save();
    }
  } catch (err) {
    console.error('Marketplace queue processing failed:', err.message);
  }
};
