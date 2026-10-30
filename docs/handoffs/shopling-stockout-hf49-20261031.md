# Shopling stock-state HF49 handoff — 2026-10-31

## Live incident

- B-code: `BDE7-3`, OPTION → SOLD_OUT.
- HF48 v0.6.13 found GOODSKEY `116618`, `116619`, `116620`, `116621`, `116623`, `116624`.
- All six option API reads returned `NOOP_ALREADY_DESIRED`; no option mutation was performed.
- A21 persisted `SEARCH_SUBMITTED`, but did not persist `POPUP_OPENING`.
- HF47's safety gate blocked `상품 수정전송`; no popup or A21 transmission was created.
- The operational queue stopped at FAILED as required. Do not retry with HF48.

## Confirmed cause

HF48 added `stockProductKindHf48` to the original OPTION and SINGLE assignment adapters. The live OPTION flow no longer uses the original one-item adapter after the A21 search reload: `background-v071.js` owns the current comma-batch dispatch and rebuilt `A21_LIST_ASSIGNMENT` without the owner field.

Direct evidence:

- The first pre-navigation assignment from `background-v053.js` carried `OPTION`, so `SEARCH_SUBMITTED` was acknowledged and persisted.
- The post-search assignment from `background-v071.js` had no owner field.
- The new content-script instance therefore emitted `POPUP_OPENING` with an empty owner.
- Both OPTION and SINGLE canonical listeners accepted an empty owner, reopening the same response race that HF48 intended to close.
- Chrome extension storage remained at `a21CanonicalStage: "SEARCH_SUBMITTED"`, proving that the OPTION adapter never persisted `POPUP_OPENING` before the worker failed closed.

## HF49 behavior

- Package version: v0.6.14 HF49.
- The current OPTION batch dispatcher always assigns `stockProductKindHf48: "OPTION"`.
- The current SINGLE batch dispatcher always assigns `stockProductKindHf48: "SINGLE"`.
- OPTION and SINGLE canonical listeners now require an exact owner match. Empty ownership has zero eligible acknowledgers and remains fail-closed.
- SINGLE split handling also requires exact SINGLE ownership.
- The popup/result `window.name` marker preserves the owner so later documents cannot lose routing identity.
- The minimum runnable stock extension is now v0.6.14; HF48 is rejected by both execution surfaces.

## Permanent regression coverage

- Test: `tests/shoplingStockStateHf49.test.mjs`.
- CI: `.github/workflows/shopling-stock-state-sync-ci.yml`, step `Regression - HF49 exact owner across A21 page reload`.
- The test reproduces the real BDE7-3 sequence: first assignment, search navigation, post-reload batch assignment, then `POPUP_OPENING`.
- It proves exactly one OPTION adapter responds, missing ownership produces zero responders, SINGLE keeps its own owner, and popup/result markers retain ownership.

## Next safe action

1. Merge and deploy HF49.
2. Install exactly v0.6.14 and disable v0.6.13.
3. Retry `BDE7-3` once.
4. Stop immediately on FAILED or UNCERTAIN. Never auto-retry.
5. Continue one B-code at a time only after a confirmed success.
6. Keep `BCG5-2`, `BCG5-3`, and blocked `BCC6-2` excluded.
7. Apply ON_SALE only to `BCC5-1` and `BCC5-2`; all other approved queue rows remain SOLD_OUT.

## What proves this is working correctly?

- HF49 regression: 3/3 passed.
- Shopling stock-state regression suite: 67/67 passed.
- Inventory stock-control JavaScript suite: 94/94 passed.
- TypeScript and changed-file ESLint: passed.
- A production build and live Shopling retry are still required before operational completion.
