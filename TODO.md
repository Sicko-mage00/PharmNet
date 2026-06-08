# TODO - Alerts UI fix (ROP not showing)

## Plan
- Identify why ROP alert record exists for one account but doesn’t appear in the Alerts UI for Oreoke.
- Confirm filtering logic in `/api/alerts` vs alert creation logic in `matchROP`.
- Verify how `req.user.facility_id` is stored and used for alert filtering.
- Fix mismatch that prevents Oreoke’s facility from matching alerts.

## Current Investigation
- Alerts UI exists: `src/views/alerts.pug` + indicators in `src/views/layout.pug` + polling/socket in `src/public/js/main.js`.
- Alerts API filtering: `src/controllers/alert.js#getAlerts` shows only alerts where `target_facility` OR `source_facility` equals `req.user.facility_id`.
- ROP matcher `src/services/matcher.js#matchROP` creates alerts with `source_facility` = supplier facility and `target_facility` = requesting facility.
- `Facility` schema defaults `isNetworkMember` and `isActive` to true.

## Fix to implement (next)
- Add server-side logging for `/api/alerts` and `matchROP` to print:
  - Oreoke `req.user.facility_id`
  - alert `source_facility`/`target_facility` for the created record
  - whether `validSources.length` was 0 (self alert) or >0 (network alerts)
- Then apply a code fix if a concrete mismatch is found (most likely `facility_id` type/value mismatch, or self-alert vs network alert scenario).

## Change implemented
- (Next step) Add logging inside `src/controllers/alert.js#getAlerts` and `src/services/matcher.js#matchROP`.


## Acceptance Criteria
- When ROP triggers for Oreoke’s facility, at least one alert card appears on `/alerts`.

