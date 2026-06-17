import mongoose from 'mongoose';
import Alert from '../models/alert.js';
import Drug from '../models/drug.js';
import Transfer from '../models/transfer.js';
import Facility from '../models/facility.js'; 

import { emitAlert, getIO } from '../services/socket.js';
import { getCategorizedMatches } from '../services/matcher.js';

const alertController = {

  // ─── GET ALL ALERTS ────────────────────────────────────
  getAlerts: async (req, res) => {
    try {

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
        .sort({ created_at: -1 });

      res.status(200).json({ status: 'success', count: alerts.length, alerts });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── FETCH NETWORK MATCHES (The Categorization API) ──────
  // GET /api/alerts/network-matches?drugName=Amoxicillin&type=ROP
  getNetworkMatches: async (req, res) => {
    try {
      const { drugName, type } = req.query;

      if (!drugName || !type) {
        return res.status(400).json({ 
          message: 'Policy Error: Drug name and alert type are required to query the network.' 
        });
      }

      // 1. Fetch the full facility details of the user making the request
      const requesterFacility = await Facility.findById(req.user.facility_id);
      
      if (!requesterFacility) {
        return res.status(404).json({ message: 'Requesting facility profile not found.' });
      }

      // 2. Feed the data into the categorization engine
      const matches = await getCategorizedMatches(requesterFacility, drugName, type);

      // 3. Return the perfectly sorted payload to the frontend
      res.status(200).json({
        status: 'success',
        data: matches
      });
      
    } catch (err) {
      console.error('[getNetworkMatches] Error:', err);
      res.status(500).json({ message: 'Server error while mapping network', error: err.message });
    }
  },

  // ─── CONFIRM ALERT ─────────────────────────────────────
  // called by SOURCE facility — first to confirm wins
  confirmAlert: async (req, res) => {
    try {
      const alert = await Alert.findOne({
        _id:             req.params.id,
        source_facility: req.user.facility_id,
        status:          'pending',
      });

      if (!alert) {
        return res.status(404).json({ message: 'Alert not found or already taken' });
      }

      // confirm this one
      alert.status = 'confirmed';
      await alert.save();

      // cancel all other pending alerts for same drug + target
      await Alert.updateMany(
        {
          _id:             { $ne: alert._id },
          drug_id:         alert.drug_id,
          target_facility: alert.target_facility,
          type:            alert.type,
          status:          'pending',
        },
        {
          status: 'cancelled',
          notes:  'Request fulfilled by another facility',
        }
      );

      // notify target — match confirmed
      emitAlert(alert, true);

      // notify other sources — request fulfilled
      const io = getIO();
      const cancelledAlerts = await Alert.find({
        drug_id:         alert.drug_id,
        target_facility: alert.target_facility,
        type:            alert.type,
        status:          'cancelled',
      });

      for (const cancelled of cancelledAlerts) {
        io.to(cancelled.source_facility.toString()).emit('alert_cancelled', {
          message: `Request for ${alert.drug_name} has been fulfilled by another facility`,
          alert:   cancelled,
        });
      }

      res.status(200).json({
        status:  'success',
        message: 'Match confirmed — arrange transfer',
        alert,
      });

    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DECLINE ALERT ─────────────────────────────────────
  // called by SOURCE facility — they explicitly refuse
  declineAlert: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id:             req.params.id,
          source_facility: req.user.facility_id,
          status:          'pending',
        },
        {
          status: 'declined',
          notes:  req.body.notes || 'Source facility declined',
        },
        { returnDocument: 'after' }
      );

      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }

      // notify target — this source declined, others still pending
      const io = getIO();
      io.to(alert.target_facility.toString()).emit('alert_declined', {
        message: `A facility declined your ${alert.drug_name} request — others still pending`,
        alert,
      });

      res.status(200).json({ status: 'success', message: 'Alert declined', alert });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── SELF RESOLVE ──────────────────────────────────────
  // called by TARGET facility — handled externally
  selfResolve: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id:             req.params.id,
          target_facility: req.user.facility_id,
          status:          { $in: ['pending', 'confirmed'] },
        },
        {
          status:      'self_resolved',
          resolved_at: new Date(),
          notes:       req.body.notes || 'Resolved externally',
        },
        { returnDocument: 'after' }
      );

      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }

      // cancel all other pending alerts for this drug + facility
      await Alert.updateMany(
        {
          _id:             { $ne: alert._id },
          drug_id:         alert.drug_id,
          target_facility: req.user.facility_id,
          status:          'pending',
        },
        {
          status: 'cancelled',
          notes:  'Request self-resolved by facility',
        }
      );

      res.status(200).json({
        status:  'success',
        message: 'Alert self-resolved',
        alert,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── DISPATCH ALERT ────────────────────────────────────
  // PATCH /api/alerts/:id/dispatch
  // called by SOURCE facility — they have sent the drugs
  dispatchAlert: async (req, res) => {
    try {
      const alert = await Alert.findOne({
        _id:             req.params.id,
        source_facility: req.user.facility_id,
        status:          'confirmed',
      });

      if (!alert) {
        return res.status(404).json({ message: 'Alert not found or not yet confirmed' });
      }

      // set both status and dispatched_at
      alert.status        = 'dispatched';
      alert.dispatched_at = new Date();
      alert.notes         = req.body.notes || 'Drugs dispatched';
      await alert.save();

      // notify target — drugs are on the way
      const io = getIO();
      io.to(alert.target_facility.toString()).emit('drugs_dispatched', {
        message: `${alert.drug_name} has been dispatched by source facility`,
        alert,
      });

      res.status(200).json({
        status:  'success',
        message: 'Drugs marked as dispatched',
        alert,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },
  // ─── RESOLVE ALERT ─────────────────────────────────────
  // PATCH /api/alerts/:id/resolve
  // called by TARGET facility only — they confirmed receipt
  resolveAlert: async (req, res) => {
    try {
      const alert = await Alert.findOneAndUpdate(
        {
          _id:             req.params.id,
          target_facility: req.user.facility_id, // only target can resolve
          status:          'dispatched',          // must be dispatched first
        },
        {
          status:      'resolved',
          resolved_at: new Date(),
          notes:       req.body.notes || 'Drugs received',
        },
        { returnDocument: 'after' }
      );

      if (!alert) {
        return res.status(404).json({ message: 'Alert not found or not yet dispatched' });
      }

      res.status(200).json({
        status:  'success',
        message: 'Transfer complete — drugs received',
        alert,
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── 1. CREATE DRAFT TRANSFER (The OPay Preview) ──────────
  // POST /api/alerts/transfer/draft
  // Called when Facility A clicks "Request Drug". It saves to the DB but notifies NOBODY yet.
  createDraftTransfer: async (req, res) => {
    try {
      const { providerFacilityId, drugId, quantityRequested, unit, transactionType } = req.body;

      const draft = new Transfer({
        requesterFacility: req.user.facility_id,
        providerFacility: providerFacilityId,
        drugId: drugId,
        transactionType: transactionType, // 'Discounted Offload' or 'Standard Requisition'
        quantityRequested: quantityRequested,
        unit: unit, // 'Carton', 'Pack', 'Card', etc.
        status: 'Draft'
      });

      await draft.save();

      res.status(201).json({
        status: 'success',
        message: 'Draft created. Proceed to confirmation screen.',
        draft
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── 2. TRANSMIT TRANSFER (The OPay "Confirm" Button) ─────
  // PATCH /api/alerts/transfer/:id/transmit
  // Called when Facility A hits "Confirm & Transmit". Starts the clock and alerts Facility B.
  transmitTransfer: async (req, res) => {
    try {
      const draft = await Transfer.findOne({
        _id: req.params.id,
        requesterFacility: req.user.facility_id,
        status: 'Draft'
      }).populate('drugId', 'drug_name');

      if (!draft) {
        return res.status(404).json({ message: 'Draft not found or already transmitted' });
      }

      // Set status and start the 24-hour Revert Window
      draft.status = 'Pending Approval';
      const revertWindow = new Date();
      revertWindow.setHours(revertWindow.getHours() + 24); 
      draft.revertWindowEndsAt = revertWindow;

      await draft.save();

      // NOW we notify Facility B that a request has officially arrived
      const io = getIO();
      io.to(draft.providerFacility.toString()).emit('new_transfer_request', {
        message: `New request: ${draft.quantityRequested} ${draft.unit} of ${draft.drugId.drug_name}`,
        transfer: draft
      });

      res.status(200).json({
        status: 'success',
        message: 'Request officially transmitted to providing facility.',
        transfer: draft
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  },

  // ─── 3. REVERT TRANSFER (The 24-Hour Grace Period) ────────
  // PATCH /api/alerts/transfer/:id/revert
  // Can be called by EITHER facility, but ONLY if the revert window hasn't expired.
  revertTransfer: async (req, res) => {
    try {
      const transfer = await Transfer.findOne({
        _id: req.params.id,
        $or: [
          { requesterFacility: req.user.facility_id },
          { providerFacility: req.user.facility_id }
        ],
        status: { $in: ['Pending Approval', 'Accepted'] }
      });

      if (!transfer) {
        return res.status(404).json({ message: 'Transfer not found or cannot be reverted' });
      }

      // Check if the timer has run out
      const now = new Date();
      if (now > transfer.revertWindowEndsAt) {
        return res.status(403).json({ 
          message: 'Policy Error: The 24-hour revert window has already expired. Logistics are locked.' 
        });
      }

      transfer.status = 'Reverted';
      await transfer.save();

      // Notify the other party that the deal was cancelled
      const targetRoom = transfer.requesterFacility.toString() === req.user.facility_id.toString() 
        ? transfer.providerFacility.toString() 
        : transfer.requesterFacility.toString();

      const io = getIO();
      io.to(targetRoom).emit('transfer_reverted', {
        message: 'A drug transfer was reverted within the grace period.',
        transfer
      });

      res.status(200).json({
        status: 'success',
        message: 'Transfer successfully reverted.',
        transfer
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }

};

export default alertController;