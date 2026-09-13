# Next purchase reentry shadow checkpoint

## Scope and recovery point

User approved preparatory development on 2026-09-14 for the 2026-10-01 purchase.
Recovery point: OPS main `1fa70ae3bf787c008ede80b109e9059bf7f115a4`.
Barcode scanner remains a deferred convenience feature.

The existing `fastPurchaseCashEnvelope.ts` already consumes
`loadPurchaseCycleStockReport({refreshSales:true})` and open purchase commitments.
This change does not invent another demand formula or replace the live approval path.
It reuses `calculatePurchaseV2Product` and the existing canonical ledger reducers
in a separate read-only, unbudgeted rehearsal.

## Operator surface

- `/china-order-manager/reentry-shadow`: next-month rehearsal using evidence as of now.
- GET `/api/china-order-manager/reentry-shadow?targetMonth=2026-10`: current/next KST month only.
- Visible/online page recalculates every five minutes; hidden/offline pauses.
- Error interval backs off to fifteen minutes. Concurrent requests single-flight;
  completed READY responses are not cached over evidence expiry.
- Closing the page stops automatic reads. No new cron, dispatcher task or ChatGPT
  scheduled automation is installed. This is not unattended purchasing.
- Scanner, actual orders, payment, baseline creation, receipt confirmation, actual
  Shopling status changes and approval automation are all outside this change.

## Evidence and safety

1. Current Product Master SKU identity and canonical 12x30-day demand are validated.
   Missing buckets, duplicate B-codes, mismatched SKU IDs, impossible quantities,
   future timestamps and unreadable sources cannot become exact zero/ready candidates.
2. Stock uses the existing strict stocktake/reset/correction/Tail overlays with
   `refreshSales:false`. No Tail refresh events or new sales jobs are created by GET.
   Existing ten-minute sales-coverage validation is retained. Demand has an explicit
   24-hour rehearsal freshness ceiling; newly rendering old demand is not refreshing it.
3. A missing baseline is informational accumulation, not a command for a full physical
   stocktake. Valid existing estimated bands may be shown as reference only. A stale
   known baseline cannot fall back to an estimate. Estimates are never allocated.
4. Commitments are read with exact counts and ordered pages. Missing counts, truncated
   pages, concurrent count changes, invalid events and conflicting event IDs fail closed.
   RESERVED/EXPORTED/ORDERED/PARTIALLY_RECEIVED remaining quantities are reduced by
   existing ledger semantics. Older open cycles are included; no last-month-only filter.
5. Shadow uses **all** open quantity including manual additions. This is intentionally
   more conservative than the existing live `recommendationOpenQuantity` policy,
   which excludes manual additions. The difference is displayed. Existing finalized
   recommendations, original demand policy and live cash allocation remain untouched.
6. Stored terminal Shopling success is not independent verification that every marketplace
   row succeeded. Pending/failed/uncertain stock synchronization is review-only; this
   feature neither retries that work nor certifies all marketplaces.
7. Current stock is an as-of-now rehearsal, NOT projected stock on October 1.
   September revenue is not yet a closed October budget. No arbitrary cash is invented.
   `cashBudgetKrw=null`, every `allocatedQuantity=0`, `approvalGranted=false`,
   `actualPurchaseExecuted=false`, `writesEnabled=false` are permanent boundaries.
8. No schema migration, environment variable change, production baseline/receipt/order
   mutation or other project deployment is required. There is no durable shadow write.

## Verification

Permanent workflow: `Purchase Reentry Shadow CI`.
- `tests/purchaseCycleReentryShadow.test.mjs` executes the real V2 function, real
  sales-coverage validator, real commitment reducer and actual API/read adapter with
  denied unmocked network. Covers stock decreases, restock totals, partial receipts,
  manual/open commitments, stale evidence, malformed input, identity and no-write gates.
- `tests/purchaseCycleReentryShadow.browser.mjs` renders the actual React component
  under StrictMode against a mocked read API. Covers first display, five-minute
  recalculation, hidden/offline pause, fail-safe previous-result display and recovery.
- `tests/purchaseCycleReentryShadow.production.mjs` performs one authenticated-origin
  production GET after rollout and logs aggregates only. A BLOCKED response can pass
  the no-write contract but MUST be reported as operationally BLOCKED, not completed
  recommendation readiness. No fabricated inventory is inserted for a green smoke.
- Existing general CI/build remains required; no existing tests are weakened.

## October 1 gate

Re-read current evidence, close the budget revenue month, enter actual available cash,
calculate with normal V2, compare reference needs and manual-open differences, then
explicitly approve a small real batch. Observe actual order -> open commitment ->
receipt evidence without duplicate reservation before widening the batch.
The rehearsal output itself is not an approved Draft or an execution credential.
