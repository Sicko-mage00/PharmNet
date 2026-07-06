// ─── STATUS CLASSIFICATION ─────────────────────────────────
// Single source of truth for "is this done" vs "does this still need
// a response" across both Alert (internal ROP/FEFO) and Transfer
// (external network requests) documents. The frontend uses this to
// decide whether to show action buttons, and whether a timed-out item
// should nudge the user to try again rather than just disappearing.

// Genuinely finished — no further action possible or useful.
export const ALERT_TERMINAL_STATUSES = ['resolved', 'self_resolved', 'declined', 'cancelled'];
export const TRANSFER_TERMINAL_STATUSES = ['Completed', 'Rejected'];

// revert_reason values that mean "this is over, don't re-prompt" —
// auto_cancelled_broadcast means another facility already fulfilled it.
const TRANSFER_SETTLED_REVERT_REASONS = ['auto_cancelled_broadcast', 'manual'];

export const isAlertResolved = (alert) => ALERT_TERMINAL_STATUSES.includes(alert.status);

export const isTransferResolved = (transfer) => {
  if (TRANSFER_TERMINAL_STATUSES.includes(transfer.status)) return true;
  if (transfer.status === 'Reverted') {
    // Reverted for a "settled" reason (auto-cancelled by broadcast, or the
    // requester manually cancelled it) = truly done. Reverted because it
    // was declined or timed out = still unresolved, request is still live.
    return TRANSFER_SETTLED_REVERT_REASONS.includes(transfer.revert_reason);
  }
  return false;
};

// "Still unresolved" — the alert/transfer timed out or was declined, but
// the underlying problem (low stock / expiring drug) hasn't gone away.
// The UI should keep this visible and actionable (e.g. "Request again")
// rather than treating it like a dead, resolved item.
export const isAlertStillUnresolved = (alert) => alert.status === 'expired';

export const isTransferStillUnresolved = (transfer) =>
  transfer.status === 'Reverted' &&
  ['declined', 'expired'].includes(transfer.revert_reason);

// internal = self-generated (source and target facility are the same);
// external = an actual cross-facility interaction.
export const alertChannel = (alert) => {
  const source = alert.source_facility?._id || alert.source_facility;
  const target = alert.target_facility?._id || alert.target_facility;
  return String(source) === String(target) ? 'internal' : 'external';
};