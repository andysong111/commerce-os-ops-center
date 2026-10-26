# Warehouse-map direct stock status — 2026-10-26

## Authoritative behavior

- A warehouse operator selects an occupied physical slot and chooses `판매중 전환` or `품절 처리` in the warehouse map.
- The warehouse server re-reads live slot ownership and canonical Product Master B-code. Browser-supplied B-code changes are not trusted.
- A dedicated `WAREHOUSE_STOCK_COMMAND_SECRET` (32+ random characters) must be identical in Warehouse and Ops production environments. Do not reuse Product Master, Storage, or general integration secrets.
- The warehouse server signs a five-minute proof bound to request UUID, SKU, selected slot, canonical B-code, desired state, and time. Ops accepts it only at `/api/integrations/warehouse-stock-status`.
- Ops resolves the exact Product Master identity, stores the existing stock operation, and returns exactly one extension job. Warehouse signs that exact job again for one hour; option API calls and terminal evidence must carry the matching token.
- `ON_SALE` records the existing manual status-only event and does not change inventory quantity. `SOLD_OUT` records the existing zero-inventory baseline. Prices, locations, orders, and payments are outside this workflow.
- Shopling execution remains in extension v0.6.0 HF32 and preserves HF31 all-date, exact B-code, bounded execution, and final readback guards.

## Verification recorded before deployment

- Warehouse: 225/225 Node tests, syntax/assets check, build, and 21/21 real Chromium HTTP checks passed, including exact-request recovery after a lost prepare response.
- Ops: warehouse/HF31 launch regression 13/13 and broader affected stock regression 48/48 passed; changed-file ESLint passed.
- The real Next development route `/api/shopling-stock-state-sync/download-hf32?verify=1` returned HTTP 200, v0.6.0, signed token required, and HF31 guard preservation.
- Broad repository tests/typecheck are not a green signal: the existing Windows checkout has unrelated case-colliding tests, URL-path temp failures, and pre-existing type errors.

## Remaining release boundary

1. Set the same new secret in both Vercel projects without exposing it.
2. Deploy both exact feature heads and confirm their production SHAs.
3. Download and load HF32 once in the operator Chrome profile.
4. With owner action-time confirmation, run one known low-risk B-code canary and verify Ops event persistence plus final Shopling readback.
5. Do not claim production completion until all four are recorded. No database migration is required.
