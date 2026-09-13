# Legacy SEO recovery handoff — 2026-09-14

## Scope and source of truth

This work continues the legacy-product SEO cloud. Preserve completed registrations and all existing Shopling goods, options, prices and inventory. Do not treat chat interruption as loss of deployed code or database state.

Branch: `fix/legacy-seo-recovery-20260914`. This branch ports the reviewed source changes from draft PR #1154, exact head `23be1249163ed7d8868d240afcce4f44a0e528be`, onto the newer main branch. Do not merge the old draft independently after this replacement.

Release truth must be read from this branch's PR, its exact-head CI, the main merge SHA, and Vercel's canonical production alias. At the time this document was authored, final PR verification and production deployment had not yet been completed. A test pass is not evidence of live generation or Shopling registration.

## Read-only production diagnosis

The operator-authorized Supabase read of `legacy_seo_run_jobs` found:

- Archived ready/success: 83 RUNs, 82 distinct model numbers.
- Active failed/filter_keywords/idle: 43 RUNs, 42 distinct model numbers.
- Active failed/compose_final/idle: 1 RUN, model AAA362.
- No queued/running SEO RUNs at that check.
- Failed records have empty registration job/request identifiers, not necessarily SQL NULL.
- AAA027 has two failed RUNs for the same launch item. Do not blindly retry both.

Every one of the 43 filter failures had a 500-candidate discovery checkpoint and omitted at least 3 primary seeds; 42 had zero safety-passing scored candidates. High-volume unrelated SearchAd terms could fill the cap before the actual product's core terms. Recall loss is distinct from a valid semantic rejection.

AAA362 is a separate material-shortage case after keyword filtering. Its checkpoint has one allowed keyword and multiple removed terms. This patch does not restore those terms, weaken the filter, or claim it can produce valid complete output for that case.

## Implemented core changes

1. Reserve core/primary identity seeds before broader SearchAd discovery and before the 500-candidate cap.
2. Prioritize identity evidence when reading an old discovery checkpoint.
3. Recover only omitted or technically unscored candidates; do not repeatedly score genuine semantic rejections until they happen to pass.
4. Maximum 48 terms per recovery attempt and two durable attempts. Reserve the attempt in the checkpoint before paid scoring. Resume through the ordinary demand/accuracy and prohibited-keyword gates.
5. Prefer completed semantic evaluations, including real zero-score rejections, over timeout/missing-response placeholders when merging scoring results.
6. Keep focused recovery and actual-discovery behavior regressions in Legacy SEO Registration CI.

No schema, authorization, Shopling registration, pricing, inventory, or UI code is changed by this release. No live generation retry or product registration was executed while authoring these changes.

## Regression evidence and limits

The imported 16 focused recovery/merge tests passed in the isolated authoring workflow. That initial workflow later failed to push a workflow-file change with a contents-only token; it was replaced with a source-only import. Permanent CI was subsequently updated through the authorized GitHub connector. The one-shot importer and unused integration drafts have been removed from the final branch tree.

The additional actual-discovery regression executes production source with mocked external providers. It covers a 600-row unrelated high-volume response, preservation of primary seeds within the first API seed window and 500-candidate result, real demand-stat preservation, explicit provider failures, and empty identity failing before any network request. Final exact-head CI results belong in the PR and must be checked before merge.

## Existing behavior retained

Completed RUN archive is separate from original-product availability. An intentional later selection can create a fresh RUN; archive alone does not trigger another bulk registration wave. Historical full titles are not a blacklist of all previously used words. Existing title variation reuses valid core keywords and minimizes identical wording where material permits. This patch does not add a new search-keyword ordering algorithm or change duplicate-title acceptance rules.

## Next controlled verification

After exact-head tests/build and canonical production deployment are verified, select at most two distinct currently failed, unarchived, registration-idle RUNs with empty registration identifiers. Use the existing authenticated SEO retry API or operator control; retain the checkpoint. Do not call enqueue, register, register_all, or any Shopling write as a generation-only test. Re-read the exact target statuses/checkpoints and independently verify the archived success count is unchanged.

If generation remains blocked, report the actual final stage and error. Do not equate code deployment with recovery of all 44 old failures. Do not reset the durable recovery budget, revive both AAA027 failures, or send completed runs again.

OpenAI support contact is not part of this development task; the operator explicitly placed it last in priority.
