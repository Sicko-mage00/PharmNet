import Alert from '../models/alert.js';
import Transfer from '../models/transfer.js';
import { getIO } from './socket.js';

export const checkExpiredAlerts = async () => {
  try {
    const expiredAlerts = await Alert.find({
      status:     'pending',
      expires_at: { $lt: new Date() },
    });

    for (const alert of expiredAlerts) {
      alert.status = 'expired';
      alert.notes  = 'No response within 24 hours';
      await alert.save();

      const io = getIO();
      if (io) {
        io.to(alert.target_facility.toString()).emit('alert_expired', {
          message: `No facility responded for ${alert.drug_name} within 24 hours — you can still request this from the network.`,
          alert,
        });
      }
    }

    if (expiredAlerts.length) {
      console.log(`${expiredAlerts.length} alerts expired`);
    }

    // ─── EXPIRE STALE NETWORK TRANSFERS ────────────────────
    // A broadcast request that nobody accepted before revertWindowEndsAt
    // shouldn't just sit in 'Pending Approval' forever. Mark it Reverted
    // with revert_reason 'expired' (NOT the same as a settled/resolved
    // state — see alertStatus.js) so the requester's UI keeps nudging
    // them to re-request rather than treating it as done.
    const expiredTransfers = await Transfer.find({
      status: 'Pending Approval',
      revertWindowEndsAt: { $lt: new Date() },
    });

    for (const transfer of expiredTransfers) {
      transfer.status = 'Reverted';
      transfer.revert_reason = 'expired';
      transfer.notes = 'No response within the request window';
      await transfer.save();

      const io = getIO();
      if (io) {
        io.to(transfer.requesterFacility.toString()).emit('transfer_expired', {
          message: 'Your network request timed out with no response — still needed? You can request again.',
          transferId: transfer._id,
        });
        io.to(transfer.providerFacility.toString()).emit('transfer_expired', {
          message: 'A pending supply request to you has expired.',
          transferId: transfer._id,
        });
      }
    }

    if (expiredTransfers.length) {
      console.log(`${expiredTransfers.length} network transfers expired`);
    }

  } catch (err) {
    console.error('Alert expiry check failed:', err.message);
  }
};