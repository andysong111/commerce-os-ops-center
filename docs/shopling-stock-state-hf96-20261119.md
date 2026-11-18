# Shopling stock-state HF96 handoff — 2026-11-19

## Incident

- A serialized four-B-code run completed three sold-out products, but `BCC5-1` on-sale stopped before the blue Shopling submit.
- The durable ledger recorded `HF92_EXACT_POPUP_OWNER_CHANGED` at `A21_LIST` after all 12 `BCC5-1` goods keys were validated as already `ON_SALE` through the API.
- History showed the same assignment was prepared twice. The second preparation re-armed popup ownership and added the already-open exact popup to `baselineTabIds`, so the final HF92 guard treated the valid popup as foreign.
- Mixed sold-out/on-sale input was not the cause. Dispatch concurrency remained one B-code at a time.

## HF96 change

- Extension version: `0.6.58`.
- Download route: `/api/shopling-stock-state-sync/download-hf96`.
- The final blue-submit boundary still uses the canonical HF84 receipt key.
- A re-armed popup is accepted only when the fresh, pre-submit HF90 receipt proves the same job, execution, product kind, goods-key batch, A21 list tab, exact popup tab, opener tab and assignment owner.
- A missing, stale or mismatched proof fails closed before any external submit.
- The serial one-B-code policy and no-reclick-after-receipt policy are unchanged.

## Verification receipt

- Real incident regression fixture: `BCC5-1`, `ON_SALE`, option transmission, 12 goods keys (`120461`–`120466`, `122438`, `122440`, `122442`–`122445`).
- Same-assignment re-arm: one original Shopling commit, terminal code `HF96_REARM_RECONCILED_BLUE_SUBMIT_COMMITTED`.
- Missing HF90 receipt: zero commits.
- Different popup receipt: zero commits.
- Changed goods-key batch: zero commits.
- Local Next route verification: HTTP 200, ZIP 274,664 bytes, patched background SHA-256 `de1cd3321020ad1f125403882886af90c8d40b49c0fc4500b3fc14f4bc567e7a`, unchanged flattened worker SHA-256 `7f90fbcb48203095bc96cc85f94f423739071fbf00698583be608c8d6d172833`.

## Operator canary

1. Install v0.6.58 and hard-refresh Commerce OS until the connected version reads `v0.6.58`.
2. Confirm the Shopling login session is active.
3. Run one previously failed B-code only. Do not retry if an exact popup or original submit receipt already exists.
4. Confirm the Shopling original transmission receipt and Commerce OS `1/1` before expanding to a multi-B-code run.
