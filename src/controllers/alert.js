import mongoose from 'mongoose';
import Alert from '../models/alert.js';
import Drug from '../models/drug.js';
import Transfer from '../models/transfer.js';
import Facility from '../models/facility.js'; 

import { emitAlert, getIO } from '../services/socket.js';
import { getCategorizedMatches } from '../services/matcher.js';

const alertController = {

  // ─── GET ALL ALERTS (THE DUAL-FETCH ENGINE) ────────────
  getAlerts: async (req, res) => {
    try {
      // 1. Fetch Internal Alerts (ROP / FEFO)
      const alerts = await Alert.find({
        $or: [
          { target_facility: req.user.facility_id },
          { source_facility: req.user.facility_id },
        ],
        status: { $nin: ['resolved', 'expired', 'cancelled', 'self_resolved'] },
      })
        .populate('drug_id', 'drug_name unit')
        .populate('source_facility', 'name location')
        .populate('target_facility', 'name location')
        .lean(); // .lean() makes it a standard JSON object so we can combine arrays

      // 2. Fetch Network Transfers
      const transfers = await Transfer.find({
        $or: [
          { requesterFacility: req.user.facility_id },
          { providerFacility: req.user.facility_id }
        ],
        status: { $nin: ['Draft', 'Reverted', 'Completed'] }
      })
        .populate('drugId', 'drug_name unit')
        .populate('requesterFacility', 'name location')
        .populate('providerFacility', 'name location')
        .lean();

      // 3. Disguise Transfers as Standard Alerts for the UI
      const mappedTransfers = transfers.map(t => {
        let mappedStatus = 'pending';
        if (t.status === 'Pending Approval') mappedStatus = 'pending';
        if (t.status === 'Accepted')         mappedStatus = 'confirmed';
        if (t.status === 'Dispatched')       mappedStatus = 'dispatched';

        return {
          _id: t._id,
          isTransfer: true, // Hidden flag for internal routing
          type: t.transactionType === 'Discounted Offload' ? 'FEFO' : 'ROP', // Keeps UI colors
          drug_name: t.drugId ? t.drugId.drug_name : 'Network Drug',
          source_facility: t.providerFacility, // Provider = Source
          target_facility: t.requesterFacility, // Requester = Target
          quantity_needed: t.quantityRequested,
          quantity_available: t.quantityRequested,
          status: mappedStatus,
          notes: `Network Transfer: ${t.transactionType} (${t.quantityRequested} ${t.unit})`,
          created_at: t.createdAt || t.updatedAt
        };
      });

      // 4. Merge the lists and sort chronologically
      const combinedFeed = [...alerts, ...mappedTransfers].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      res.status(200).json({ status: 'success', count: combinedFeed.length, alerts: combinedFeed });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── FETCH NETWORK MATCHES ─────────────────────────────
  getNetworkMatches: async (req, res) => {
    try {
      const { drugName, type } = req.query;

      if (!drugName || !type) {
        return res.status(400).json({ message: 'Policy Error: Drug name and alert type are required.' });
      }

      const requesterFacility = await Facility.findById(req.user.facility_id);
      if (!requesterFacility) return res.status(404).json({ message: 'Facility not found.' });

      const matches = await getCategorizedMatches(requesterFacility, drugName, type);

      res.status(200).json({ status: 'success', data: matches });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── CONFIRM ALERT / TRANSFER ──────────────────────────
  confirmAlert: async (req, res) => {
    try {
      // Try Internal Alert
      let alert = await Alert.findOne({ _id: req.params.id, source_facility: req.user.facility_id, status: 'pending' });
      
      if (alert) {
        alert.status = 'confirmed';
        await alert.save();
        return res.status(200).json({ status: 'success', message: 'Internal Match confirmed', alert });
      }

      // Try Network Transfer (The "Catch")
      let transfer = await Transfer.findOne({ _id: req.params.id, providerFacility: req.user.facility_id, status: 'Pending Approval' });
      
      if (!transfer) return res.status(404).json({ message: 'Request not found or already processed' });

      transfer.status = 'Accepted';
      await transfer.save();

      const io = getIO();
      io.to(transfer.requesterFacility.toString()).emit('transfer_accepted', {
        message: `Your request was accepted by the provider!`,
        transfer
      });

      return res.status(200).json({ status: 'success', message: 'Network Transfer accepted — arrange dispatch' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DECLINE ALERT / TRANSFER ──────────────────────────
  declineAlert: async (req, res) => {
    try {
      let alert = await Alert.findOneAndUpdate(
        { _id: req.params.id, source_facility: req.user.facility_id, status: 'pending' },
        { status: 'declined', notes: 'Source facility declined' },
        { returnDocument: 'after' }
      );

      if (alert) return res.status(200).json({ status: 'success', message: 'Internal Alert declined', alert });

      let transfer = await Transfer.findOneAndUpdate(
        { _id: req.params.id, providerFacility: req.user.facility_id, status: 'Pending Approval' },
        { status: 'Reverted' },
        { returnDocument: 'after' }
      );

      if (!transfer) return res.status(404).json({ message: 'Request not found' });

      return res.status(200).json({ status: 'success', message: 'Network Transfer declined' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── SELF RESOLVE (Internal Only) ──────────────────────
  selfResolve: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        { _id: req.params.id, target_facility: req.user.facility_id, status: { $in: ['pending', 'confirmed'] } },
        { status: 'self_resolved', resolved_at: new Date(), notes: 'Resolved externally' },
        { returnDocument: 'after' }
      );
      if (!alert) return res.status(404).json({ message: 'Alert not found' });
      res.status(200).json({ status: 'success', message: 'Alert self-resolved', alert });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DISPATCH ALERT / TRANSFER ─────────────────────────
  dispatchAlert: async (req, res) => {
    try {
      let alert = await Alert.findOne({ _id: req.params.id, source_facility: req.user.facility_id, status: 'confirmed' });
      
      if (alert) {
        alert.status = 'dispatched';
        alert.dispatched_at = new Date();
        await alert.save();
        return res.status(200).json({ status: 'success', message: 'Internal Drugs dispatched', alert });
      }

      let transfer = await Transfer.findOne({ _id: req.params.id, providerFacility: req.user.facility_id, status: 'Accepted' });
      if (!transfer) return res.status(404).json({ message: 'Transfer not found' });

      transfer.status = 'Dispatched';
      await transfer.save();

      return res.status(200).json({ status: 'success', message: 'Network Drugs marked as dispatched' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── RESOLVE ALERT / TRANSFER (INVENTORY MATH ENGINE) ──
  resolveAlert: async (req, res) => {
    try {
      let alert = await Alert.findOneAndUpdate(
        { _id: req.params.id, target_facility: req.user.facility_id, status: 'dispatched' },
        { status: 'resolved', resolved_at: new Date(), notes: 'Drugs received' },
        { returnDocument: 'after' }
      );

      if (alert) return res.status(200).json({ status: 'success', message: 'Internal Transfer complete', alert });

      let transfer = await Transfer.findOne({ _id: req.params.id, requesterFacility: req.user.facility_id, status: 'Dispatched' });
      if (!transfer) return res.status(404).json({ message: 'Transfer not found' });

      // ── THE INVENTORY MATH ──
      const providerDrug = await Drug.findById(transfer.drugId);
      
      if (providerDrug) {
          // 1. Deduct from Provider
          providerDrug.total_quantity -= transfer.quantityRequested;
          await providerDrug.save();

          // 2. Add to Requester (Target)
          let requesterDrug = await Drug.findOne({ drug_name: providerDrug.drug_name, facility_id: transfer.requesterFacility });
          const newBatch = {
              batch_number: req.body.batch_number || `NET-${Date.now()}`,
              quantity: transfer.quantityRequested,
              expiry_date: providerDrug.batches.length > 0 ? providerDrug.batches[0].expiry_date : new Date(Date.now() + 31536000000)
          };

          if (requesterDrug) {
              requesterDrug.total_quantity += transfer.quantityRequested;
              requesterDrug.batches.push(newBatch);
              await requesterDrug.save();
          } else {
              // Automatically provision a new drug record if the facility has never stocked it before
              requesterDrug = new Drug({
                  facility_id: transfer.requesterFacility,
                  drug_name: providerDrug.drug_name,
                  category: providerDrug.category,
                  unit: transfer.unit,
                  total_quantity: transfer.quantityRequested,
                  reorder_point: 50,
                  selling_price: providerDrug.selling_price,
                  batches: [newBatch]
              });
              await requesterDrug.save();
          }
      }

      transfer.status = 'Completed';
      await transfer.save();

      return res.status(200).json({ status: 'success', message: 'Transfer complete — Inventory updated automatically!' });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── OPAY-STYLE TRANSFER INITIATION ────────────────────
  createDraftTransfer: async (req, res) => {
    try {
      const { providerFacilityId, drugId, quantityRequested, unit, transactionType } = req.body;
      const draft = new Transfer({
        requesterFacility: req.user.facility_id,
        providerFacility: providerFacilityId,
        drugId: drugId,
        transactionType: transactionType,
        quantityRequested: quantityRequested,
        unit: unit,
        status: 'Draft'
      });
      await draft.save();
      res.status(201).json({ status: 'success', draft });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  transmitTransfer: async (req, res) => {
    try {
      const draft = await Transfer.findOne({ _id: req.params.id, requesterFacility: req.user.facility_id, status: 'Draft' }).populate('drugId', 'drug_name');
      if (!draft) return res.status(404).json({ message: 'Draft not found' });

      draft.status = 'Pending Approval';
      const revertWindow = new Date();
      revertWindow.setHours(revertWindow.getHours() + 24); 
      draft.revertWindowEndsAt = revertWindow;
      await draft.save();

      return res.status(200).json({ status: 'success', transfer: draft });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  revertTransfer: async (req, res) => {
    try {
      const transfer = await Transfer.findOne({
        _id: req.params.id,
        $or: [{ requesterFacility: req.user.facility_id }, { providerFacility: req.user.facility_id }],
        status: { $in: ['Pending Approval', 'Accepted'] }
      });

      if (!transfer) return res.status(404).json({ message: 'Transfer not found' });
      if (new Date() > transfer.revertWindowEndsAt) return res.status(403).json({ message: 'Policy Error: Grace period expired.' });

      transfer.status = 'Reverted';
      await transfer.save();
      return res.status(200).json({ status: 'success', transfer });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }

};

export default alertController;