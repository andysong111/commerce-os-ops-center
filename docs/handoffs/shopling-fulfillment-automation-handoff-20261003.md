# Shopling Fulfillment Automation Handoff

Updated: 2026-10-03 (Asia/Seoul)

## Objective

Run the daily Shopling workflow from collection through physical CJ label output while preserving exact batch membership, stopping for mapping ambiguity, and leaving a resumable audit trail.

The intended weekday start time is 12:31, but unattended scheduling is not enabled yet. The executable workflow is available for supervised runs.

## Confirmed Operating Flow

1. **B1 collection**
   - Start order, claim, and Q&A collection together.
   - Wait for all three result windows to finish.
   - On the Q&A unsupported-mall screen, click `지원 쇼핑몰 문의수집 계속하기` and continue with the supported malls.
2. **B5 new-order mapping**
   - Check unmatched rows first.
   - Lookup priority is verified B-code, then model number, then shopping-mall product code.
   - `자사코드` is an arbitrary internal value and must never be treated as a B-code.
   - Match the exact option and use mapping quantity `1` unless the listing explicitly represents a bundle.
   - If no trustworthy B-code/model clue exists, stop and request operator review. Never guess.
   - When both new-order collection and remaining mapping are zero, continue directly to B7.
3. **B7 order processing**
   - Search today's newly created orders with row count `1000`.
   - Select the exact batch and change it to `발송준비`.
   - Re-query and require zero remaining new orders.
4. **B12 courier processing**
   - Search today's courier-pending rows with row count `1000`.
   - Apply automatic package condition `우편번호 + 주소 + 수취인 + 전화번호 + 쇼핑몰명`.
   - Select the exact batch and transmit it to the single courier option containing `도소매사우루스`.
   - Re-query courier-complete rows and require every order in the transmitted batch to be present.
5. **Label preparation**
   - Sort completed rows by B-code ascending, then quantity ascending.
   - Select only the verified transmitted batch.
   - Use CJ label style `003` and fields in this order: model number, Shopling model name, Shopling option name, quantity, option self-code, selection.
   - Recipient and shopping-mall names remain hidden on the product-information area.
6. **Physical print**
   - Export the label document to PDF through Chrome DevTools.
   - Validate the detected label page count before printing.
   - Print to `Xprinter XP-DT108B LABEL` using form `대한통운 송장`, 109 x 127 mm, 203 dpi.
   - Require a Windows spool job id. A missing job id or page-count mismatch is a hard failure.

## Safety and Resume Rules

- Every stage writes a dated checkpoint file. `--resume` skips only stages already recorded as successful.
- Mutating operations require `--execute`; dry-run is the default.
- Exact order-number sets are carried from B7 to B12 and label output. Unrelated rows are never selected by a generic select-all action.
- Mapping ambiguity returns `needs_mapping_review` and stops the workflow before B7.
- Browser account verification requires the logged-in Shopling header to contain `[andy801]`.
- Login, CAPTCHA, and expired-session recovery remain operator boundaries.
- Output logs and handoff files must not contain recipient names, addresses, phone numbers, credentials, or live session data.

## Verified Evidence

- A full supervised run completed with 33 orders and 31 physical labels. The difference was expected because package grouping can combine orders.
- Later mini-runs also validated CJ label settings, page-count detection, Xprinter form selection, spool submission, and correct physical label size/order.
- The browser popup flow and native Chrome print UI were unreliable for unattended operation, so the implementation exports PDF and prints through the Windows spooler instead.

## Code Map

- Orchestrator: `local-agent/src/shopling-daily-fulfillment.mjs`
- Shopling browser stages: `local-agent/src/shopling-daily-browser-adapter.mjs`
- Read-only preflights: `local-agent/src/shopling-fulfillment-preflight.mjs`, `local-agent/src/shopling-order-preflight.mjs`
- Label capture/export: `local-agent/src/shopling-label-export.mjs`, `local-agent/src/shopling-label-print.mjs`
- Windows printing: `local-agent/src/windows-pdf-printer.mjs`, `local-agent/scripts/windows-pdf-print.py`
- Post-packing reconciliation: `local-agent/src/shopling-shipment-manifest.mjs`, `local-agent/src/shopling-unshipped-reconciliation.mjs`, `local-agent/src/shopling-unshipped-review.mjs`
- B12 invoice deletion: `local-agent/src/shopling-b12-browser-adapter.mjs`, `local-agent/src/shopling-b12-invoice-deletion.mjs`

## Commands

```powershell
npm run local-agent:fulfillment-preflight
npm run local-agent:daily-fulfillment -- --date YYYYMMDD
npm run local-agent:daily-fulfillment -- --date YYYYMMDD --execute --resume
npm run local-agent:order-preflight
npm run local-agent:label-print -- --expected-orders N --expected-pages N
npm run local-agent:label-print -- --expected-orders N --expected-pages N --execute
```

The daily command is dry-run unless `--execute` is present. Use the preflight first and keep dedicated Chrome logged in to the expected Shopling account.

## Remaining Work

- Expand the B5 exception library as the operator supplies new real cases.
- Complete a fresh supervised end-to-end production run after each Shopling UI change.
- Enable the weekday 12:31 scheduler only after repeated clean supervised runs.
- Keep authentication and CAPTCHA manual unless Shopling provides a supported authentication integration.

## Start Here in Another Chat

Ask the new chat to read this file and `docs/handoffs/shopling-fulfillment-automation-state.json`, then run the focused tests before changing the workflow. Do not infer B-codes from `자사코드`, and do not enable scheduled execution without explicit approval.
