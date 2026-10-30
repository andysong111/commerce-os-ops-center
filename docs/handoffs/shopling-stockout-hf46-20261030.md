# Shopling stock-state HF46 handoff — 2026-10-30

## Live incident

- B-code: `BDE7-3`, OPTION → SOLD_OUT.
- A6 exact lookup and per-goods-key option-status API completed successfully.
- The fresh exact A21 page opened, but v0.6.10 returned `SHOPLING_A21_DISPATCH_FAILED_AFTER_OPTION_API_RETRY_SAFE` before assigning the A21 worker.
- No A21 marketplace transmission was submitted. The job remains failed/held and must not be retried with v0.6.10.

## Confirmed cause

HF39 added an eight-second canonical-worker readiness wait only to the SINGLE batch path (`background-v057.js`). The OPTION batch path (`background-v071.js`) still injected once, waited only 140 ms, and failed when the newly opened A21 page had not finished registering its worker.

## HF46 behavior

- Package version: v0.6.11 HF46.
- OPTION A21 worker readiness waits up to eight seconds on the exact assigned tab and frame.
- The canonical content script is injected at most once.
- No A21 assignment is sent until the worker identifies as exact role `A21_LIST`.
- The already verified option API state is not repeated as part of readiness waiting.
- The stock-control UI rejects v0.6.10 and earlier.

## Verification

- Regression: `tests/shoplingStockStateHf46.test.mjs`.
- Shopling stock-state focused suite: 69/69 passed.
- TypeScript: passed.
- Changed-file ESLint: passed. Repository-wide ESLint still has 51 unrelated baseline errors.
- Next.js production build: passed with Webpack. The default Turbopack attempt panicked while spawning a CSS processing subprocess in the local sandbox.
- Built HTTP verification returned v0.6.11, 8,000 ms wait, at-most-once injection, and a 148,597-byte ZIP with the HF46 response header.

## Next safe action

1. Merge and deploy HF46.
2. Install/reload the exact v0.6.11 extension while preserving the current extension identity where possible.
3. Confirm the OPS page reports v0.6.11 and no active lane.
4. Retry only `BDE7-3`; the API revalidates the existing SOLD_OUT state and A21 resumes safely.
5. Continue the remaining B-code queue one at a time. Keep `BCG5-2`, `BCG5-3`, and blocked `BCC6-2` out of automatic retry.
