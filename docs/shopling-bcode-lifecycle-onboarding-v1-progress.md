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

