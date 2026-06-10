import mongoose from 'mongoose';
import Alert from '../models/alert.js';
import Drug from '../models/drug.js';
import { emitAlert, getIO } from '../services/socket.js';

const parseFacilityId = (req, res, next) => {
  if (req.user && req.user.facility_id) {
    // Attach the casted ObjectId directly to the request object
    req.facilityObjectId = new mongoose.Types.ObjectId(req.user.facility_id.toString());
  }
  next();
};

const alertController = {

  // ─── GET ALL ALERTS ────────────────────────────────────
  getAlerts: async (req, res) => {
    try {

      const alerts = await Alert.find({
        $or: [
          { target_facility: req.facilityObjectId },
          { source_facility: req.facilityObjectId },
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

};

export default alertController;