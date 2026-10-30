# Shopling stock-state HF48 handoff — 2026-10-30

## Live incident

- B-code: `BDE7-3`, OPTION → SOLD_OUT.
- HF47 found GOODSKEY `116618`, `116619`, `116620`, `116621`, `116623`, `116624` in the exact A6 result.
- All six option API checks were `NOOP_ALREADY_DESIRED`; no option mutation was needed.
- The A21 worker reached `SEARCH_SUBMITTED`, then failed closed with `A21_POPUP_OPENING_STAGE_NOT_ACKNOWLEDGED_HF47`.
- The worker did not click `상품 수정전송`; no Shopling transmission occurred and the queue stayed stopped.

## Confirmed cause

The canonical A21 worker broadcasts `A21_STAGE` to every extension runtime listener. The OPTION adapter in `background-v053.js` persisted the stage and returned `{ ok: true, accepted: true }`, while the unrelated SINGLE adapter in `background-v056.js` also answered the same OPTION message with `{ ok: false, ignored: true }`. Chrome may deliver the SINGLE response first, so HF47 correctly failed closed even though the OPTION adapter was healthy. The SINGLE success path also returned `{ ok: true }` without the explicit `accepted` contract required by HF47.

## HF48 behavior

- Package version: v0.6.13 HF48.
- The worker records the assigned product kind and adds `stockProductKindHf48` to canonical stage, failure, success, and split messages.
- The OPTION adapter ignores messages explicitly owned by SINGLE.
- The SINGLE adapter ignores stage/failure messages explicitly owned by OPTION.
- SINGLE `SEARCH_SUBMITTED` and `POPUP_OPENING` now return `{ ok: true, accepted: true }` after persistence.
- HF47's fail-closed rule remains: no acknowledged `POPUP_OPENING`, no `상품 수정전송` click.
- The existing A21 split limit remains `batchLimit: 200`.

## What proves this is working correctly?

- `tests/shoplingStockStateHf48.test.mjs` reproduces the BDE7-3 OPTION/SINGLE listener race and proves exactly the OPTION adapter acknowledges it.
- The same regression proves the SINGLE path uses the explicit persisted acknowledgment contract and preserves the 200-row split guard.
- Shopling stock-state suite: 64/64 passed.
- Inventory/queue integration suite: 94/94 passed.
- TypeScript and changed-file ESLint: passed.
- Next.js production build with Webpack: passed; 124 static pages generated.
- The built HTTP verification endpoint returned v0.6.13, base v0.6.12, a 149,396-byte ZIP, per-kind routing enabled, acknowledgment-required=true, and click-without-ack=false.
- The generated ZIP was unpacked and its manifest verified as Manifest V3 / v0.6.13.

## Artifact

- ZIP: `artifacts/shopling-hf48/commerce-os-shopling-stock-state-v0.6.13-hf48.zip`
- Unpacked extension: `artifacts/shopling-hf48/commerce-os-shopling-stock-state-v0.6.13-hf48`

## Next safe action

1. Merge and deploy HF48.
2. Install/reload exactly v0.6.13 and disable v0.6.12.
3. Retry `BDE7-3` once, observe the persisted `POPUP_OPENING` acknowledgment, and stop immediately on FAILED or UNCERTAIN.
4. Continue one job at a time. Keep `BCG5-2`, `BCG5-3`, and blocked `BCC6-2` excluded.
5. Apply ON_SALE only to `BCC5-1` and `BCC5-2`; all other approved queue rows remain SOLD_OUT.
