# Codex Start Here — Commerce OS persistent context

This repository is used for a long-running Commerce OS project that has been developed across ChatGPT conversations, Codex sessions, browser tests, production incidents, and GitHub work.

This file exists so a fresh Codex session can continue naturally without asking the owner to repeat the whole history.

## Source priority

When sources conflict, use this order:

1. The owner's latest explicit instruction in the current session.
2. Current production behavior and direct evidence from the real Shopling/Commerce OS UI.
3. Current `main` code, migrations, tests, CI, and deployed configuration.
4. `AGENTS.md` safety and verification rules.
5. `docs/commerce-os-master-context-20260929.md`.
6. Older plans, handoff notes, screenshots, and historical chat summaries.

Never preserve an old plan merely because it is documented if current code or direct live evidence disproves it.

## Mandatory reading by task

Before changing Shopling, purchase-cycle, monthly pricing, stock-state, Product Master, B-code, warehouse-location, or Local Agent code, read:

- `AGENTS.md`
- `docs/commerce-os-master-context-20260929.md`
- the closest current runbook/plan for the affected subsystem
- the actual code and regression tests on current `main`

For Product Master / B-code / warehouse-location work also read:

- `docs/product-master-bcode-warehouse-handoff-20260929.md`

For Shopling monthly price work also read:

- `docs/shopling-price-bulk-operations-runbook.md`
- `docs/shopling-price-simple-one-click-auto-plan.md`
- `docs/shopling-price-bulk-roadmap.md`
- `local-agent/README.md`

For purchase-cycle work also read:

- `docs/handoffs/purchase-cycle-stage7-11-codex-handoff-20260929.md`
- `docs/purchase-cycle-2026-10-01-predevelopment.md`
- `docs/purchase-cycle-2026-10-01-review-hardening.md`
- `docs/purchase-cycle-preflight-complete-month-read.md`

## Owner interaction rule

The owner wants intervention minimized.

Proceed through reversible engineering work, tests, branch creation, PR creation, and ordinary merge work without repeatedly asking for confirmation when no business judgment is required and the repository safety rules are satisfied.

Stop and ask only at a real owner decision boundary, especially:

- destructive production data operations
- production schema changes not already explicitly approved
- actual purchase/payment/order execution
- authentication/security weakening
- firewall or external network exposure
- a policy choice with business consequences
- a change that cannot be safely reversed

Do not ask the owner to repeat project history that is already persisted in this repository.

When owner intervention is genuinely required, explain it at roughly Korean high-school freshman level. Lead with the current stage, why automation must stop, the owner's exact 1~3 actions, and the observable completion signal. Keep internal technical details secondary unless they are needed for the action.

## Current hot path

As of 2026-09-29:

- Windows Commerce OS Local Agent phase 1 is merged to `main` via PR #1285.
- The agent is intended to become the permanent diagnostic/observability bridge for this Windows PC.
- Live A4 evidence identified the v0.5.15 `SEARCH_RESULT_NOT_FOUND` cause: A4 defaults to the last seven days, while its date inputs are read-only, so the old range-expansion code never included older products.
- A21 extension v0.5.16 now selects A4's `전체` period checkbox before GOODSKEY search. A live read-only audit of the five remaining September review items found registered-mall tables for `100091`, `116282`, `116855`, and `118734`; every visible `판매중` row matched its applicable target price. GOODSKEY `121055` had the correct `13,420원` base price but no registered-mall detail table. v0.5.16 now records that stable empty result as unresolved evidence and continues to later goods without granting a resend. The next gate is to deploy/install v0.5.16 and run the saved five-item readback.
- Product Master / B-code / warehouse reconciliation now has a dedicated persistent handoff. Its first live continuation check is the AAA030 멀티탭 트레이 / AAA038 실리콘 악력볼 Product Master and warehouse-map sync after the 2026-09-28 physical correction.

## Handoff discipline

After any major subsystem change, update the relevant persistent context instead of leaving the key decision only in chat.

At minimum record:

- what behavior is now authoritative
- what evidence proved it
- current version/PR if relevant
- unresolved blocker
- next safe action
- any owner decision still required

The goal is that a new Codex session can start from repository context and continue without a separate ChatGPT reconstruction.
