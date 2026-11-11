# Shopling B-code lifecycle onboarding v1

## Objective

Bring every Product Launch item with a canonical B-code into the SEO listing
lifecycle ledger by reconciling it against the official Shopling product read
API. This workflow must never write to Shopling or a marketplace.

## Safety contract

- Match only Shopling `optPtnOptCd` to `product_launch_options.barcode`.
- Never treat Shopling `optBarcode` as a B-code.
- Keep the lifecycle ledger as the only new operating record; do not copy or
  overwrite Product Master or Product Launch truth.
- Start verified exposure at onboarding time, never from an inferred historic
  registration date.
- Require six distinct current Shopling goods keys mapped to the canonical
  profiles (`a` through `f`) before a product can enter normal verification.
- Put missing, partial, duplicated, conflicting, deleted-only, or market-proof
  deficient products into `EXCEPTION` with attempt count zero.
- Apply is insert-only and idempotent on lifecycle identity.

## Work plan

1. Extend the official read client to support registration-date product scans.
2. Add a deterministic B-code/catalog reconciliation planner with adversarial
   fixtures for numeric barcodes, shared B-codes, duplicate profiles, partial
   sets, and existing lifecycle rows.
3. Add an authenticated preview/apply server path using current Product Launch,
   pipeline, sales, and lifecycle evidence.
4. Wire the regression tests into lifecycle CI.
5. Run a small live read-only canary, then a full preview, and apply only after
   the preview proves fail-closed behavior and zero external writes.

## Progress

- [x] Read the Shopling API manual and confirmed the product read contract.
- [x] Audited the current production unit mismatch (product bundles versus
  Shopling goods codes).
- [x] Confirmed the current legacy path cannot discover products outside the
  Shopling registry/current six-code payload.
- [x] Implement and test the read-only catalog reconciliation.
- [x] Complete the official API canary and full catalog scan evidence.
- [ ] Apply verified internal lifecycle onboarding and independently read back.

## Verified evidence — 2026-10-31

- Official registration-date scan: 69 read-only ranges from 2010-01-01.
- Shopling goods keys: 10,565, exactly matching the latest account usage
  readback.
- Goods keys carrying a canonical `optPtnOptCd` B-code: 4,028.
- Current B-code goods-key states: selling `B` 3,950, sold out `C` 69,
  ended `E` 9. Deleted `Z` keys are not treated as current listings.
- Legacy official product-group names use `도매1번~도매4번` and
  `소매1번~소매2번`; these exact forms are normalized to the six lifecycle
  profiles. Other groups remain review-only/unresolved.
- Target lifecycle CI tests: 97 passed. Shopling read-client tests: 10 passed.
  Adversarial B-code planner tests cover numeric barcode confusion, mixed
  invalid partner codes, shared B-codes, duplicate profiles, partial sets,
  deleted-only keys, missing market evidence, and idempotent existing rows.
- ESLint, TypeScript, and the production Next.js build passed. The first local
  build attempt hit the Windows sandbox child-process restriction; the same
  build passed outside that restriction.
- Full-repository `npm test` is not a usable green baseline on this checkout:
  unrelated pre-existing Windows/environment tests fail. The feature-owned CI
  suites above pass independently.

## Integrity hardening — 2026-11-04

- A product now passes only when each Shopling `goods_key` matches the same
  canonical profile in the current catalog and the market pipeline ledger.
  Having the same six profile names in a different goods-key order is no longer
  accepted.
- Multiple `ptn_goods_cd` values on one current goods key are treated as an
  identity conflict even when their suffixes imply the same profile.
- Authenticated action `preview_shopling_bcode_integrity_audit` rechecks only
  products already present in the lifecycle ledger. It compares every persisted
  profile-to-goods-key pair against the current Shopling catalog and pipeline
  evidence, never writes lifecycle rows, and never writes Shopling or a market.
- The owner-provided Shopling screen on 2026-11-04 showed product DB usage
  `6,072 / 10,000`. With 12 safety codes reserved and six codes per SEO product,
  this is capacity for 652 complete product sets. The production gate still
  requires the same value in its authenticated internal readback; the screenshot
  alone does not bypass that gate.
- Next evidence: deploy this hardening, run the read-only integrity audit over
  the previously onboarded products, and independently inspect every reported
  mismatch before any external sold-out/delete canary.

### First Production audit and scope correction

- PR #1663 deployed the read-only integrity action. Its first Production run
  completed successfully with `externalMarketWrite=false`, but it audited 256
  persisted lifecycle products instead of the intended 127 onboarding products.
- The broad result was `0 pass / 256 review`; this is not accepted as product
  identity evidence. It mixed records from unrelated Shadow bootstrap paths
  into the legacy 71 plus B-code 56 onboarding population.
- The follow-up scope is derived from immutable lifecycle evidence source:
  `seo-listing-legacy-shadow-onboarding-v1` and
  `seo-listing-shopling-bcode-onboarding-v1` only. Missing or unknown source is
  excluded rather than guessed.
- The scoped audit must be redeployed and rerun before any mismatch is
  investigated or any external sold-out/delete canary is considered.
- The same Production readback still reported the older stale quota evidence
  `10,565 / 10,000` from 2026-10-31, so new registration remains blocked even
  though the owner reconfirmed `6,072 / 10,000` on the current Shopling screen
  on 2026-11-12. Refreshing both pages did not update the internal value.
- The root cause is host scoping: the current dashboard is served from
  `kt.shopling.co.kr`, while extension v0.6.8 injected the quota collector only
  on `a.shopling.co.kr`. Extension v0.6.9 adds `kt` permission only to a dedicated
  read-only quota collector; no title, market, lifecycle mutation, stock-out, or
  delete script is widened to the new host. The generated ZIP, its manifest,
  the real `6,072` parser fixture, 35 targeted tests, and TypeScript all pass.
  Deployment and an authenticated readback are still required before the
  registration gate can open.

### Production scope audit outcome

- The first source-filtered audit selected 185 products. Excluding row-level
  legacy quarantine evidence reduced the population to 179 products.
- A product-level legacy quarantine exclusion did not reduce the population
  further. The earlier `71 + 56 = 127` operating report therefore remains an
  unverified planning baseline, not the current lifecycle-ledger population.
- The latest Production read-only run audited 179 products: `0 pass / 179
  review`, with 176 matched to the current Shopling catalog and 3 unmatched.
- Review reasons were: 165 identity conflicts, 4 archived launch items, 3
  ambiguous profiles, 3 self-code conflicts, 2 current-catalog misses, 1
  missing launch-option B-code, and 1 incomplete market-pipeline identity.
- The audit must next expose source/state population counts and split the broad
  identity-conflict reason into machine-verifiable subreasons. No managed
  population count may be forced to 127 without that evidence.
- Every run remained read-only: `internalWriteApplied=false` and
  `externalMarketWrite=false`. External sold-out/delete/re-registration stays
  locked.

### Exact goods-key API audit outcome

- PR #1668 replaced the historical registration-date scan for integrity audits
  with the official `prod_id` exact lookup. The endpoint ignores the date range
  when exact Shopling goods keys are supplied, so audit work is now bounded to
  the persisted lifecycle identities.
- Production requested 652 exact goods keys and received 1,144 option rows;
  this replaced the former 9,874-row catalog scan. Invalid IDs fail before an
  external request, and IDs are sent in batches of 100.
- Of 179 persisted products, exactly 127 matched their current Shopling catalog
  identities and 52 did not. The unmatched group is 51 current-catalog misses
  plus one missing launch-option B-code. This independently explains the old
  `127` planning baseline without forcing the audit population to that number.
- The 127 current matches remain review-only: 72 identity conflicts, 26
  incomplete six-profile sets, 17 ambiguous profiles, five self-code conflicts,
  four incomplete market-pipeline identities, and three archived launch items.
- The 72 identity conflicts now expose overlapping machine-readable details:
  39 partner product code conflicts, 31 product-group profile conflicts, six
  launch-item mapping conflicts, and four invalid partner option codes.
- The next read-only diagnostic reports source, lifecycle state, and original
  review-reason population counts before representative products are inspected.
  No lifecycle correction or external Shopling write is authorized by this
  evidence.

### Representative evidence and legacy identity correction

- The authenticated diagnostic is bounded to 20 UUID launch items and joins
  lifecycle profiles, launch B-codes, exact Shopling option rows, and market
  ledger identities without writing any source.
- The scoped population is 129 B-code onboarding products plus 50 legacy
  products. The legacy group contains 28 protected, 19 live, and three
  exception products; all 129 B-code onboarding products were initially in
  exception state.
- Eleven reason-group representatives and all five self-code conflicts were
  independently inspected. AAA043 was genuinely incomplete, AAA192 reused a
  B-code found on another product, and AAA281 mixed managed B-code and blank
  partner-option rows. These remain fail-closed.
- AAA403 and AAA353 proved that the verified legacy `DM1_..DM4_` and
  `SM1_..SM2_` prefixes encode the six canonical profiles. Supporting those
  prefixes and their shared base removed 17 ambiguous-profile findings and 31
  product-group profile conflicts.
- All five leading-digit self-code findings had six exact profiles and one
  shared base after removing one channel digit, but no market-ledger rows.
  They are now correctly classified as incomplete market identity rather than
  passed. Empty bases and multiple bases remain blocked by regression tests.
- The latest Production read-only result is 48 pass and 131 review across 179
  persisted products. Within the 127 products currently matched to Shopling,
  48 pass and 79 still need review. Remaining groups are 51 catalog misses,
  41 identity conflicts, 26 incomplete six-profile sets, nine incomplete market
  identities, three archived launch items, and one missing launch-option B-code.
- Every diagnostic and audit reported `internalWriteApplied=false` and
  `externalMarketWrite=false`. The project remains in phase 4; no sold-out,
  delete, or re-registration canary is authorized yet.

### Receipt preview and fail-closed isolation evidence

- PR #1697 deployed canonical integrity receipts for the 48 passing products.
  Production returned 48/48 receipts, no holds, 48 unique fingerprints, and six
  exact bindings for every receipt. The deterministic receipt-set fingerprint is
  `sha256:2b79ea7ca5bca70ffd4d64120438ea734295adaf8c2c544b3a4e7bd9ab7ac203`.
- The same read-only plan identified nine exact internal market-ledger recovery
  candidates: AAA337, AAA143, AAA241, AAA333, AAA095, AAA428, AAA206, AAA365,
  and AAA390. No recovery row has been written.
- PR #1698 removed an over-strict requirement that an isolation candidate must
  have the canonical six-profile lifecycle shape. An irregular set is now
  eligible only when it contains persisted numeric goods keys, every key is
  absent from the current catalog, and no current launch item overlaps.
- Production correctly kept all 52 candidates on hold. Forty-nine products have
  six lifecycle rows but no persisted goods key, AAA026 and AAA336 still resolve
  to current goods keys, and AAA129 has no launch-option B-code. Treating the 49
  empty-key products as absent without another independent lookup would be an
  unsafe inference.

### Exact partner-product-code lookup (Production verified)

- The supplied official Shopling manual confirms that product gather accepts
  `key_search_tp=자사코드` and a comma-separated exact code list in `prod_id`;
  an exact code lookup ignores the date range.
- PR #1699 derives twelve bounded candidates from each
  launch item's persisted `self_code_base`: six current `a..f` suffix codes and
  six verified legacy `DM1_..DM4_` / `SM1_..SM2_` prefix codes. It never guesses
  from a B-code and never scans the full historical catalog.
- An empty-goods-key product becomes isolation-ready only when all twelve exact
  partner codes were requested successfully, no current matching catalog row
  exists, and no launch B-code overlaps another product. Missing self-code
  evidence, partial lookup coverage, or any current match remains on hold.
- Production requested 612 exact partner codes for the 51 empty-key products and
  returned zero current rows. Forty-nine products are now isolation-ready from
  independent partner-code absence evidence. AAA026 and AAA336 remain held
  because current goods keys still exist; AAA129 remains held because its launch
  option B-code is missing.
- The same Production audit preserved all 48 receipts, the receipt-set fingerprint,
  and all nine market-ledger recovery candidates. Every write flag remained false.
- Verification evidence: 136/136 lifecycle and Shopling read-client tests, changed-file
  ESLint, TypeScript, and the Production build with 124/124 static pages passed.
  Repository-wide lint still has unrelated pre-existing failures and was not
  used as evidence for this change.

### Reversible internal correction plan (Production applied and independently verified)

- The deployed plan persists the 48 canonical receipts in the existing immutable
  operation ledger and activates 49 separate isolation markers without deleting
  or overwriting lifecycle source rows.
- The stricter Production planner found no existing ledger row for any of the nine
  former recovery candidates. They are now correctly `0 ready / 9 held`; the
  correction will not guess or insert missing ledger rows.
- Apply is one database transaction. The route reruns the complete live audit and
  requires the approved SHA-256 plan fingerprint; any changed or missing ledger
  identity aborts the whole transaction. Independent readback checks receipts,
  active markers, every repaired goods key, and the correction run receipt.
- The latest read-only scope remains 48 receipts, 49 isolation markers, and zero
  ledger mutations. After the 2026-11-11 daily refresh confirmed a sale for
  AAA298, its six lifecycle rows moved from `LIVE` to the safer `PROTECTED`
  state. This single semantic change moved the receipt-set fingerprint to
  `sha256:2bea66a54daa68eb3ed681145a3a827229a7d571f1068a000a40dff03963ce88`
  and the correction-plan fingerprint to
  `sha256:66282b23493eaddfeb8799f8f767090d827fd7a2e20864df0d8f7fdd0b2fb50d`.
  Replacing only AAA298's six states with `LIVE` reconstructs the previously
  approved receipt-set and plan fingerprints exactly, proving that the target
  counts and identities did not otherwise drift.
- Rollback retains audit receipts and deactivates only the 49 markers from this
  exact plan. The production schema was applied on 2026-11-12 after PR #1704
  changed both RPCs to `SECURITY INVOKER`, removed deprecated `auth.role()`
  checks, and retained service-role-only execution.
- The owner explicitly approved plan fingerprint
  `sha256:66282b23493eaddfeb8799f8f767090d827fd7a2e20864df0d8f7fdd0b2fb50d`.
  Production applied it once at `2026-11-11T22:08:52.599Z`: 48 immutable audit
  receipts, 49 active isolation markers, zero market-ledger products, zero
  market-ledger bindings, and no external Shopling/market write.
- Independent database readback found exactly 49 active markers on 49 distinct
  launch items, all tied to the approved fingerprint; 48 distinct succeeded
  receipt events; one succeeded correction run; zero inactive or foreign-plan
  markers; and zero market-ledger rows updated at the correction timestamp.
  The post-apply Production API audit independently reported 49 active isolated
  products and reduced the active audit population from 179 to 130 products,
  while preserving the same 48/48 receipt set. It proposed zero additional
  isolation markers and kept all external-write flags false.
- Next gate: refresh the still-stale authenticated Shopling capacity readback,
  identify one real 60-day zero-sale Canary candidate, and request separate
  approval before any external stock-out or deletion.

