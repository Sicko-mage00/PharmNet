import Drug from '../models/drug.js';
import Alert from '../models/alert.js';

// ─── ROP MATCHER ─────────────────────────────────────────
export const matchROP = async (ropData, saleId) => {

  const potentialSources = await Drug.find({
    drug_name:   ropData.drug_name,
    facility_id: { $ne: ropData.facility_id },
    isActive:    true,
    $expr: {
      $gte: [
        '$total_quantity',
        { $multiply: ['$reorder_point', 1.2] }
      ]
    },
  })
  .populate('facility_id', 'name location isNetworkMember isActive')
  .sort({ total_quantity: -1 });

  const validSources = potentialSources.filter(d =>
    d.facility_id &&
    d.facility_id.isNetworkMember &&
    d.facility_id.isActive
  );

  // no match — create self alert
  if (!validSources.length) {
    const selfAlert = await Alert.create({
      type:              'ROP',
      drug_id:           ropData.drug_id,
      drug_name:         ropData.drug_name,
      source_facility:   ropData.facility_id,
      target_facility:   ropData.facility_id,
      quantity_needed:   ropData.quantity_needed,
      triggered_by_sale: saleId,
      notes:             'No matching supplier found in network',
    });
    return [{ alert: selfAlert, matched: false }];
  }

  // create one alert per valid source — all notified simultaneously
  const results = [];

  for (const source of validSources) {
    const existingAlert = await Alert.findOne({
      drug_id:         ropData.drug_id,
      target_facility: ropData.facility_id,
      source_facility: source.facility_id._id,
      status:          { $in: ['pending', 'confirmed'] },
    });

    if (existingAlert) {
      results.push({ alert: existingAlert, matched: true });
      continue;
    }

    const alert = await Alert.create({
      type:               'ROP',
      drug_id:            ropData.drug_id,
      drug_name:          ropData.drug_name,
      source_facility:    source.facility_id._id,
      target_facility:    ropData.facility_id,
      quantity_available: source.total_quantity - source.reorder_point,
      quantity_needed:    ropData.quantity_needed,
      triggered_by_sale:  saleId,
    });

    results.push({ alert, matched: true });
  }

  return results;
};


// ─── FEFO MATCHER ────────────────────────────────────────
export const matchFEFO = async (fefoData, saleId) => {

  const potentialTargets = await Drug.find({
    drug_name:   fefoData.drug_name,
    facility_id: { $ne: fefoData.facility_id },
    isActive:    true,
    $expr: {
      $lte: ['$total_quantity', '$reorder_point']
    },
  })
  .populate('facility_id', 'name location isNetworkMember isActive')
  .sort({ total_quantity: 1 });

  const validTargets = potentialTargets.filter(d =>
    d.facility_id &&
    d.facility_id.isNetworkMember &&
    d.facility_id.isActive
  );

  if (!validTargets.length) {
    const selfAlert = await Alert.create({
      type:               'FEFO',
      drug_id:            fefoData.drug_id,
      drug_name:          fefoData.drug_name,
      source_facility:    fefoData.facility_id,
      target_facility:    fefoData.facility_id,
      quantity_available: fefoData.quantity,
      expiry_date:        fefoData.expiry_date,
      triggered_by_sale:  saleId,
      notes:              'No matching recipient found in network',
    });
    return [{ alert: selfAlert, matched: false }];
  }

  const results = [];

  for (const target of validTargets) {
    const existingAlert = await Alert.findOne({
      drug_id:         fefoData.drug_id,
      source_facility: fefoData.facility_id,
      target_facility: target.facility_id._id,
      status:          { $in: ['pending', 'confirmed'] },
    });

    if (existingAlert) {
      results.push({ alert: existingAlert, matched: true });
      continue;
    }

    const alert = await Alert.create({
      type:               'FEFO',
      drug_id:            fefoData.drug_id,
      drug_name:          fefoData.drug_name,
      source_facility:    fefoData.facility_id,
      target_facility:    target.facility_id._id,
      quantity_available: fefoData.quantity,
      quantity_needed:    target.reorder_point - target.total_quantity,
      expiry_date:        fefoData.expiry_date,
      triggered_by_sale:  saleId,
    });

    results.push({ alert, matched: true });
  }

  return results;
};