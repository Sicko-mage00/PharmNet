import Drug from '../models/drug.js';
import Alert from '../models/alert.js';
import { TIER_LEVELS } from '../models/facility.js';

// ─── 1. ROP TRIGGER (Creates a Self-Alert) ────────────────────────
export const matchROP = async (ropData, saleId) => {
  console.log('[matcher#matchROP] Triggered for:', ropData.drug_name);

  // FETCH THE DRUG TO GET THE EXACT CURRENT LOW STOCK
  const drug = await Drug.findById(ropData.drug_id);

  const selfAlert = await Alert.create({
    type:              'ROP',
    drug_id:           ropData.drug_id,
    drug_name:         ropData.drug_name,
    source_facility:   ropData.facility_id, 
    target_facility:   ropData.facility_id,
    quantity_needed:   ropData.quantity_needed,
    quantity_available: drug ? drug.total_quantity : 0, // ── Captures exact current stock
    triggered_by_sale: saleId,
    status:            'pending',
    notes:             'Low stock detected. Click to request from network.',
  });

  return [{ alert: selfAlert, matched: false }];
};

// ─── 2. FEFO TRIGGER (Creates a Self-Alert) ───────────────────────
export const matchFEFO = async (fefoData, saleId) => {
  console.log('[matcher#matchFEFO] Triggered for:', fefoData.drug_name);

  const selfAlert = await Alert.create({
    type:               'FEFO',
    drug_id:            fefoData.drug_id,
    drug_name:          fefoData.drug_name,
    source_facility:    fefoData.facility_id,
    target_facility:    fefoData.facility_id,
    quantity_available: fefoData.quantity,
    expiry_date:        fefoData.expiry_date,
    triggered_by_sale:  saleId,
    status:             'pending',
    notes:              'Drugs expiring soon. Click to push discounted offload.',
  });

  return [{ alert: selfAlert, matched: false }];
};

// ─── 3. THE TIER, GEOGRAPHY & WASTE-VS-WANT ENGINE ────────────────
export const getCategorizedMatches = async (requesterFacility, drugName, alertType) => {
  let potentialMatches = await Drug.find({
    drug_name: drugName,
    facility_id: { $ne: requesterFacility._id }, 
    isActive: true
  }).populate('facility_id', 'name address type tier tier_rank isNetworkMember isActive');

  const validMatches = potentialMatches.filter(d => 
    d.facility_id && 
    d.facility_id.isNetworkMember && 
    d.facility_id.isActive
  );

  const priorityMatches = []; 
  const recommended = [];
  const openNetwork = [];

  const reqTierRank = requesterFacility.tier_rank || 1;
  const reqState = requesterFacility.address ? requesterFacility.address.state : null;
  
  // Define the 180-day (6 month) FEFO liability threshold
  const now = new Date();
  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setDate(now.getDate() + 180);

  for (const match of validMatches) {
    const provFac = match.facility_id;
    let isRecommended = false;
    let isPriority = false;

    // Drugs don't carry a top-level expiry_date — the nearest expiring
    // batch (already FEFO-sorted by the pre-save hook) is batches[0].
    const nearestBatch = match.batches && match.batches.length ? match.batches[0] : null;
    const nearestExpiry = nearestBatch ? new Date(nearestBatch.expiry_date) : null;

    // ROP LOGIC: Seeking Surplus or Expiring Drugs
    if (alertType === 'ROP') {
        if (match.total_quantity < (match.reorder_point * 1.2)) continue;

        // WASTE VS WANT CHECK
        if (nearestExpiry && nearestExpiry <= sixMonthsFromNow) {
            isPriority = true;
        }
    }

    // FEFO LOGIC: Pushing Expiring Drugs
    if (alertType === 'FEFO') {
        if (match.total_quantity > match.reorder_point) continue; 
    }

    // Tier Matching — same tier or HIGHER only, per the actual design:
    // a facility never gets matched with a lower-tier facility, whether
    // requesting stock (ROP) or offloading expiring stock upward (FEFO).
    const provTierRank = provFac.tier_rank || 1;
    const tierMatch = provTierRank >= reqTierRank;

    const provState = provFac.address ? provFac.address.state : null;
    const stateMatch = reqState && provState && reqState === provState;

    if (tierMatch && stateMatch) {
        isRecommended = true;
    }

    const facilityData = {
        facilityId: provFac._id,
        name: provFac.name,
        tier: provFac.tier,
        tierRank: provFac.tier_rank,
        tierLabel: (TIER_LEVELS[provFac.tier] || TIER_LEVELS.tier_1_primary).label,
        city: provFac.address ? provFac.address.city : null,
        state: provState,
        statusText: isPriority ? 'Expiring Soon (Discount Available)' : (alertType === 'ROP' ? 'Sufficient Stock' : 'Demand High'),
        transactionType: isPriority ? 'Discounted Offload' : 'Standard Requisition'
    };

    if (isPriority) {
        priorityMatches.push(facilityData);
    } else if (isRecommended) {
        recommended.push(facilityData);
    } else {
        openNetwork.push(facilityData);
    }
  }

  return {
      priorityMatches,
      recommended,
      openNetwork
  };
};