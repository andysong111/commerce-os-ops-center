# Shopling stock sync HF45 — BBD3-1 no-resend terminal recovery

## Incident

- The single-run BBD3-1 OPTION/SOLD_OUT job reached the exact Shopling footer `상품옵션 수정 전송이 완료되었습니다.`.
- The result callback did not persist into the Commerce OS ledger, and neither a page reload nor a fresh authenticated stock-control tab replayed a saved extension result.
- BBD3-1 must not be submitted to Shopling again.

## Change

- Extend the audited known-terminal recovery allowlist from BBB4-3 SINGLE/SOLD_OUT to the exact BBD3-1 OPTION/SOLD_OUT incident.
- Require the current authoritative row and UI payload to match barcode, product kind, desired status, desired-since timestamp, known inventory zero, and runnable unblocked state.
- Persist the exact option-completion footer as SUCCEEDED evidence with an incident-scoped idempotency key, then fresh-read the ledger and require the row to disappear from the runnable queue.
- The recovery path never emits a Shopling start message.

## Live acceptance

1. Deploy HF45.
2. Open the authenticated stock-control queue.
3. Use `완료 결과 복구` on BBD3-1; do not use `이 건만 처리`.
4. Confirm the notice says the result was recovered without Shopling resend and BBD3-1 is absent from the queue.
5. Continue one job at a time and stop on FAILED/UNCERTAIN.
