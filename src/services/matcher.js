import Drug from '../models/drug.js';
import Alert from '../models/alert.js';

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
  }).populate('facility_id', 'name state lga tier isNetworkMember isActive');

  const validMatches = potentialMatches.filter(d => 
    d.facility_id && 
    d.facility_id.isNetworkMember && 
    d.facility_id.isActive
  );

  const priorityMatches = []; 
  const recommended = [];
  const openNetwork = [];

  const reqTier = requesterFacility.tier;
  const reqState = requesterFacility.state;
  
  // Define the 180-day (6 month) FEFO liability threshold
  const now = new Date();
  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setDate(now.getDate() + 180);

  for (const match of validMatches) {
    const provFac = match.facility_id;
    let isRecommended = false;
    let isPriority = false;

    // ROP LOGIC: Seeking Surplus or Expiring Drugs
    if (alertType === 'ROP') {
        if (match.total_quantity < (match.reorder_point * 1.2)) continue;

        // WASTE VS WANT CHECK
        if (match.expiry_date && new Date(match.expiry_date) <= sixMonthsFromNow) {
            isPriority = true;
        }
    }

    // FEFO LOGIC: Pushing Expiring Drugs
    if (alertType === 'FEFO') {
        if (match.total_quantity > match.reorder_point) continue; 
    }

    // Tier Matching (Peer-to-Peer & One-Up)
    const provTier = provFac.tier;
    let tierMatch = false;

    if (reqTier === 'Tier 3' && (provTier === 'Tier 3' || provTier === 'Tier 2')) tierMatch = true;
    if (reqTier === 'Tier 2' && (provTier === 'Tier 2' || provTier === 'Tier 1')) tierMatch = true;
    if (reqTier === 'Tier 1' && (provTier === 'Tier 1' || provTier === 'Tier 2')) tierMatch = true;

    const stateMatch = (reqState === provFac.state);

    if (tierMatch && stateMatch) {
        isRecommended = true;
    }

    const facilityData = {
        facilityId: provFac._id,
        name: provFac.name,
        tier: provFac.tier,
        state: provFac.state,
        lga: provFac.lga,
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