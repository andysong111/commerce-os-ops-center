# Purchase reentry source recovery — 2026-09-14

## Boundary and recovery

Owner asked to prepare the October 1 purchase cycle, keeping actual approval,
orders/payment, stock baselines, receipt quantities and Shopling writes locked.
Base main: `dba0857d899582d4fee10a9303bb63ffcd94d0f5`.
This patch is read-only source diagnosis and scope correction. It does not complete
source refresh/publication or certify operational recommendations as ready.
Rollback only this PR; do not reset unrelated parallel main work.

## Confirmed evidence

- Production reentry readback was BLOCKED, with 406 active profiles, 0 candidates,
  7 invalid profile codes and demandAsOf 2026-09-07T14:32:29.432Z.
- Product Master read-only query found exactly seven active TMP1-* launch
  placeholders (AAA206/AAA129/AAA109/AAA127/AAA357). These are not managed B-code
  identities. They must remain visible and unorderable, not cause canonical
  managed-SKU count mismatch for every legitimate B-code.
- OPS commitment aggregate query found 231 succeeded event rows: 229 managed
  code rows and 2 UNASSIGNED rows (RESERVED and ORDERED; ordered quantity 200).
  This is still unresolved inbound, not an empty ledger or a transient read error.
  Do not infer a replacement SKU, delete the old events, or ignore this order.
- Latest canonical event collection report, Sept 7: 12,371 events, zero unmapped
  rows and identity conflicts. The latest official event full-publication operation
  is older. Monthly sales-incremental operations and raw timestamped canonical
  event publication are different sources; a recent monthly sync cannot certify
  fresh 12x30-day event demand.
- Some detailed SQL calls were blocked by the tool security classifier. Do not
  claim full raw database reconciliation; the above is based on successful narrow
  read-only queries and the runtime source code.

## Changes

1. Commitment normalization errors now preserve safe actionable codes for missing
   barcode/identity/status/time instead of becoming COMMITMENTS_READ_FAILED.
   The source remains unavailable, never empty; no business row is mutated.
2. Only the seven observed TMP1-1 through TMP1-7 placeholders are separated from managed demand scope. They
   remain visible DATA_HOLD rows. Unknown malformed codes still globally block.
   Cross-source duplicate SKU identities remain blocked. Any open TMP/unknown
   commitment still globally blocks; catalogue quarantine never hides inbound.
3. Missing official demand is labelled source-unavailable rather than asserting
   that every SKU has corrupt identity. Actual malformed rows in a present snapshot
   retain the existing strict identity/bucket validation.
4. READY_CANARY / READY_FULL official-source status becomes an explicit
   publication-pending blocker. The old analysis timestamp is preserved and still
   fails freshness. No pending data is promoted or treated as verified demand.
5. The screen shows ordered recovery checks (sales, commitments, catalogue/cost,
   stock/status, purchase-day approval), managed/quarantined counts and source
   stage. Failed reads mark previous recovery checks stale, not currently verified.
6. Permanent no-order/no-allocation/no-write gates are unchanged, including after
   October 1. Existing normal V2/manual-open/cost-estimate policies are unchanged.

## Verification assets

- `tests/purchaseCycleReentryShadowSourceRecovery.test.mjs`: 13 cases; the first 10 reproduce
  6 failures against the original core/commitment source. Two review cases fail
  on PR head 4c4f666 and pass after narrowing the observed placeholder set and
  reflecting row-level failures in sales/catalogue recovery states.
- A third review regression reproduces unchanged fingerprints across READY_CANARY
  to READY_FULL publication phases and verifies phase-aware fingerprint changes.
- All 39 reentry unit/adapter/API regressions pass locally, 0 skipped.
- `Purchase Reentry Shadow CI` explicitly runs the new suite and focused lint.
  Existing actual React/StrictMode browser fixture now checks recovery display
  and stale labelling. This remains mocked-data browser proof, not real purchases.
- Existing general CI/build and precise-head Vercel Preview must pass before merge.
- Production readback prints source stage and recovery-state aggregates, never
  individual order details. A BLOCKED result must still be reported as BLOCKED.

## Work still required before October 1

- Resolve the real unassigned inbound using original order/option identity. Only
  persist an exact proven mapping with normal reconciliation controls. Unproven
  identity requires operator confirmation; 200 units must not disappear.
- Finish existing canonical candidate comparison/publication gates, then collect
  fresh full timestamped source evidence. Do not replace it with calendar-month
  incremental sales, reuse a stale timestamp, or bypass promotion gates.
- Read confirmed costs from existing authoritative evidence and retain missing-cost
  holds. Do not manufacture costs as a percentage of selling prices in this shadow.
- Refresh existing inventory sales evidence through its explicit evidence-refresh
  path; missing baselines accumulate naturally. No warehouse-wide stocktake.
- On purchase day read closed revenue and actual available cash, compare the
  normal V2 result including manual-open and estimated-cost differences, approve
  only a small batch, then verify order -> open commitment -> receipt -> inventory
  -> sale status. The rehearsal output is never an execution credential.
