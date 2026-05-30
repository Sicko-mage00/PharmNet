
import Alert from '../models/alert.js';
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
          message: `No facility responded for ${alert.drug_name} within 24 hours`,
          alert,
        });
      }
    }

    if (expiredAlerts.length) {
      console.log(`${expiredAlerts.length} alerts expired`);
    }

  } catch (err) {
    console.error('Alert expiry check failed:', err.message);
  }
};