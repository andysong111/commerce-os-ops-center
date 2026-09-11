# Warehouse capacity: sourcing space preflight

## Scope and recovery point

This change adds an advisory, read-only intake check to `/warehouse-capacity` and aligns its lifecycle/capacity labels with Product Master. It does not create orders, reserve locations, modify inventory or prices, change Shopling, promote lifecycle baselines, or mark the physical registry complete.

OPS starting checkpoint: `bba694b91f93eda8fc0b1b910e7cf2dfd6158a75`.
Product Master reserve fix: PR #54, production commit `4f1f4cb92581d28c5d1f855df0c471c5fa2e4a56`.
Recovery is code-only: revert this OPS PR. No database migration or data rollback is required. No environment variables or external secrets are added.

## Facts versus assumptions

The database read on 2026-09-11 found 407 registered observed locations and 407 active SKUs. These are not proof of total physical warehouse capacity. The primary physical registry remained unconfirmed, reserve count 0, and no confirmation timestamp. Lifecycle had 316 rows in WAITING_BASELINE/shadow mode; 91 active SKU rows therefore lacked a lifecycle row. These are dated observations, not hardcoded runtime values.

The operator still needs to supply/verify the full actual location list including empty positions. Do not infer empty positions from the largest barcode or code pattern. Do not promote WAITING_BASELINE or disable shadow mode merely to remove warnings.

## Calculations

- Immediate slots: `max(0, registered free allocatable slots - reserve)`.
- Conditional slots after candidate release: `max(0, registered free allocatable slots + baseline-verified exit candidates - reserve)`.
- Do not use `max(0, free - reserve) + exits`: it spends an unfilled reserve when free is smaller than reserve.
- Planned releases are not current free space, guaranteed future releases, or proof of release before this month's inbound date.
- Six-month analytical readiness and shadow execution mode are distinct. Missing/unready candidates are excluded from the conditional scenario; they do not negate actual free slots once the physical registry is confirmed.

## New GET contract

`GET /api/warehouse-capacity/intake-preflight` accepts exactly one of each query parameter:

- `productCount`: positive integer, new products under review.
- `optionsPerProduct`: positive integer, exact uniform option count assumed for each product.
- `slotsPerSku`: positive integer, physical positions required by each option under the assumed inbound quantity/size.
- `committedSlots`: nonnegative integer, **explicit** unallocated inbound/order commitments not already deducted as occupied locations or reserve. Missing/blank does not default to zero.

Inputs are bounded to 100,000. The endpoint reads a fresh Product Master snapshot and returns `DRY_RUN`, `executionAllowed=false`, and one of BLOCKED, SPACE_ONLY_FITS, SPACE_SHORTFALL. It never reserves space and cannot authorize ordering.

`requiredSlots = productCount * optionsPerProduct * slotsPerSku`

`availableSlots = max(0, immediateSlots - committedSlots)`

The gate checks physical registry confirmation, conflict counts, exact immediate-capacity arithmetic, and snapshot age (5 minutes, with 30 seconds future skew tolerance). It does not consume forecast capacity. A second request re-reads the ledger instead of trusting a prior pass. Identical inputs do not reserve or mutate anything.

## Explicit limitations / next phase

Pending inbound/order commitments are currently an operator assumption, **not yet automatically reconciled with the purchase/receipt ledgers**. This is a scenario tool and a read-only integration boundary, not the completed monthly sourcing engine.

Before automatic monthly intake can be enabled, implement reliable inbound reservation accounting, physical release evidence and dates, atomic capacity reservations against concurrent runs, product dimensions/slot fit, budget, demand, profitability and delivery-date gates. Keep the actual ordering switch off until these are proven. No personal API key input is required by this change.

The existing OPS origin guard is retained. It is a same-origin browser boundary, not a new identity/authentication system; the broader temporary-login configuration is unchanged.

## Verification

- Product Master CI quality: 145 tests passed, lint/build passed on PR #54; 400 reserve/free/exit boundary combinations are tested.
- `tests/warehouseIntakePreflight.test.mjs`: pure calculations, 144 capacity combinations, strict/missing assumptions, stale/future data, conflicts, actual GET-route execution with bounded in-memory dependencies, and upstream failure handling.
- `tests/warehouseCapacityOps.test.mjs`: original secret/action whitelist/origin/input-preservation safety checks retained, labels updated to the current analytical-vs-execution contract; buffer-only editing retains registry confirmation state and rejects blank buffers.
- `.github/workflows/warehouse-capacity-preflight-ci.yml`: permanent focused lint, unit/route tests and real Chromium fixture interaction with the local application.
- `scripts/warehouse-intake-browser-smoke.mjs`: fixture mode intercepts all warehouse API responses and simulated write failures in memory; no synthetic write is sent to any server. Manual live mode is restricted to main and the production OPS origin, forwards only GET/HEAD and only the two warehouse APIs, logs summary counts rather than SKU rows, and requires the updated Product Master contract.
- The normal CI build remains required independently. Fixture browser success alone is not evidence of a working production secret or database connection; the separately dispatched live read-only smoke verifies that after deployment.

## Operator interface

The new panel distinguishes products from options, clears stale results on edited inputs, preserves inputs on dependency failures and requires pending commitments explicitly. Physical registry management preserves failed text for correction. A separate buffer-save action retains the existing registry-complete flag; blank buffers cannot become zero. Unconfirming the registry omits the buffer field to preserve its stored value.
