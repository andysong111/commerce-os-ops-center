# Shopling stock-state HF94 — dedicated idle receipt

Date: 2026-11-18

## Incident

- Production extension v0.6.55 was connected, but a three-B-code run stopped before the first B-code with `SHOPLING_STOCK_EXTENSION_NOT_IDLE`.
- Commerce OS showed `0/3`, `실패 0`, `미시작 3`. No Shopling transmission had started, so retrying was not required and there was no duplicate-send risk.
- The page received the extension READY announcement, but the legacy status bridge silently returned when the background status response was missing. READY therefore proved only that the content script existed, not that the extension was safe to start.

## HF94 contract

- Extension v0.6.56 adds `STOCK_SYNC_GET_IDLE_STATUS_HF94`, a dedicated background request that reads only the active owner and last terminal receipt.
- The reply is deliberately small: exact running owner identity, `idleConfirmed`, and whether an exact same-job terminal lock was recovered.
- A RUNNING lock is cleared only when a persisted terminal receipt belongs to the same job and finished after that job started. Unrelated or live locks remain untouched.
- The page starts a B-code only after `statusProbeOk: true` and `idleConfirmed: true`. READY, legacy `active: null`, missing responses, and explicit probe failures all fail closed.
- One B-code at a time, exact popup/tab/frame ownership, and original Shopling submit receipt rules remain unchanged.

## Verification

- Dedicated probe VM fixtures cover idle, live RUNNING, exact terminal recovery, and a different-job terminal receipt.
- The ready barrier rejects READY-only, legacy active-null, explicit probe failures, and non-idle receipts.
- All 57 stock-state CI test files pass after the current package/gate expectations were advanced to HF94.
- TypeScript typecheck and targeted ESLint pass. Production build and packaged ZIP verification must pass before deployment.

## Live validation after deployment

1. Install the v0.6.56 HF94 ZIP and refresh the Commerce OS stock-control page until it shows connected v0.6.56.
2. Do not retry the old stopped three-item session. Start one B-code as a fresh canary.
3. Confirm the exact B-code reaches Shopling transmission receipt and Commerce OS records `1/1`.
4. Only then run the remaining two B-codes. Never advance while an exact popup or original submit receipt is unresolved.
