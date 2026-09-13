# Production generation-only canary result — 2026-09-14

PR #1186 is merged as 98628c1bd20d39e82d92508c063620e0e5638b36 and Vercel dpl_94EuHQvHwx8yV2Qj4BktVBdL7oxf is READY on the canonical production alias.

Actual normal-Chromium canary: workflow 34769608969, job 103756672791, 2026-09-13 16:47:29–16:51:38 UTC. Exactly one existing generation retry POST covering AAA106 and AAA109, no POST retries, no enqueue or Shopling registration request. Browser router blocked all other writes. Archived 83 ready/success RUN metadata and timestamps were identical before/after. Both targets still have registration_status=idle and empty registration job/request identifiers.

## Result: partial recovery, final generation still fails

Both products used one durable identity-first recovery attempt and progressed through demand/accuracy and Step4 prohibited-keyword checks into compose_final. Each has five allowed keywords, no Step4 removed keys. The original missing-candidate failure is therefore resolved for these two samples.

Both subsequently failed with: `검증 키워드만으로 30~50bytes 고유 쇼핑몰별 상품명 1개를 만들 수 없습니다. 현재 0개`. Neither target is ready; no FINAL result was persisted. Do not claim end-to-end generation success or mass-retry remaining failures.

AAA106 title generation used a deterministic fallback after an empty structured AI response; AAA109's ordinary title generation succeeded. Their shared final-compose error needs separate deterministic reproduction and stack diagnosis. Do not infer that keyword safety thresholds or the 30–50-byte title limit must be weakened.

The one-shot workflow and executable live-retry script were removed after terminal readback to prevent unintended repeat execution. No second live retry is authorized by this diagnostic file itself. Preserve checkpoints and their recovery budgets.
