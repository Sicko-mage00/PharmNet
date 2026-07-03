import mongoose from 'mongoose';
import Alert from '../models/alert.js';
import Drug from '../models/drug.js';
import Transfer from '../models/transfer.js';
import Facility from '../models/facility.js';

import { emitAlert, getIO } from '../services/socket.js';
import { getCategorizedMatches } from '../services/matcher.js';

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

  // ─── GET ALL ALERTS (DUAL-FETCH ENGINE) ───────────────
  // GET /api/alerts
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
        .populate('source_facility', 'name location')
        .populate('target_facility', 'name location')
        .sort({ created_at: -1 }); // Keep sorted chronologically so frontend can group them properly

      res.status(200).json({
        status: 'success',
        count: alerts.length,
        alerts,
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
        { status: 'Reverted' },
        { returnDocument: 'after' },
      );

      if (!transfer) {
        return res.status(404).json({ message: 'Request not found' });
      }

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

  // ─── CREATE DRAFT TRANSFER ────────────────────────────
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

  // ─── TRANSMIT TRANSFER ────────────────────────────────
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
      await transfer.save();

      return res.status(200).json({ status: 'success', transfer });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
};

export default alertController;
