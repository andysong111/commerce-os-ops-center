# Purchase strategy v2 progress — 2026-10-22

## Owner objective

Rebuild the monthly purchase recommendation so the owner can review a broad,
explainable candidate list, manually adjust it, and only then create the
internal Draft. This work must not place a 1688 order or make a payment.

## Accepted policy

- Start with a configurable monthly revenue threshold of KRW 40,000.
- Show how many of the last 12 completed calendar months met the threshold.
- Prioritize consistency, recent rising demand, and high selling-price products
  that also sell consistently.
- Reduce priority for high claim rates.
- Base stock cover is 1.5 months; rising products may target 2, 3, or 4 months.
- Strong core products may be shown as candidates for 5–6 months, but automatic
  calculation stays capped at 4 months until the owner manually approves more.
- New products are protected from automatic discontinuation for 365 days, but a
  protected item with no recent demand receives a zero reorder recommendation.
- Confirmed inventory and open/incoming commitments are subtracted from demand.
- Permanent purchase exclusion is B-code specific, reversible, and separately
  audited from a one-Draft exclusion.

## Implementation plan

1. Add a pure, versioned policy calculator and boundary regression tests.
2. Add append-only policy and B-code reorder-state persistence using the
   existing operation ledger, plus a guarded API.
3. Feed policy, completed calendar-month sales, launch age, claims, inventory,
   and commitments into the one canonical purchase path.
4. Expose the threshold, evidence badges, target cover, and permanent exclusion
   controls on the purchase preflight screen.
5. Pin the policy snapshot/fingerprint into the preview and saved Draft flow.
6. Run focused tests, typecheck, lint, build, browser/API checks, and persisted
   readback checks before making the recalculation action available.

## Current boundary

Implementation and reversible internal preview work are authorized. Actual
supplier order, checkout, payment, or supplier contact remain outside scope.
