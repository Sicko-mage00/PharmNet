import cron from 'node-cron';
import Drug from './models/drug.js';
import Alert from './models/alert.js';
import { getIO } from './services/socket.js'; // Using getIO to broadcast to everyone

const runNightlyFEFOScan = async () => {
    console.log('[Cron] Starting nightly FEFO (Expiry) scan...');
    try {
        // Find all active drugs across ALL facilities
        const activeDrugs = await Drug.find({ isActive: true });
        let alertsCreated = 0;
        const today = new Date();

        for (const drug of activeDrugs) {
            if (!drug.batches || drug.batches.length === 0) continue;

            for (const batch of drug.batches) {
                const daysToExpiry = Math.ceil((new Date(batch.expiry_date) - today) / (1000 * 60 * 60 * 24));
                
                // If it is expiring within the alert window (and hasn't already expired into negatives)
                if (daysToExpiry <= (drug.expiry_alert_days || 180) && daysToExpiry > 0) {
                    
                    // Check if an alert already exists for this exact batch
                    const existingFEFO = await Alert.findOne({ 
                        type: 'FEFO', 
                        drug_id: drug._id, 
                        batch_number: batch.batch_number, 
                        status: 'pending', 
                        source_facility: drug.facility_id 
                    });

                    if (!existingFEFO) {
                        const newAlert = await Alert.create({
                            type: 'FEFO',
                            drug_id: drug._id,
                            drug_name: drug.drug_name,
                            batch_number: batch.batch_number,
                            expiry_date: batch.expiry_date,
                            source_facility: drug.facility_id,
                            target_facility: drug.facility_id,
                            quantity_available: batch.quantity,
                            status: 'pending',
                            notes: `System generated (Nightly Scan): Batch expires in ${daysToExpiry} days.`
                        });

                        // Emit socket event specifically to the facility that owns the drug
                        const io = getIO();
                        if (io) {
                            io.to(drug.facility_id.toString()).emit('new_alert', newAlert);
                        }
                        
                        alertsCreated++;
                    }
                }
            }
        }
        console.log(`[Cron] Nightly scan complete. Generated ${alertsCreated} new FEFO alerts.`);
    } catch (err) {
        console.error('[Cron] Error running nightly FEFO scan:', err);
    }
};

// Schedule the task to run every night at 12:00 AM (Midnight)
export const initCronJobs = () => {
    cron.schedule('0 0 * * *', runNightlyFEFOScan, {
        scheduled: true,
        timezone: "Africa/Lagos" // Adjust this to your local timezone
    });
    console.log('[Cron] Nightly FEFO scanner initialized.');
};