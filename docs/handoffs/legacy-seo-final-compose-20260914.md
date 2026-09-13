# Legacy SEO final-composition follow-up — 2026-09-14

## Baseline and live result

PR #1186 deployed core-keyword recovery and historical-title preference as 98628c1bd20d39e82d92508c063620e0e5638b36. Its generation-only production canary 34769608969 advanced AAA106 and AAA109 through missing-candidate recovery and normal Step4 into final composition, but both failed there. Neither is ready or registered. All 83 archived success RUNs had identical metadata/timestamps before and after; no Shopling registration request occurred. The actual remaining error was `30~50bytes 고유 쇼핑몰별 상품명 1개 ... 현재 0개`.

Read-only DB snapshot at 2026-09-13 17:09 UTC: 41 filter-stage failures, 3 final-compose failures (AAA106, AAA109, AAA362), 83 archived ready/success RUNs, no running/queued generation. Preserve checkpoints and durable recovery budgets. AAA027 has two old failed RUNs for the same source, so do not blindly retry every failed RUN.

## Distinguish confirmed reproduction from inference

Offline replay 34770131600 ran production source with simplified incident-shaped fixtures and ALL external fetch forbidden. The real market registry was 29 entries; valid title pools had 12 and 26 candidates and failed because the composer required 29 different strings. This confirms an absolute-uniqueness constraint that conflicts with the operator's best-effort diversity preference. It does NOT exactly reproduce the live 1/0 diagnostic. The remaining live difference needs the new numerical counters and bounded stack diagnostics; do not call the source of that discrepancy proven before readback.

## This follow-up

- Low-level title composer remains strict by default.
- Fresh bulk composition explicitly enables reuse of ALREADY VALID titles only when every distinct valid candidate has first been used.
- A zero-sized valid pool remains blocked. Each title remains 30–50 UTF-8 bytes, all input final-keyword coverage checks remain active, prohibited terms are not restored, and no unsupported words or material are introduced.
- Sufficient-material cases keep distinct titles and unchanged row selection.
- Scarce material gets the maximum available valid diversity rather than invented content merely to meet an arbitrary count of distinct strings. Actual duplicate count is disclosed in output warnings.
- Existing historical-title preference stays active. Reusing valid core words is not treated as a safety violation.
- Add revision/count/stack logging for a final-composition failure. No full product payloads, secrets, URLs with credentials or authentication changes.

The search-keyword 10-slot requirement and its existing Step4-filtered recovery are unchanged. This patch does not authorize Shopling listing creation, duplicate marketplace publishing or mass generation retries.

## Verification and next read

`tests/keywordEngineElonValidatedTitleReuse.test.mjs` is permanently wired into SEO Title Inventory Ledger CI. Seven cases cover strict default, exhausting all valid variants before reuse, unchanged rich-material behavior, zero valid combinations blocked, prohibited material blocked, scarce historical reruns, and two incident-shaped keyword pools. Existing rich historical-zero-reuse, byte-limit, semantic eligibility, recovery and blocked-term regressions are retained.

Authoring workflow 34770670328 passed the new and existing focused tests plus source/test lint and committed ad8e00d23c425618387fd6c8a3df4838287b29d9. An earlier source push was rejected after the CI file advanced, not a behavior-test failure; source was reapplied and retested on the latest head. Authoring-only workflows are removed from this final tree.

At authoring, exact final PR-head CI/build, production deployment and a fresh generation-only canary remain pending. The PR's latest verification note is authoritative. A unit pass or deploy is not proof all 44 old failures recovered.

No new failure-status UI, retry-policy API or search-term-ordering feature is included. OpenAI support contact remains out of scope and last priority.
