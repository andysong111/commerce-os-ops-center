# Shopling stock sync HF43 — durable terminal replay

## Incident

- HF42 correctly recognized the exact BCB6-2 option-completion footer and closed its managed Shopling result tab.
- Reloading the extension cleared the React component's in-memory `activeBatch`, so the extension's persisted `lastResult` replay was ignored and Commerce OS kept BCB6-2 in the pending queue.
- Shopling must not be submitted again for this recovery.

## Change

- Seed the operational queue's job identity map from the server-rendered initial queue.
- When no live batch exists, accept a persisted terminal result only if its `jobId`, barcode, product kind, desired status, and `operationalQueue` marker exactly match a currently pending queue job.
- Persist that terminal result idempotently with `recoveredTerminalReplay` and `recoveredWithoutShoplingResend` evidence, then fresh-read the queue.
- The recovery path never posts a Shopling start message and never continues draining the queue.

## Verification

- HF42/HF43 targeted tests: 5/5 passed.
- Shopling and inventory queue regression selection: 89/89 passed.
- TypeScript and targeted ESLint passed.
- Production Next.js build passed outside the Windows sandbox after the sandboxed Turbopack child-process restriction failed.

## Live acceptance

1. Deploy the patch.
2. Reload the authenticated stock-control page so v0.6.10 reinjects its content script.
3. Confirm the saved BCB6-2 `SUCCEEDED` result is recorded without opening or resubmitting a Shopling job.
4. Confirm the runnable queue decreases by one and BCB6-2 is absent.
5. Repeat the same no-resend recovery for BBB4-3 if its persisted terminal result is still within the extension retention window; otherwise stop for audited manual recovery.
