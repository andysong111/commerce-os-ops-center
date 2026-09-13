# Legacy SEO recovery and title diversity — 2026-09-14

## Restart here

Repository: `andysong111/commerce-os-ops-center`. PR #1186, branch `fix/legacy-seo-recovery-20260914`.
This replaces the reviewed core fix from unmerged draft #1154 (head `23be1249163ed7d8868d240afcce4f44a0e528be`), ported onto newer main. Do not independently merge that obsolete draft after this release.

Check PR #1186 for the latest exact-head CI, merge SHA, canonical Vercel production verification and any live canary result. At this document's authoring time final-head CI/deployment and live generation remain pending. Editing code or passing fixture tests is not evidence that all production failures have recovered.

## Preserve

Do not change existing Shopling goods, options, prices, stock or completed registration RUNs. No database schema or authentication changes. OpenAI support contact is explicitly last priority and is not part of this development.

## Confirmed production diagnosis (read-only)

- Archived ready/success: 83 RUNs, 82 distinct model numbers.
- Active failed/filter_keywords/registration-idle: 43 RUNs, 42 distinct models.
- Active failed/compose_final/registration-idle: 1 RUN, AAA362.
- No queued/running SEO RUNs at the check.
- Failed registration job/request identifiers are empty strings, not necessarily SQL NULL.
- AAA027 has two failed RUNs for one launch item. Never blindly retry both.

All 43 filter-stage failures have 500 discovered candidates and at least three missing primary identity seeds; 42 have zero safety-passing scored candidates. High-volume unrelated SearchAd terms displaced the actual product's seeds before the cap. Recall loss is not a legitimate semantic rejection.

AAA362 instead has insufficient allowed material after keyword filtering. This release does not restore prohibited terms or claim that this distinct case is solved.

## Implemented recovery

1. Preserve core/primary identity seeds before API search-seed truncation and the 500-candidate cap.
2. Prioritize identity evidence when reading old checkpoints.
3. Recover omitted or technically unscored terms only. Genuine evaluated rejections, including zero scores, are not repeatedly rescored until they pass.
4. Maximum 48 terms per attempt, two durable attempts, reserved in the checkpoint before paid scoring.
5. Yield through ordinary demand/accuracy and prohibited-keyword gates. Do not fabricate search-volume evidence or lower gates.
6. Prefer completed semantic evaluations over unavailable timeout/missing-response placeholders when merging.

## Implemented title diversity correction

An additional real regression was reproduced in the existing title pipeline: later V7/V8/V9 portfolio rebalancing could undo the historical non-reuse achieved by the selected safe-composer attempt. The rich-material two-run fixture reused 22 previous full titles before repair; guarding V9 alone still reused 17. Preserve historical freshness through all three layers, not just the last one.

History remains a preference, not a ban on every previously used word. Valid core keywords may be reused, sparse material may retain an equal full-title reuse level, and no-history behavior is unchanged. Never add unsupported meanings, bypass prohibited terms, or force absolute uniqueness when valid material is insufficient. The existing rich-material assertion of zero exact reuse is retained and passes after the correction.

No new search-keyword ordering feature, failure-status UI, or retry-policy API has been integrated in this release.

## Verification evidence

- Read-only baseline comparison workflow 34768810643 executed the same ledger suite on baseline `ad6ec96eb48142f2c990f9d53e0d7688faf396b7` and recovery head. Both had the same five pre-existing failures.
- Four obsolete syntax assertions still demanded retired V6 bulk-generation or older synthetic-keyword internals. They now assert the actual V8 title-first/search-complement contract while retaining byte limits, blocked-keyword gates, category thresholds, 29-title/10-search-term counts and backward ledger metadata compatibility.
- The fifth failure was the actual historical title regression. Its zero-reuse assertion was NOT relaxed.
- Workflow 34769183537 passed the whole updated ledger suite, bounded recovery/discovery suites and changed-source/test lint, then persisted the exact tested source/test changes as commit `566ce3306e20f27ec0864244d9527c99ac8c90ee`.
- Permanent tests are in Legacy SEO Registration CI and SEO Title Inventory Ledger CI. Additional cases cover missing/provider-failed evidence, real rejection versus technical failure, durable attempt limits, valid word reuse, sparse/equal-history fallback, no-history behavior, normalized text and actual synthetic recovery output being restricted to the Step 4 allowlist.
- Authoring-only workflows and unused draft files are removed from the release tree. Final latest-head CI/build must still pass before merge.

## Controlled live verification next

Only after exact-head CI/build and canonical production deployment are verified, use at most two distinct failed, unarchived, registration-idle RUNs with empty registration identifiers. Candidate models checked read-only are AAA106 and AAA109. Use the existing authorized generation retry API or operator control; retain checkpoints and recovery budgets.

Do not call enqueue, register, register_all, Shopling writes, or direct SQL status resets as a generation-only test. Never retry an uncertain POST response. Re-read target stages/errors and independently verify the archived success count is still 83. If authentication is unavailable, stop and request the smallest existing operator action rather than modifying access controls.

A live ready result establishes generation only, not Shopling or marketplace registration. Report actual remaining failures instead of claiming all 44 historical RUNs are repaired.
