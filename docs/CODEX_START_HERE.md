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
- `docs/warehouse-map-stock-status-20261026.md` when changing warehouse-map sale-status buttons or the HF32 bridge

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

- 중국 재발주 운영은 달력월 1회 제한이 아니라 주문할 수 있을 때 여는 `발주차시` 기준이다. 운영자는 `이번 발주차시 시작`에서 총 사용 현금과 신규상품 소싱예산 비율을 입력한다. 시스템은 최신 판매·클레임·재고·진행 중 주문을 자동 준비한 뒤 발주초안을 연다. 월간 방식이 2026년 8월 판매분까지 반영했으므로 첫 전환 차시의 판매수집 시작일은 `2026-09-01`이다. 이후 새 차시는 `가장 최근 입고확정 차시의 계산 시작일 다음 날 이상·이번 발주시작일 미만`의 새 판매 근거를 사용한다. 예를 들어 2026-10-26에 시작한 차시가 실제 발주·입고확정까지 끝나면 다음 차시는 2026-10-27부터 계산한다. 주문만 했거나 입고가 끝나지 않은 차시와 폐기 Draft는 판매수집 경계를 옮기지 않는다. 같은 Draft 재계산은 최초 차시 경계를 유지하되, 전환 초기에 잘못 저장된 최근 30일 임시 경계는 2026-09-01로 교정한다. 발주 가능 금액은 완료된 달의 정상매출 50%를 월별로 적립해 이월하며 실제 `ORDERED` 기록만 누적 잔액에서 차감한다. 같은 달 복수 발주가 가능하고 Draft 미리보기·재계산은 잔액을 차감하지 않는다.
- 내부 중국 발주초안에서는 B코드·모델명·모델번호·판매옵션과 함께 `많음 / 보통 / 적음 / 품절` 대략 재고를 버튼으로 선택한다. `재고상태 저장 후 발주안 재계산` 한 번으로 발주 계산용 추정치만 저장하고 같은 차시 Draft를 교체한다. 같은 요청에서 막 저장한 재고상태는 원장 재조회 지연과 무관하게 즉시 계산 입력으로 전달한다. 파란 버튼은 재계산 대기, 초록 버튼은 저장·적용 완료이며 초록 선택은 다음 차시 재사용을 위해 재계산 후에도 남는다. 저장된 대략 재고는 운영자가 바꾸기 전까지 발주계획 판단으로 계속 우선 적용하고, 이후 정확수량 기준점이나 판매·입고 이동이 생겼다는 이유만으로 계산 엔진이 조용히 무시하지 않는다. 숫자로 직접 입력한 일회성 추정수량만 더 최신의 정확수량·재고이동에 의해 만료된다. 이때 사용자가 고정한 상품·수량은 보존하고, 그 사이 최신 판매판정에서 새로 추천된 입력대기 상품도 우선순위대로 보충한다. 이 입력은 Shopling 판매상태를 바꾸지 않는다.
- 검토 Draft는 최대 500개 대략 재고 입력을 받으며 Product Master 조회는 100개, 재고 원장 저장은 50개 단위로 나눈다. 물리 적재 위치 때문에 같은 옵션이 여러 B코드를 쓰는 검증된 별칭은 후보·교체 스냅샷·수동 재계산·최종 저장 모두에서 대표 B코드 한 줄로 통합하고, 별칭 위치의 수량은 추가 수요로 합산하지 않는다. 현재 검증 별칭은 `BBD4-3 → BBD4-2`이다.
- 발주안 재계산에서 고정수량으로 보존할 수 있는 값은 명시적으로 확인된 사용자 수정, 수동 B코드 추가, 확정 신규소싱뿐이다. 과거 화면 표시용 수량 덮어쓰기나 출처가 불명확한 기존 자동수량은 사용자 지시로 승격하지 않고 최신 매출·재고 전략으로 되돌린다. 새 Draft에는 확인된 고정수량 B코드의 출처를 함께 기록해 이후 재계산에서도 수동 지시와 자동 추천을 구분한다.
- 수량 고정 출처 버전이 2보다 낮거나 없는 과거 확인 목록은 오염 가능성이 있는 이전 데이터로 취급한다. 해당 줄이 수동 추가 또는 확정 신규소싱인 경우에만 수량을 보존하고, 나머지는 최신 정책으로 다시 계산한다.
- 발주초안 작업 순서는 `대략 재고 → 수량·5/10단위 → 빠진 B코드 수동 추가 → 한 번 재계산 → 5-1 원가·운임 기록 → 최종 예산 재계산 → 5-2 장바구니 담기`이다. 수동 추가·직접 수정 수량은 사용자 고정값으로 예산을 먼저 사용하고, 자동 추천품목만 남은 예산에 맞춘다. 5-1 뒤 상품대금 한도를 넘으면 5-2를 막고 수량 재조정을 요구한다. 5-2는 확정수량과 옵션을 1688 장바구니에 맞추는 단계까지만 실행하며 주문 제출·결제는 사용자가 직접 한다.
- 판매 귀속은 쇼핑몰 주문의 `옵션자체관리코드`를 상품 대표코드보다 먼저 사용한다. 같은 상품 대표코드를 공유하는 색상·옵션도 각 B코드 판매로 분리하며, 원가가 아직 확정되지 않은 정상 추천품목은 엔진 추정원가로 초안에 남겨 5-1에서 실제 1688 원가를 확인한다. 입력 현금이 적을 때는 `최근 12개월 4만원 이상 달 수 → 월평균 매출 → 상승세 → 기존 점수` 순으로 최소 발주단위를 배정하고, 현금이 늘면 같은 순서로 수량과 다음 상품을 추가하되 엔진 권장수량은 넘지 않는다.
- 정기 `매달 발주자료 미리 준비` 작업은 폐기했다. 월별 매출 기반 예산 적립과 최근 12개월 매출 판정은 계속 사용하지만, 판매 원장 준비는 발주차시 시작 때 필요 범위만 갱신한다. Product Master는 발주 계산에 필요한 최근 재고·월별 판매·최신 원가·최신 판정만 묶은 읽기 함수를 사용하며, 발주 시작은 이 읽기를 최대 70초까지 한 번 기다린 뒤 최근 72시간 내 동일 지문 스냅샷만 대체 근거로 허용한다.
- 2026-10 운영 전환 예산은 10월 발주부터 새로 시작한다. 10월 발주 가용액은 2026-09 정상매출의 50%만 적립하며, 10월 이전의 월간 시험 Draft·시험 주문은 적립 시작점이나 실제 주문 차감에 포함하지 않는다. 이후 완료월 적립액과 2026-10 이후 실제 `ORDERED` 지출만 이월 원장에 누적한다.
- 발주 메인 화면은 입고·원장 전체 상태를 자동 조회하지 않는다. 이 조회는 무거운 Product Master 원장과 발주 준비가 동시에 경쟁하지 않도록 실제 주문·입고 뒤 운영자가 `입고·원장 상태 확인`을 누를 때 실행한다. 발주 시작의 Product Master 집계형 읽기는 운영 연결 지연을 감안해 최대 70초 한 번만 시도하며, 지연되면 최근 72시간 안에 저장된 지문·개수 일치 스냅샷만 기준정보로 재사용한다. 같은 준비 단계의 시간초과가 2회 연속이면 브라우저 자동 반복을 멈추고, 최신 판매·클레임은 같은 시작 버튼으로 저장된 단계부터 다시 읽는다.

- Windows Commerce OS Local Agent phase 1 is merged to `main` via PR #1285.
- The agent is intended to become the permanent diagnostic/observability bridge for this Windows PC.
- Live A4 evidence identified the v0.5.15 `SEARCH_RESULT_NOT_FOUND` cause: A4 defaults to the last seven days, while its date inputs are read-only, so the old range-expansion code never included older products.
- A21 extension v0.5.17 is merged through PR #1300 and reports terminal batch failures without leaving false `RUNNING` rows. A 2026-09-30 live recovery then proved that `A21_EMPTY_RESULT` could be false: GOODSKEY `100091` returned 4 rows manually while the content script had treated a missing count marker after 500 ms as zero. The v0.5.18 continuation submits the search form directly and waits for an authoritative `총 조회수` marker before any empty-result decision. After deploy/reload, recover status first and request fresh action-time confirmation before a new scoped resend.
- Product Master / B-code / warehouse reconciliation now has a dedicated persistent handoff. Its first live continuation check is the AAA030 멀티탭 트레이 / AAA038 실리콘 악력볼 Product Master and warehouse-map sync after the 2026-09-28 physical correction.

### Shopling stock-state HF69 handoff (2026-11-05)

- `goodsKey` 개수는 쪼개기 상품 판정 근거가 아니다. 한 B코드는 판매 채널별로 여러 goodsKey를 정상적으로 가질 수 있다. 품절·판매중 전환은 Product Master의 논리 상품형태와 **각 goodsKey의 실제 옵션 수**를 조합해 개별 판정한다.
- 논리 `OPTION`인데 해당 goodsKey의 실제 옵션이 1개인 과거 쪼개기 등록은 정확한 옵션상태와 상품 판매상태를 Shopling API로 모두 변경·재조회하고 수량 불변을 확인한 뒤 A21 `상품판매상태송신`을 사용한다. 실제 옵션이 2개 이상이면 정확한 옵션상태만 API로 변경·재조회한 뒤 A21 `옵션송신`을 사용한다. 논리 `SINGLE`은 기존 상품 판매상태 경로를 유지한다. 같은 B코드 안에서도 goodsKey별 경로가 섞일 수 있다.
- A21 브라우저 단계는 goodsKey를 한 번에 하나씩 직렬 처리한다. 옵션송신 화면에서는 과거 운영에서 성공했던 방식대로 실제 보이는 상단 `옵션송신` 라디오를 화면 순서로 먼저 클릭하고, 하단 옵션 전용 `선택`을 클릭한다. 내부 name/value 선택은 보조 fallback이다.
- HF69 패키지는 `v0.6.32`, 다운로드 경로는 `/api/shopling-stock-state-sync/download-hf69`였으며 아래 HF70으로 대체됐다. HF69의 goodsKey별 실제 옵션 수 분기와 API 상태·수량 readback 계약은 HF70에서도 그대로 유지한다.
- 아직 실 Shopling 상태 변경 카나리는 하지 않았다. 다음 안전 단계는 새 확장을 설치한 뒤 1옵션 쪼개기 1건과 다옵션 1건을 각각 실행해 API 상태·수량 readback, 선택된 A21 전송 종류, Commerce OS 접수 완료를 확인하는 것이다. 마켓 종결 결과는 Commerce OS 책임 범위가 아니지만 Shopling 전송 접수까지는 누락 없이 확인한다.

### Shopling stock-state HF70 correction (2026-11-05)

- HF69 실화면에서 A21 상단 `옵션송신` 라디오가 움직이지 않은 직접 원인을 재현했다. HF69는 각 라디오의 근거에 공유 상단 행 전체 문구를 포함했고, 그 행에는 `일반내용수정 / 상품판매상태송신 / 옵션송신`이 모두 들어 있었다. 따라서 세 라디오가 모두 옵션 후보가 된 뒤 화면상 맨 왼쪽 `일반내용수정`을 다시 선택했고, MAIN world 재검증도 같은 공유 행을 읽어 잘못 통과할 수 있었다.
- HF70은 라디오 자체의 정확한 label·cell·직접 parent만 근거로 사용한다. `옵션송신`이라는 문구와 라디오가 정확히 1:1인 후보가 하나일 때만 선택하며, 공유 행은 isolated world와 MAIN world 양쪽에서 근거로 사용하지 않는다.
- 현재 실행이 열기 전부터 존재한 동일 주소의 A21 팝업도 이번 팝업으로 오인할 수 있었다. HF70은 클릭 직전 팝업 ID 목록을 저장하고, 그 목록에 없으며 현재 전용 A21 목록 탭을 정확한 `openerTabId`로 가진 새 팝업만 작업 소유자로 인정한다. 옵션·단품 경로 모두 같은 규칙을 사용한다.
- goodsKey는 채널별로 여러 개가 정상이며 계속 한 개씩 직렬 처리한다. 이 직렬화는 느림의 원인이 아니라 한 goodsKey의 팝업·전송 결과가 다음 goodsKey와 섞이지 않게 하는 안전장치다. 쪼개기 판정과 전송 종류는 HF69의 goodsKey별 실제 옵션 수 규칙을 그대로 유지한다.
- 수정 패키지는 HF70 `v0.6.33`, 다운로드 경로는 `/api/shopling-stock-state-sync/download-hf70`이다. CI 고정 범위 166/166, TypeScript, 변경 파일 ESLint, Webpack 프로덕션 빌드와 124/124 정적 페이지 생성이 통과했다. 로컬 검증·실제 ZIP은 모두 207,394 byte였고 manifest `0.6.33`, service worker `background-v090.js`, ZIP SHA-256 `3e2cca4f8b2bbdcebebfb8912c8c00c53c14df04a255d0d7cce38dfbfc4fcbe0`를 확인했다. 실 Shopling 변경 카나리는 아직 실행하지 않았으며, 배포·설치 뒤 다옵션 1건에서 상단 `옵션송신`과 하단 옵션 전용 `선택`이 실제로 선택되고 Shopling 처리중/결과 화면이 시작되는지 확인해야 한다.

### Shopling stock-state HF71 correction (2026-11-05)

- HF70 실운영 카나리는 API 상태·수량 readback과 A21 상품코드 검색 뒤 상단 `옵션송신` 라디오 후보를 0개로 판단해 접수 전에 멈췄다. 공유 행 오인식을 막기 위해 같은 셀 문구만 허용했지만 현재 Shopling의 보이는 문구는 라디오의 인접 형제 또는 중첩 셀에 있어 실제 컨트롤을 놓친 것이 직접 원인이다.
- HF71은 정확한 인접 라벨을 먼저 사용하고, 없을 때만 최상단에 같은 높이로 놓인 정확히 3개 모드 라디오의 화면 순서를 검증해 오른쪽 라디오를 `옵션송신`으로 선택한다. 2개뿐이거나 중복 정확 라벨·모호한 배치이면 전송하지 않는다. isolated world 선택 뒤 MAIN world도 같은 규칙으로 다시 확인한다.
- 실패 시 최대 12개 라디오의 제한된 진단을 남긴다. HF69의 goodsKey별 실제 옵션 수 분기와 API 상태·수량 readback, HF70의 새 팝업 소유권, goodsKey 1개씩 직렬 처리, Shopling 처리중/결과 화면 시작을 완료로 보는 책임 경계는 그대로다.
- 수정 패키지는 HF71 `v0.6.34`, 다운로드 경로는 `/api/shopling-stock-state-sync/download-hf71`이다. CI 고정 범위 168/168, HF68~HF71 표적 회귀 20/20, TypeScript, 변경 파일 ESLint, `background-v091.js` 문법 검사와 Webpack 프로덕션 빌드(124/124 정적 페이지)가 통과했다. 배포·설치 뒤 다옵션 1건에서 상단 `옵션송신`과 하단 옵션 전용 `선택`, Shopling 처리중/결과 화면 시작을 실운영 카나리로 확인해야 한다.
- 빌드된 로컬 서버의 검증 응답과 실제 ZIP은 모두 208,976 byte였고 manifest `0.6.34`, service worker `background-v091.js`, ZIP SHA-256 `3EC56EF6DB19ADFD9CFF43AB5069FB9C92CCA991C13FA6BE8DF9C6E2212D485B`를 확인했다. 실제 Shopling 변경 카나리는 아직 실행하지 않았다.

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
