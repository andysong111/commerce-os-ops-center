# Shopling market recovery v0.3.37 — 2026-09-14 KST

## Incident evidence and correction
The operator restored missing saved searches 도매1–소매2 on goods_mallReg_preProdChoice.phtml. The v0.3.36 removal of this step was wrong: seven top-level radios do not select each marketplace's required basic-information template. The screenshot explicitly reports that Auction basic information is unselected.

At 2026-09-14 01:55 KST, AAA419 goods keys 122734–122739 were queued/pending with reason auto_stale_submit_preflight_reconcile_v0330. NULL submit_armed_at here is the result of the old three-minute reset, NOT evidence that no submission boundary was crossed. At 02:01 KST these exact six unchanged rows were placed in confirm_needed with reason manual_hold_v0336_post_submit_review using owner, goods keys, old status, old reason, and exact updated_at predicates. No product was sent and no sent record was changed by this repair. Actual marketplace acceptance across all accounts is still unverified.

The popup also retained its local running 0/1 queue. UI running and durable market state are distinct. The old coordinator could remain running forever after its retry budget was exhausted.

## Change
- Restore forced saved-profile application on the pre-product screen.
- Wait for all selected accounts to have exactly one required basic template, then re-read before the submit lock. Never guess the first template or free-shipping choice.
- Default to a one-product no-submit settings diagnostic. Held products are selectable only for this diagnostic, not actual sending.
- Diagnostic runs never claim, arm, release or report marketplace tasks. They export their local evidence as JSON; they do not establish past non-submission or release server holds.
- Add explicit local stop/archive without resetting server sent/armed/confirm-needed records; fresh v0337 namespaces do not revive legacy queues.
- Finish exhausted pre-submit retries with an exception instead of permanent 0/1.
- Versioned v0337/claim blocks uncertain, armed, legacy, manual-held and timestamp-erased stale-submit rows. It does not call the old reset/reconcile claim path.
- Keep this release manual period-only: no automatic SEO handoff or unsolicited inspection of pre-existing result tabs.

## Verification boundary
Tests execute the actual compiled safe-claim handler with a database double. Browser tests execute generated driver functions and the real popup in Chromium with synthetic DOM and mocked Chrome/server APIs. Production build and ZIP verification are separate gates. These are NOT live authenticated Shopling E2E success. AAA419 remains held until per-market registration evidence resolves the interrupted run. Do not advise blind re-click or announce duplicate risk is zero.
