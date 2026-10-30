# Shopling stock-state HF47 handoff — 2026-10-30

## Live incident

- B-code: `BDE7-3`, OPTION → SOLD_OUT.
- A6 exact lookup returned GOODSKEY `116618`, `116619`, `116620`, `116621`, `116623`, `116624`.
- All six option-status API checks returned `NOOP_ALREADY_DESIRED`; no option mutation was required.
- The A21 list worker selected the six exact result rows and opened the modify-send popup, but the stock ledger remained at `A21_LIST / SEARCH_SUBMITTED`.
- The popup never received a stock assignment, no target status was selected, and no A21 transmission was submitted. The popup was closed and automatic queue processing was stopped.

## Confirmed cause

`content-a21-canonical-v014.js` discarded the response from its `A21_STAGE / POPUP_OPENING` message. When that message was not acknowledged, the worker still clicked `상품 수정전송`. The real popup then failed its exact stock claim because `background-v050.js` correctly permits `A21_LIST → A21_POPUP` only after the persisted canonical stage is `POPUP_OPENING`.

## HF47 behavior

- Package version: v0.6.12 HF47.
- The canonical worker retries only the internal `POPUP_OPENING` ledger message twice.
- It clicks `상품 수정전송` only after `{ ok: true, accepted: true }` is returned.
- Missing or negative acknowledgment fails closed with `A21_POPUP_OPENING_STAGE_NOT_ACKNOWLEDGED_HF47`; no popup click occurs.
- A persisted OPTION job left at `A21_LIST / SEARCH_SUBMITTED` for 30 seconds is terminated on extension startup. With no popup it is `FAILED`; with a popup still present it is `UNCERTAIN`.
- Stale recovery repeats neither the already verified option API mutation nor A21 transmission and never authorizes an automatic retry.

## Verification

- Permanent regression: `tests/shoplingStockStateHf47.test.mjs`.
- BDE7-3 six-GOODSKEY fixture proves the modify-send click count stays zero when the stage acknowledgment is absent.
- Normal-path fixture proves an acknowledged stage still permits progress and that retry scope is only the internal ledger message.
- Stale-state fixture proves the persisted BDE7-3 job becomes `FAILED` with no mutation or transmission by recovery and, when no popup exists, `priorA21TransmissionSubmitted=false`.
- Shopling stock-state focused suite: 73/73 passed.
- TypeScript: passed.
- Changed-file ESLint: passed.
- Next.js production build with Webpack: passed.
- Built HTTP verification returned v0.6.12, a 149,238-byte ZIP, acknowledgment-required=true, click-without-ack=false, and no recovery mutation/transmission.

## Next safe action

1. Merge and deploy HF47.
2. Install/reload the exact v0.6.12 extension and disable v0.6.11.
3. Confirm the stale BDE7-3 lane becomes FAILED without a new Shopling popup or transmission.
4. Inspect the released OPS queue. Do not auto-retry BDE7-3 until the failure is diagnosed and the operator explicitly resumes it.
5. Continue one job at a time. Keep `BCG5-2`, `BCG5-3`, and blocked `BCC6-2` out of automatic retry.
