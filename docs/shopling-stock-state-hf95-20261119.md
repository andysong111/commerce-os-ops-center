# Shopling stock-state HF95 — flattened service worker recovery

Date: 2026-11-19

## Incident

- Commerce OS showed extension v0.6.56 connected, but a fresh `BAB3-1` on-sale command stopped with `SHOPLING_STOCK_EXTENSION_NOT_IDLE`.
- The run ended as `성공 0/1 · 실패·확인 필요 0 · 미시작 1`. This proves no Shopling transmission was started, so the stopped session must not be retried as though it had submitted.
- The connected label came from the content-script READY announcement. It did not prove that the Manifest V3 service worker had initialized or could answer the dedicated idle request.

## Confirmed root cause

- The production v0.6.54 ZIP was loaded in a clean real Chrome profile. READY and STATUS both arrived, and `STOCK_SYNC_GET_STATUS` returned normally.
- The production v0.6.56 ZIP was loaded through the same real-Chrome fixture. READY arrived, but STATUS never arrived and every runtime message to `background-v100.js` timed out.
- All imported files existed in the v0.6.56 ZIP. The failure was therefore not a missing package file.
- `background-v100.js` added another wrapper import over the already deep proven chain. That extra `importScripts("background-v099.js")` layer prevented the service worker from completing initialization in real Chrome.

## HF95 contract

- v0.6.57 builds `background-v101.js` by appending the HF94 minimal idle listener directly to the proven `background-v099.js` entry.
- The packaged worker has exactly one root `importScripts` call and contains no `background-v099.js` wrapper import.
- The idle bridge keeps the HF94 request and result contract, but adds a two-second bounded callback timeout. A dead worker now produces `HF95_IDLE_STATUS_RESPONSE_TIMEOUT` instead of silent READY-only waiting.
- Commerce OS still starts only after `statusProbeOk: true` and `idleConfirmed: true`.
- One B-code per START, exact popup/tab/frame ownership, original blue-submit receipt, immutable successes, and fail-closed retry rules are unchanged.

## Verification receipts

- Local package verify: version `0.6.57`, ZIP 273,793 bytes, background SHA-256 `7f90fbcb48203095bc96cc85f94f423739071fbf00698583be608c8d6d172833`, idle bridge SHA-256 `e06c8ee42d4f44ce11d3e96cd240943ffa4340d21c165d9408934c1df6f75604`.
- Real Chrome package test: `statusProbeOk: true`, `idleConfirmed: true`, `stockIdleProbe: HF95_FLAT_BACKGROUND_IDLE_STATUS`, extension/service-worker version `0.6.57`.
- The Chrome test posted only the page PING. It observed no START message and performed no external Shopling write.
- Permanent regression covers the flattened import guard, explicit timeout failure, successful idle receipt, current UI gate, and real extension browser check wired into CI.
- CI-targeted stock-state test files: 58/58 passed. TypeScript, targeted ESLint, and the Next.js production build with 125/125 generated pages passed.

## Live canary after deployment

1. Install the v0.6.57 HF95 ZIP and hard-refresh the stock-control page until it shows connected v0.6.57.
2. Do not press retry on the old `미시작 1` session. Start one fresh B-code only.
3. Confirm the exact Shopling original submit receipt and Commerce OS `전송 접수 완료 1/1`.
4. Only after that receipt may the remaining B-codes run serially. If an exact popup or submit receipt exists but the browser channel detaches, reconcile that popup before any retry.

The local non-writing test proves the extension handshake and idle barrier. It does not claim that a live marketplace write has completed; that final canary remains the owner's action after production deployment.
