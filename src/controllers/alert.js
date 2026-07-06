import mongoose from 'mongoose';
import Alert from '../models/alert.js';
import Drug from '../models/drug.js';
import Transfer from '../models/transfer.js';
import Facility from '../models/facility.js';

import { emitAlert, getIO } from '../services/socket.js';
import { getCategorizedMatches } from '../services/matcher.js';
import { validateCustomQuantity } from '../services/quantityMargins.js';
import {
  alertChannel,
  isAlertResolved,
  isTransferResolved,
  isAlertStillUnresolved,
  isTransferStillUnresolved,
} from '../services/alertStatus.js';

const alertController = {
  // ─── MARK ALERTS AS READ BY DRUG NAME ─────────────────
  // PATCH /api/alerts/read/:drugName
  markReadByDrug: async (req, res) => {
    try {
      const drugName = decodeURIComponent(req.params.drugName);

      await Alert.updateMany(
        {
          target_facility: req.user.facility_id,
          drug_name: drugName,
          status: 'pending',
          is_read: { $ne: true },
        },
        { $set: { is_read: true } },
      );

      res.status(200).json({ status: 'success' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── GET ALL ALERTS (DUAL-CHANNEL: INTERNAL + EXTERNAL) ──
  // GET /api/alerts
  // Internal  = self-generated ROP/FEFO alerts about this facility's own stock.
  // External  = network Transfers (requests sent to/received from other facilities).
  getAlerts: async (req, res) => {
    try {
      const facility_id = req.user.facility_id;
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const alerts = await Alert.find({
        $or: [
          { target_facility: facility_id },
          { source_facility: facility_id },
        ],
        created_at: { $gte: twoWeeksAgo },
      })
        .populate('drug_id', 'drug_name unit')
        .populate('source_facility', 'name')
        .populate('target_facility', 'name')
        .sort({ created_at: -1 });

      const transfers = await Transfer.find({
        $or: [
          { requesterFacility: facility_id },
          { providerFacility: facility_id },
        ],
        createdAt: { $gte: twoWeeksAgo },
      })
        .populate('drugId', 'drug_name unit')
        .populate('requesterFacility', 'name')
        .populate('providerFacility', 'name')
        .sort({ createdAt: -1 });

      const alertItems = alerts.map((a) => ({
        ...a.toObject({ virtuals: true }),
        channel: alertChannel(a),
        resolved: isAlertResolved(a),
        stillUnresolved: isAlertStillUnresolved(a),
      }));

      const internalAlertItems = alertItems.filter((a) => a.channel === 'internal');
      const externalAlertItems = alertItems.filter((a) => a.channel === 'external');

      // Normalize Transfers into the same bubble shape the frontend already
      // uses for Alerts, so both channels render through one code path.
      // providerFacility (who supplies) maps to source_facility (who fulfills);
      // requesterFacility (who needs stock) maps to target_facility (who receives) —
      // same convention as internal Alerts.
      const transferItems = transfers.map((t) => ({
        _id: t._id,
        isTransfer: true,
        type: 'TRANSFER',
        drug_name: t.drugId ? t.drugId.drug_name : 'Network Transfer',
        drug_id: t.drugId,
        status: t.status,
        revert_reason: t.revert_reason,
        notes: t.notes || `${t.transactionType} \u2014 ${t.quantityRequested} ${t.unit}`,
        quantity_available: t.quantityRequested,
        source_facility: t.providerFacility,
        target_facility: t.requesterFacility,
        created_at: t.createdAt,
        broadcast_id: t.broadcast_id,
        marginLabel: t.marginLabel,
        transactionType: t.transactionType,
        revertWindowEndsAt: t.revertWindowEndsAt,
        resolved: isTransferResolved(t),
        stillUnresolved: isTransferStillUnresolved(t),
      }));

      const externalItems = [...externalAlertItems, ...transferItems].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );

      // Flat merged array kept for back-compat with existing frontend code
      // (main.js's notification bell counter reads data.alerts directly).
      const combined = [...internalAlertItems, ...externalItems].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );

      res.status(200).json({
        status: 'success',
        alerts: combined,
        internal: { count: internalAlertItems.length, items: internalAlertItems },
        external: { count: externalItems.length, items: externalItems },
      });
    } catch (err) {
      res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  },

  // ─── GET NETWORK MATCHES ──────────────────────────────
  // GET /api/alerts/network-matches?drugName=X&type=ROP|FEFO
  getNetworkMatches: async (req, res) => {
    try {
      const { drugName, type } = req.query;

      if (!drugName || !type) {
        return res
          .status(400)
          .json({ message: 'Drug name and alert type are required.' });
      }

      const requesterFacility = await Facility.findById(req.user.facility_id);
      if (!requesterFacility) {
        return res.status(404).json({ message: 'Facility not found.' });
      }

      const matches = await getCategorizedMatches(
        requesterFacility,
        drugName,
        type,
      );

      res.status(200).json({ status: 'success', data: matches });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CONFIRM ALERT / TRANSFER ─────────────────────────
  // PATCH /api/alerts/:id/confirm
  confirmAlert: async (req, res) => {
    try {
      // Try internal alert first
      const alert = await Alert.findOne({
        _id: req.params.id,
        source_facility: req.user.facility_id,
        status: 'pending',
      });

      if (alert) {
        if (req.body.quantity_offered) {
          alert.quantity_available = req.body.quantity_offered;
        }
        alert.status = 'confirmed';
        await alert.save();

        const populated = await Alert.findById(alert._id)
          .populate('source_facility', 'name')
          .populate('target_facility', 'name');

        emitAlert(populated, true);
        return res
          .status(200)
          .json({ status: 'success', message: 'Confirmed', alert: populated });
      }

      // Try network transfer
      const transfer = await Transfer.findOne({
        _id: req.params.id,
        providerFacility: req.user.facility_id,
        status: 'Pending Approval',
      });

      if (!transfer) {
        return res
          .status(404)
          .json({ message: 'Request not found or already processed' });
      }

      transfer.status = 'Accepted';
      await transfer.save();

      const io = getIO();
      io.to(transfer.requesterFacility.toString()).emit('transfer_accepted', {
        message: 'Your request was accepted by the provider!',
        transfer,
      });

      // ─── BROADCAST AUTO-CANCEL ─────────────────────────
      // If this transfer was part of a multi-facility broadcast (the
      // requester sent the same request to up to 4 facilities at once),
      // whoever accepts first wins — every sibling transfer still
      // awaiting a response gets auto-reverted, and those provider
      // facilities are notified immediately so the request disappears
      // from their action queue instead of sitting there stale.
      if (transfer.broadcast_id) {
        const siblings = await Transfer.find({
          broadcast_id: transfer.broadcast_id,
          _id: { $ne: transfer._id },
          status: { $in: ['Pending Approval', 'Draft'] },
        });

        if (siblings.length) {
          await Transfer.updateMany(
            { _id: { $in: siblings.map((s) => s._id) } },
            {
              status: 'Reverted',
              revert_reason: 'auto_cancelled_broadcast',
              notes: 'Auto-cancelled — another facility already accepted this request',
            },
          );

          for (const sib of siblings) {
            io.to(sib.providerFacility.toString()).emit('transfer_auto_cancelled', {
              message: 'This request was already fulfilled by another facility',
              transferId: sib._id,
            });
          }
        }
      }

      return res.status(200).json({
        status: 'success',
        message: 'Network Transfer accepted — arrange dispatch',
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DECLINE ALERT / TRANSFER ─────────────────────────
  // PATCH /api/alerts/:id/decline
  declineAlert: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id: req.params.id,
          source_facility: req.user.facility_id,
          status: 'pending',
        },
        { status: 'declined', notes: 'Source facility declined' },
        { returnDocument: 'after' },
      );

      if (alert) {
        return res
          .status(200)
          .json({ status: 'success', message: 'Alert declined', alert });
      }

      const transfer = await Transfer.findOneAndUpdate(
        {
          _id: req.params.id,
          providerFacility: req.user.facility_id,
          status: 'Pending Approval',
        },
        { status: 'Reverted', revert_reason: 'declined' },
        { returnDocument: 'after' },
      );

      if (!transfer) {
        return res.status(404).json({ message: 'Request not found' });
      }

      // Declining does NOT cancel siblings — the request is still live
      // at the other broadcast facilities and should keep waiting for
      // one of them to respond.

      return res
        .status(200)
        .json({ status: 'success', message: 'Network Transfer declined' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── SELF RESOLVE ─────────────────────────────────────
  // PATCH /api/alerts/:id/self-resolve
  selfResolve: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id: req.params.id,
          target_facility: req.user.facility_id,
          status: { $in: ['pending', 'confirmed'] },
        },
        {
          status: 'self_resolved',
          resolved_at: new Date(),
          notes: req.body.notes || 'Resolved externally',
        },
        { returnDocument: 'after' },
      );

      if (!alert) {
        return res
          .status(404)
          .json({ message: 'Alert not found or already resolved' });
      }

      res
        .status(200)
        .json({ status: 'success', message: 'Alert self-resolved', alert });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DISPATCH ─────────────────────────────────────────
  // PATCH /api/alerts/:id/dispatch
  dispatchAlert: async (req, res) => {
    try {
      const alert = await Alert.findOne({
        _id: req.params.id,
        source_facility: req.user.facility_id,
        status: 'confirmed',
      });

      if (alert) {
        alert.status = 'dispatched';
        alert.dispatched_at = new Date();
        await alert.save();

        const populated = await Alert.findById(alert._id)
          .populate('source_facility', 'name')
          .populate('target_facility', 'name');

        const io = getIO();
        io.to(populated.target_facility._id.toString()).emit(
          'drugs_dispatched',
          {
            message: `Drugs dispatched by ${populated.source_facility.name}`,
          },
        );

        return res
          .status(200)
          .json({
            status: 'success',
            message: 'Drugs dispatched',
            alert: populated,
          });
      }

      const transfer = await Transfer.findOne({
        _id: req.params.id,
        providerFacility: req.user.facility_id,
        status: 'Accepted',
      });

      if (!transfer) {
        return res.status(404).json({ message: 'Transfer not found' });
      }

      transfer.status = 'Dispatched';
      await transfer.save();

      return res
        .status(200)
        .json({
          status: 'success',
          message: 'Network drugs marked as dispatched',
        });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── RESOLVE (INVENTORY MATH ENGINE) ─────────────────
  // PATCH /api/alerts/:id/resolve
  resolveAlert: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id: req.params.id,
          target_facility: req.user.facility_id,
          status: 'dispatched',
        },
        {
          status: 'resolved',
          resolved_at: new Date(),
          notes: 'Drugs received',
        },
        { returnDocument: 'after' },
      );

      if (alert) {
        return res
          .status(200)
          .json({ status: 'success', message: 'Transfer complete', alert });
      }

      const transfer = await Transfer.findOne({
        _id: req.params.id,
        requesterFacility: req.user.facility_id,
        status: 'Dispatched',
      });

      if (!transfer) {
        return res.status(404).json({ message: 'Transfer not found' });
      }

      const providerDrug = await Drug.findById(transfer.drugId);

      if (providerDrug) {
        providerDrug.total_quantity = Math.max(
          0,
          providerDrug.total_quantity - transfer.quantityRequested,
        );
        await providerDrug.save();

        const newBatch = {
          batch_number: req.body.batch_number || `NET-${Date.now()}`,
          quantity: transfer.quantityRequested,
          expiry_date:
            providerDrug.batches.length > 0
              ? providerDrug.batches[0].expiry_date
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        };

        let requesterDrug = await Drug.findOne({
          drug_name: providerDrug.drug_name,
          facility_id: transfer.requesterFacility,
        });

        if (requesterDrug) {
          requesterDrug.total_quantity += transfer.quantityRequested;
          requesterDrug.batches.push(newBatch);
          await requesterDrug.save();
        } else {
          await Drug.create({
            facility_id: transfer.requesterFacility,
            drug_name: providerDrug.drug_name,
            generic_name: providerDrug.generic_name,
            category: providerDrug.category,
            unit: transfer.unit,
            total_quantity: transfer.quantityRequested,
            reorder_point: 50,
            batches: [newBatch],
          });
        }
      }

      transfer.status = 'Completed';
      await transfer.save();

      return res.status(200).json({
        status: 'success',
        message: 'Transfer complete — Inventory updated automatically!',
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CREATE DRAFT TRANSFER (single facility — kept for back-compat) ──
  // POST /api/alerts/transfer/draft
  createDraftTransfer: async (req, res) => {
    try {
      const {
        providerFacilityId,
        drugId,
        quantityRequested,
        unit,
        transactionType,
      } = req.body;

      const draft = await Transfer.create({
        requesterFacility: req.user.facility_id,
        providerFacility: providerFacilityId,
        drugId,
        transactionType,
        quantityRequested,
        unit,
        status: 'Draft',
      });

      res.status(201).json({ status: 'success', draft });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CREATE BROADCAST REQUEST (up to 4 facilities at once) ────────
  // POST /api/alerts/transfer/broadcast
  // Body: { providerFacilityIds: [...up to 4], drugId, quantityRequested,
  //         unit, transactionType, marginLabel }
  createBroadcastRequest: async (req, res) => {
    try {
      const {
        providerFacilityIds,
        drugId,
        quantityRequested,
        unit,
        transactionType,
        marginLabel,
      } = req.body;

      if (!Array.isArray(providerFacilityIds) || providerFacilityIds.length === 0) {
        return res.status(400).json({ message: 'Select at least one facility to request from' });
      }
      if (providerFacilityIds.length > 4) {
        return res.status(400).json({ message: 'You can request from at most 4 facilities at once' });
      }

      const uniqueIds = [...new Set(providerFacilityIds.map(String))];
      if (uniqueIds.length !== providerFacilityIds.length) {
        return res.status(400).json({ message: 'Duplicate facilities in request list' });
      }

      // Requester's own drug (the one running low) — used to sanity-check
      // the requested quantity against its reorder point.
      const ownDrug = await Drug.findOne({
        _id: drugId,
        facility_id: req.user.facility_id,
      });
      if (!ownDrug) {
        return res.status(404).json({ message: 'Drug not found in your inventory' });
      }

      const check = validateCustomQuantity(ownDrug, quantityRequested);
      if (!check.valid) {
        return res.status(400).json({ message: check.message });
      }

      const broadcast_id = new mongoose.Types.ObjectId();

      const drafts = await Transfer.insertMany(
        uniqueIds.map((providerFacilityId) => ({
          requesterFacility: req.user.facility_id,
          providerFacility: providerFacilityId,
          drugId,
          transactionType,
          quantityRequested,
          unit,
          status: 'Draft',
          broadcast_id,
          marginLabel: marginLabel || 'Custom',
        })),
      );

      res.status(201).json({ status: 'success', broadcast_id, drafts });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── TRANSMIT TRANSFER (single facility — kept for back-compat) ───
  // PATCH /api/alerts/transfer/:id/transmit
  transmitTransfer: async (req, res) => {
    try {
      const draft = await Transfer.findOne({
        _id: req.params.id,
        requesterFacility: req.user.facility_id,
        status: 'Draft',
      }).populate('drugId', 'drug_name');

      if (!draft) {
        return res.status(404).json({ message: 'Draft not found' });
      }

      draft.status = 'Pending Approval';
      const revertWindow = new Date();
      revertWindow.setHours(revertWindow.getHours() + 24);
      draft.revertWindowEndsAt = revertWindow;
      await draft.save();

      const io = getIO();
      io.to(draft.providerFacility.toString()).emit('new_transfer_request', {
        message: `New supply request for ${draft.drugId?.drug_name || 'a drug'}`,
        transfer: draft,
      });

      return res.status(200).json({ status: 'success', transfer: draft });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── TRANSMIT BROADCAST (all drafts sharing a broadcast_id) ───────
  // PATCH /api/alerts/transfer/broadcast/:broadcastId/transmit
  transmitBroadcast: async (req, res) => {
    try {
      const drafts = await Transfer.find({
        broadcast_id: req.params.broadcastId,
        requesterFacility: req.user.facility_id,
        status: 'Draft',
      }).populate('drugId', 'drug_name');

      if (!drafts.length) {
        return res.status(404).json({ message: 'Broadcast request not found' });
      }

      const revertWindow = new Date();
      revertWindow.setHours(revertWindow.getHours() + 24);

      await Transfer.updateMany(
        { broadcast_id: req.params.broadcastId, status: 'Draft' },
        { status: 'Pending Approval', revertWindowEndsAt: revertWindow },
      );

      const io = getIO();
      for (const draft of drafts) {
        io.to(draft.providerFacility.toString()).emit('new_transfer_request', {
          message: `New supply request for ${draft.drugId?.drug_name || 'a drug'} (sent to ${drafts.length} facilities — first to accept wins)`,
          transfer: { ...draft.toObject(), status: 'Pending Approval' },
        });
      }

      return res.status(200).json({
        status: 'success',
        message: `Request transmitted to ${drafts.length} facilities`,
        count: drafts.length,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── REVERT TRANSFER ──────────────────────────────────
  // PATCH /api/alerts/transfer/:id/revert
  revertTransfer: async (req, res) => {
    try {
      const transfer = await Transfer.findOne({
        _id: req.params.id,
        $or: [
          { requesterFacility: req.user.facility_id },
          { providerFacility: req.user.facility_id },
        ],
        status: { $in: ['Pending Approval', 'Accepted'] },
      });

      if (!transfer) {
        return res.status(404).json({ message: 'Transfer not found' });
      }

      if (
        transfer.revertWindowEndsAt &&
        new Date() > transfer.revertWindowEndsAt
      ) {
        return res
          .status(403)
          .json({ message: 'Grace period expired — cannot revert' });
      }

      transfer.status = 'Reverted';
      transfer.revert_reason = 'manual';
      await transfer.save();

      return res.status(200).json({ status: 'success', transfer });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default alertController;