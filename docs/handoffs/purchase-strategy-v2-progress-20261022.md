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
- New-product protection guarantees eligibility and the 1.5-month base floor;
  it never caps a rising or hero product. Protected rising products keep their
  2/3/4-month tier, and protected hero products keep the 5-6-month manual review.
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

## Hardening result

- Policy version `commerce-os-purchase-strategy-policy-v1.1.0` fixes the
  new-product floor/cap ambiguity.
- Dedicated regression coverage now runs in Purchase Cycle Preflight CI, so a
  later change cannot silently reset protected rising or hero products to 1.5
  months.
- Draft regeneration now stores the full owner-adjustment lineage (one-cycle
  exclusions and pinned quantities) on every RESERVED line and merges it into
  every later recalculation. A later inline recalculation therefore cannot
  re-add an excluded SKU or drop a pinned quantity such as `BGG1-1:3000`.

## Recommendation-preservation correction — 2026-10-23

- A missing transient `발주 추천` flag no longer deletes an existing Draft
  line. Automatic removal now requires an explicit one-Draft exclusion,
  permanent discontinuation, or verified stock plus open commitments that
  cover a positive demand target.
- One immediate predecessor Draft is included in the replacement audit so a
  line dropped by the previous faulty recalculation can be reconsidered. The
  recovery does not walk older history and does not restore persisted owner
  exclusions.
- Persisted quantity pins can now be explicitly released. The inline editor
  sends the complete desired pin set, so releasing `BGG1-1:3000` cannot be
  undone by the server merging the old pin back in.
- Legacy Drafts now read quantity pins from the commitment payload as well as
  later quantity-correction overlays, so a pin already baked into the visible
  Draft quantity still appears as releasable.
- Releasing a pin means returning that B-code to the ordinary purchase policy.
  If the engine recommends it, the automatic quantity replaces the pin. If the
  engine does not recommend it, that line leaves this Draft with the audited
  reason `OPERATOR_QUANTITY_OVERRIDE_RELEASED_TO_POLICY`. The release is not a
  permanent exclusion, so a later monthly calculation may recommend it again.

## Full-scope replacement correction — 2026-10-25

- A replacement Draft may remove an old automatic line that is absent from the
  latest priority rows only when the priority snapshot is `READY`, covers the
  full managed active SKU count, has no source blocker, and has no blocking
  omission. The audit records `LATEST_ACTIVE_SCOPE_ABSENT` for that removal.
- A partial or blocked priority read still preserves the old line and blocks
  Draft saving for review. Missing data can therefore never silently delete a
  purchase line.
- The preflight UI now uses the same replacement-review gate as the server. It
  cannot display “ready” and then reject the same Draft during save.
