# Sales event candidate refresh / 2026-09-14

## Scope and observed cause
The latest real candidate was analyzed at 2026-09-07T14:32:29.432Z, request 95c910a4-88ff-4c05-b181-9d57ab497bc0. The normal start route returned READY_CANARY/READY_FULL instead of permitting an explicit new collection. This change prepares the October 1 purchase-cycle check; it does not approve or execute purchases.

## Behavior
- `/stage8-sales-events`: show the real analysis instant in Korea time and `최신 판매 후보 다시 수집` for a completed collection (including blocked or storage-pending reports).
- POST action `refresh` requires REFRESH_CANDIDATE, the exact currently displayed request ID and plan fingerprint. The server re-reads them while holding the shared durable mutation lock.
- Append a new request with current time and current Product Master planning fingerprint, and verify request persistence. Preserve all earlier requests, reports, chunks, parity, evidence and canonical records. Refresh lineage uses `refreshesRequestId`, NOT the same-time recovery lineage; old chunks/proofs cannot become fresh evidence.
- Active or failed requests do not get cancelled/relabelled. Existing start/retry/cron behavior remains separate. A stale tab or duplicate click receives 409 instead of another request.
- All request creation, failure recovery, and gated canonical publication share an owner-token DB lease. Missing migration / ambiguous claim fails closed. A committed refresh remains accepted even when dispatcher wake or lease release is unavailable.
- Canary/full continue to require explicit confirmations and the unchanged exact-current candidate promotion gate. The lock covers gate evaluation through canonical apply. No fake parity, baseline, cost, or approval records are created.

## Deployment
Apply `202609140010_sales_event_mutation_lock.sql` to the existing OPS operational database (NOT Product Master) before deploying the callers. The new singleton table is RLS-enabled, client roles have no access, and RPC execution is service-role-only. The ten-minute lease exceeds the callers' 300-second maximum invocation; abandoned ownership expires. No new cron or paid service is added.

## Evidence, not claims
`Sales Event Refresh CI` executes real TS creator/API/guard tests, existing recovery/promotion regressions, actual PostgreSQL concurrency and permission tests in an isolated database, and real React browser controls with a mock API. General CI/Vercel build remains required. A passing mock test is not proof of real 360-day collection or canonical publication.

## Remaining October 1 gates
Collect current real sales -> current candidate parity/evidence -> normal canonical promotion -> persisted canonical readback -> verified historical cost mapping -> inventory/sales evidence -> fresh Shadow check. The unresolved order identity and missing cost/baseline evidence from `purchase-reentry-source-recovery-20260914.md` must be checked against actual sources; do not invent data or hide missing commitments.

October 1 does not auto-unlock ordering. Only a user-approved small batch, after latest sales/inventory/open orders/September close/available cash and Shadow-versus-live V2 policy checks, may be used for a real cycle. Actual receipt verification follows real delivery and need not finish on October 1.

## Rollback
Revert only this change, not parallel main work. The additive lock table/RPC can remain unused. Never delete operation history or reset production data as a rollback.


## PR #1201 inventory compatibility repair — 2026-09-15

P1 review 4003576437 reproduced through the actual inventory GET -> actual sales
creator -> actual shared guard: all five stale active states (QUEUED, RUNNING,
READY_CANARY, READY_FULL, STORAGE_NOT_READY) rejected the required newer analysis.

The inventory caller now uses a server-only, reset-time-bounded ensure operation.
It rechecks current coverage under the existing shared DB lease and reuses a
concurrently created covering request. Only a persisted inventory coverage gap
can take this path; ordinary start and explicit UI refresh keep their duplicate
and confirmation policies. New requests pin real current time/planning and retain
INVENTORY_RESET_COVERAGE provenance without inheriting same-time recovery chunks.
Invalid/future reset times, regressed clocks, unavailable lock/config/source,
missing readback and publication overlap fail closed. A lost dispatcher wake
cannot relabel a persisted request as an enqueue failure. Covering FAILED requests
remain visibly recovery-required rather than claiming verified sales evidence.

Permanent test: tests/salesEventInventoryCoverage.test.mjs (23 cases). Five P1
cases fail against original head 1598c95; after repair they pass. Together with
existing creator/recovery/promotion, inventory bridge and route-boundary checks:
94 passed locally, 0 failed/skipped, on the exact pinned PR source. The original
structural coverage assertions now follow the same safety checks into the shared
creator, and behavioral tests exercise both sides rather than mocking the creator.
Sales Event Refresh CI explicitly runs this suite plus lint, PostgreSQL ownership
and permission tests, and real controls against a mocked API. Exact-head CI,
review and Vercel production readback are required before reporting deployment.

This fixes code compatibility, not the entire October 1 operational data gate.
Latest real collection/parity/evidence/promotion, verified costs and inventory,
and final purchase Shadow remain independent checks. No order/payment, inventory
baseline mutation or canonical sales publication is performed by this repair.
