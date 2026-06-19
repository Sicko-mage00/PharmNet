import cron from 'node-cron';
import Drug from './models/drug.js';
import Alert from './models/alert.js';
import { getIO } from './services/socket.js'; 

const runNightlyFEFOScan = async () => {
    console.log('[Cron] Starting nightly FEFO (Expiry) scan...');
    try {
        const activeDrugs = await Drug.find({ isActive: true });
        let alertsCreated = 0;
        const today = new Date();

        for (const drug of activeDrugs) {
            if (!drug.batches || drug.batches.length === 0) continue;

            for (const batch of drug.batches) {
                const daysToExpiry = Math.ceil((new Date(batch.expiry_date) - today) / (1000 * 60 * 60 * 24));
                
                // BUG FIX: Removed "> 0" so it flags already expired drugs
                if (daysToExpiry <= (drug.expiry_alert_days || 180)) {
                    
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
                            notes: daysToExpiry <= 0 
                                ? `System generated (Nightly Scan): Batch EXPIRED ${Math.abs(daysToExpiry)} days ago!`
                                : `System generated (Nightly Scan): Batch expires in ${daysToExpiry} days.`
                        });

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

export const initCronJobs = () => {
    cron.schedule('0 0 * * *', runNightlyFEFOScan, {
        scheduled: true,
        timezone: "Africa/Lagos" 
    });
    console.log('[Cron] Nightly FEFO scanner initialized.');
};