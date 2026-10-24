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

As of 2026-10-25:

- 중국 재발주 운영은 달력월 1회 제한이 아니라 주문할 수 있을 때 여는 `발주차시` 기준이다. 운영자는 `이번 발주차시 시작`에서 총 사용 현금과 신규상품 소싱예산 비율을 입력한다. 시스템은 최신 판매·클레임·재고·진행 중 주문을 자동 준비한 뒤 발주초안을 연다. 새 차시는 `직전 발주차시 계산 시작일 이상·이번 발주시작일 미만`의 새 판매 근거를 사용한다. 입고확정일은 판매수집 경계가 아니라 실제 재고·원장 확정일이다. 같은 Draft 재계산은 최초 차시 경계를 유지한다. 발주 가능 금액은 완료된 달의 정상매출 50%를 월별로 적립해 이월하며 실제 `ORDERED` 기록만 누적 잔액에서 차감한다. 같은 달 복수 발주가 가능하고 Draft 미리보기·재계산은 잔액을 차감하지 않는다.
- 내부 중국 발주초안에서는 B코드·모델명·모델번호·판매옵션과 함께 `많음 / 보통 / 적음 / 품절` 대략 재고를 버튼으로 선택한다. `재고상태 저장 후 발주안 재계산` 한 번으로 발주 계산용 추정치만 저장하고 같은 차시 Draft를 교체한다. 이 입력은 Shopling 판매상태를 바꾸지 않는다.
- 발주초안 작업 순서는 `대략 재고 → 수량·5/10단위 → 빠진 B코드 수동 추가 → 한 번 재계산 → 5-1 원가·운임 기록 → 최종 예산 재계산 → 5-2 장바구니 담기`이다. 수동 추가·직접 수정 수량은 사용자 고정값으로 예산을 먼저 사용하고, 자동 추천품목만 남은 예산에 맞춘다. 5-1 뒤 상품대금 한도를 넘으면 5-2를 막고 수량 재조정을 요구한다. 5-2는 확정수량과 옵션을 1688 장바구니에 맞추는 단계까지만 실행하며 주문 제출·결제는 사용자가 직접 한다.
- 정기 `매달 발주자료 미리 준비` 작업은 폐기했다. 월별 매출 기반 예산 적립과 최근 12개월 매출 판정은 계속 사용하지만, 판매 원장 준비는 발주차시 시작 때 필요 범위만 갱신한다.
- 2026-10 운영 전환 예산은 10월 발주부터 새로 시작한다. 10월 발주 가용액은 2026-09 정상매출의 50%만 적립하며, 10월 이전의 월간 시험 Draft·시험 주문은 적립 시작점이나 실제 주문 차감에 포함하지 않는다. 이후 완료월 적립액과 2026-10 이후 실제 `ORDERED` 지출만 이월 원장에 누적한다.
- 발주 메인 화면은 입고·원장 전체 상태를 자동 조회하지 않는다. 이 조회는 무거운 Product Master 원장과 발주 준비가 동시에 경쟁하지 않도록 실제 주문·입고 뒤 운영자가 `입고·원장 상태 확인`을 누를 때 실행한다. 발주 시작의 Product Master 실시간 읽기는 운영 실측에 맞춰 30초 한 번만 시도하며, 지연되면 최근 72시간 안에 저장된 지문·개수 일치 스냅샷만 기준정보로 재사용한다. 같은 준비 단계의 시간초과가 2회 연속이면 브라우저 자동 반복을 멈추고, 최신 판매·클레임은 같은 시작 버튼으로 저장된 단계부터 다시 읽는다.

- Windows Commerce OS Local Agent phase 1 is merged to `main` via PR #1285.
- The agent is intended to become the permanent diagnostic/observability bridge for this Windows PC.
- Live A4 evidence identified the v0.5.15 `SEARCH_RESULT_NOT_FOUND` cause: A4 defaults to the last seven days, while its date inputs are read-only, so the old range-expansion code never included older products.
- A21 extension v0.5.17 is merged through PR #1300 and reports terminal batch failures without leaving false `RUNNING` rows. A 2026-09-30 live recovery then proved that `A21_EMPTY_RESULT` could be false: GOODSKEY `100091` returned 4 rows manually while the content script had treated a missing count marker after 500 ms as zero. The v0.5.18 continuation submits the search form directly and waits for an authoritative `총 조회수` marker before any empty-result decision. After deploy/reload, recover status first and request fresh action-time confirmation before a new scoped resend.
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
