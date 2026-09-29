# AI Development & Verification Rules

These rules apply to every AI-assisted code change in this repository.

## Definition of done
Do not report a task as complete merely because code was edited or a build passed. Completion requires evidence that the requested behavior actually works.

## Required verification
After each change, identify explicit acceptance criteria and verify the relevant normal/happy path, failure path, and boundary or abnormal cases. Verify both directions: behavior that should be allowed must work, and behavior that must not happen must be blocked.

Check for regressions in existing behavior affected by the change. Run the repository's relevant tests, type checks, lint, build, and other available checks. Do not hide, weaken, delete, or bypass tests just to make a change pass.

For runnable web UI changes, perform real browser verification when the environment and available tooling permit it: navigate like a user, click/input/refresh as relevant, and confirm the observable result. When correctness depends on more than the UI, also inspect the relevant API/backend response and persisted database/state when access is available. A correct-looking screen alone is not proof of system correctness.

If browser, database, external-service, credential, or environment access is unavailable, state that limitation explicitly. Never claim a verification step was performed when it was not.

## Regression tests are permanent assets
Treat every discovered bug, production incident, data mismatch, edge case, and repeated operator mistake as an opportunity to increase the repository's permanent verification assets.

- A bug or regression fix is not complete until a deterministic regression test reproduces the failure or protects the invariant that failed, whenever the behavior is testable.
- The regression test must be wired into an applicable GitHub Actions CI workflow. Creating a test file that CI never executes does not count as regression coverage.
- If no existing workflow covers the affected area, extend the closest relevant workflow or add a narrowly scoped workflow. Prefer reliable, risk-focused CI over broad expensive checks that add noise.
- Keep regression tests after the incident is fixed. Do not delete, skip, weaken, or loosen them merely because the current implementation passes. Remove or materially change a regression test only when the protected behavior is intentionally retired or replaced, and preserve equivalent coverage for the new behavior.
- Prefer the closest stable layer that proves the failure: pure logic/unit tests first, then API/integration/database tests where persistence or boundaries matter, and browser/E2E tests where the actual user flow is the invariant. Add multiple layers only when they protect meaningfully different failure modes.
- Name or describe regression cases so a future maintainer can understand what historical failure or invariant they protect.
- When one root cause can affect multiple code paths, add coverage for the shared invariant rather than only the single example that exposed it.
- Before merging, verify that the exact regression test is visible in a passing CI run on the latest PR head SHA.

The goal is compounding reliability: every real failure should leave the codebase harder to break in the same way a second time.

## Root-cause standard
Distinguish hypotheses from confirmed causes. Do not call something the root cause without evidence such as logs, traces, data inspection, reproducible before/after behavior, or an equivalent direct signal. Prefer reproducing the failure before fixing it when practical, then repeat the same reproduction after the fix.

## Adversarial pass
Before finalizing, assume the implementation is wrong and actively try to break it. Consider malformed or missing input, repeated actions, refresh/retry, stale state, partial failure, permissions/authentication, concurrency where relevant, and dependencies that can fail. Use judgment; test cases should match the actual risk of the change.

## Fix-and-retest loop
If verification fails, investigate, fix, and rerun the relevant checks. Do not stop at the first patch if the acceptance criteria still fail.

## Completion report
Every completion report must state what changed, what was tested, the evidence/results, any regression checks performed, and anything not verified or still risky. For bug/regression work, name the regression test and the CI workflow that executes it. End by answering: "What proves this is working correctly?"

## Safety
Prefer minimal, reversible changes. Preserve existing working behavior unless the task explicitly requires changing it. Do not perform destructive production-data operations, weaken authentication/authorization, expose secrets, or broaden access merely to make verification easier.

## Persistent project context

For Commerce OS work that touches Shopling, purchase-cycle, monthly pricing, stock-state, Product Master, B-code, warehouse-location reconciliation, or the Windows Local Agent, read `docs/CODEX_START_HERE.md` before editing code.

That file points to `docs/commerce-os-master-context-20260929.md`, which persists important owner decisions and live-operating lessons that were established across prior ChatGPT/Codex conversations. For Product Master / B-code / warehouse work it also points to `docs/product-master-bcode-warehouse-handoff-20260929.md`, which contains the detailed physical-location reconciliation state and safety rules.

Do not ask the owner to restate context already documented there. When the persistent context conflicts with current code, tests, direct live evidence, or the owner's latest explicit instruction, prefer the newer evidence and update the context after the change.
