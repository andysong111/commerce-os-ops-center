# Monthly-spend scan completeness follow-up

PR1211 review discussion_r4024749420 correctly identified that the legacy recent-summary reader scans only 120 global operation rows. A null summary therefore did not prove no spending in a target month.

The preflight no longer uses that reader. It queries the exact target month across the three documented snapshot storage shapes, before a bounded 1000-row limit per shape, requesting an exact count for each. Any missing count or count/data-length mismatch blocks the preflight, including nonzero partial scans. Only successful complete empty results prove no recorded spending. Malformed draft identity/month/paid amount blocks; numeric recorded KRW amounts are not inferred from fallback costs or exchange rates.

The first adapter revision correctly failed TypeScript CI: the repository uses a custom REST query implementation without SDK or(), and repeated order() overwrites earlier order. No failed build was merged. The corrected implementation uses three supported eq() queries, proves completeness for each, deduplicates by operation ID, blocks conflicting versions of an operation observed across queries, and sorts by started_at/id before existing latest-per-draft/snapshot precedence.

30 new tests cover empty vs incomplete, 121 drafts, server truncation, historical shapes, duplicates, invalid values, overflow, missing/conflicting multi-query rows and production adapter wiring. With the prior 97 preflight cases and 11 existing closure tests, dedicated CI now runs 138 tests. New exact-head CI must pass before merge; no actual business write or approval is enabled.

## Draft save decision pinning (2026-10-14)

Production evidence showed that the same reviewed purchase products and quantities could alternate between two diagnostic source fingerprints while a Draft save request was running. The volatile values were the sourcing exchange-rate estimate and audit-only source observations; the approved seven sourcing variants, their quantities, storage sizes, existing reorder lines and budget ceiling did not change. Exact whole-source equality therefore rejected a valid Draft twice with `PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED`.

Draft saves now re-run every live readiness gate and pin the actual decision content: target month, cash and sourcing limits, replacement audit, reorder products and quantities, and sourcing concept/variant/storage/quantity. Audit source fingerprints remain recorded and must still be well formed, but a refreshed observation or exchange-rate-only KRW estimate cannot invalidate an otherwise identical decision. The derived sourcing return and reorder cash may therefore move with FX without expiring the review when the selected reorder SKUs, quantities and estimated product spend are unchanged. A changed product, variant, storage size, quantity, budget, replacement Draft or blocker still fails closed. This boundary only saves an internal `RESERVED` Draft; it does not order from 1688, pay, or contact a supplier.
The reorder decision fingerprint is limited to the fields that reserve cash and quantity in the internal Draft: barcode, quantity and estimated line total. A nonzero quantity plus the line total also pins the effective unit cost. Product display names, inventory observations, priority score, evidence labels and replacement exclusion explanations remain in the audit/source fingerprint, but do not expire an unchanged Draft while the save request is running. Replacement membership and quantity changes remain pinned by barcode and quantity, so a real line change still blocks the write.

## Monthly strategy omission and replacement audit alignment (2026-10-23)

Production recalculation exposed two mismatched views. The purchase engine used Product Master's twelve completed calendar months for the adjustable monthly-revenue rule, while the omission audit checked only the rolling 30-day revenue summary. A product that exceeded the threshold in September could therefore have a zero demand target without a recorded `HISTORICAL_REVENUE_THRESHOLD` signal and still disappear from the review. The omission audit now checks the same `purchaseStrategyMonthly` history and requires the matching engine signal when a zero-target priority row exists. Positive demand targets remain compatible with older cached rows that did not persist signal provenance.

The replacement reader may recover one line from the immediate predecessor so a prior buggy pass cannot silently delete it. That recovered line remains available for preservation, but it is no longer counted as part of the visible current Draft when the operator-facing before/after audit is calculated. A visible 48-line Draft that becomes 49 lines now reports one added line instead of zero changes. Both changes remain read-only until the operator saves the internal Draft; neither performs a 1688 order or payment.

## Canonical completed-month sales authority (2026-10-23)

The purchase engine and omission audit now derive the twelve completed Korean
calendar months from Product Master's canonical `salesMonthly` ledger whenever
that ledger is present. The legacy `purchaseStrategyMonthly` payload remains a
strict compatibility fallback only. This prevents a stale all-zero strategy
payload from hiding a product that exceeded the operator's monthly revenue
threshold in the canonical September ledger. The current partial month is
excluded from the twelve-month strategy window, and explicit temporary or
permanent exclusions remain unchanged.

The regression coverage uses a stale zero-valued strategy payload plus a
canonical September value above the threshold. It verifies both the purchase
engine's `HISTORICAL_REVENUE_THRESHOLD` signal and the omission audit's blocking
behavior, while a high October current-month value alone does not qualify.
