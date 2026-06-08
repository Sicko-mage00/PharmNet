# ROP alert visibility bug - fix notes

## Symptom
ROP triggers for a facility user, but that user's `/alerts` page shows no ROP card.

## Root cause (most likely)
Alert targeting fields (`source_facility` / `target_facility`) or filtering mismatch between:
- Alert creation in `matchROP`
- Alert retrieval in `getAlerts`

## Fix approach implemented
1) Added server-side debug logs.
2) Hardened `/api/alerts` filtering to match both `ObjectId` and string forms of `req.user.facility_id`.

## Remaining possibility
If `matchROP` swaps source/target or sets `type`/`status` unexpectedly, `/api/alerts` will still return 0.

## Next step (manual verification)
- Trigger ROP sale
- Inspect created Alert document fields: `source_facility`, `target_facility`, `status`, `type`
- Compare to logged `req.user.facility_id` from getAlerts.

