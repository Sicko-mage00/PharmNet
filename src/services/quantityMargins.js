// ─── SAFE QUANTITY MARGINS ─────────────────────────────────
// Suggests sane preset quantities when a facility requests stock from
// the network, based on how far below reorder_point they currently are.
// The requester can still override with their own custom number —
// these are presets, not hard limits — but we cap the "safe" ceiling
// so the UI doesn't suggest something absurd for a near-empty reorder_point.

export const getSafeMargins = (drug) => {
  const rop = Math.max(drug.reorder_point || 0, 0);
  const current = Math.max(drug.total_quantity || 0, 0);
  const shortfall = Math.max(rop - current, 0);

  // Always suggest at least enough to reach the reorder point (or 1 unit,
  // for edge cases where reorder_point is 0 but stock has run out anyway).
  const minimumTopUp = Math.max(shortfall, current === 0 ? 1 : 0) || 1;
  const standardRefill = Math.max(rop * 2 - current, minimumTopUp + 1);
  const bulkRestock = Math.max(rop * 3 - current, standardRefill + 1);

  return [
    { label: 'Minimum Top-up', quantity: Math.round(minimumTopUp), description: 'Brings stock back up to the reorder point' },
    { label: 'Standard Refill', quantity: Math.round(standardRefill), description: 'Reorder point x2 — a normal restock buffer' },
    { label: 'Bulk Restock',    quantity: Math.round(bulkRestock),   description: 'Reorder point x3 — for high-turnover drugs' },
  ];
};

// Sanity check for a custom quantity a requester types in themselves.
// Not a hard business rule — just catches obvious fat-finger errors
// (0/negative, or something wildly disproportionate to the drug's
// normal reorder point) before it reaches the network.
export const validateCustomQuantity = (drug, quantity) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { valid: false, message: 'Quantity must be a positive number' };
  }
  const rop = Math.max(drug.reorder_point || 1, 1);
  if (qty > rop * 10) {
    return {
      valid: false,
      message: `That's over 10x this drug's reorder point (${rop}). Double-check the amount, or split it into multiple requests.`,
    };
  }
  return { valid: true };
};