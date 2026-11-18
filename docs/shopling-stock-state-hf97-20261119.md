# Shopling stock-state HF97 result responsibility — 2026-11-19

## Incident

- A four-code direct run was reported as `2/4 success` even though `BCC5-1` had already invoked the original Shopling blue submit exactly once.
- Its terminal Shopling result table was balanced at `53 total / 36 success / 17 marketplace failures`.
- Commerce OS incorrectly treated those 17 marketplace rows as a failed transmission and offered the B-code for retry.
- The genuine pre-submit block (`BAF3-3`) had no browser mutation and must remain failed.

## HF97 change

- Normalize only `SHOPLING_HF87_RESULT_TABLE_FAILURE` results that have a balanced terminal result table and an exact, original popup submit receipt.
- Require the receipt to prove the same job, product kind, desired state, goods-key query, popup tab/frame, owner key, submit invocation, confirmation, and verified submit control.
- Count that case as Commerce OS transmission success while preserving marketplace failures as an advisory (`marketFailureCount / marketTotalCount`).
- Keep missing, mismatched, or pre-submit evidence failed/uncertain. These remain eligible for the bounded retry flow.
- Show every current-run B-code, target state, outcome, stage, code, and exact message directly below the run summary.

## Verification gate

- Real sanitized `BCC5-1` fixture must normalize to success with `17/53` marketplace advisory.
- Removing the receipt, submit confirmation, balanced counts, exact popup, or owner binding must leave it uncertain.
- A genuine pre-submit failure must remain failed.
- The page bridge must be the single normalization point so all page consumers receive identical responsibility semantics.

## User test after production deployment

1. Refresh Commerce OS; extension v0.6.58 remains valid and does not need reinstalling.
2. Run a small mixed set serially.
3. Confirm the summary counts original Shopling submit receipts as success.
4. Confirm marketplace row failures appear as an amber advisory and are never included in `미완료 건 2차 시도`.
5. Confirm a genuine pre-submit block appears immediately in `이번 실행 상세` with its exact reason.

