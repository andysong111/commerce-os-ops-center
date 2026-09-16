# 2026-10-01 발주 준비 · 인계 기준

## 승인 경계

9월 16일 지시는 선행 개발 승인이다. 10월 1일은 계획일일 뿐 실제 주문·결제·상품마스터 변경 승인이 아니다.
새 `/purchase-cycle-preflight`는 GET 기반 읽기 전용 화면이다. 승인 토큰, 예약, 내부 Draft, 발주 약정, 실제 주문을 생성하지 않는다.
기존 빠른 발주안과 공식 원장 게이트는 변경하거나 우회하지 않는다. 기존 경로가 존재한다는 사실은 10월 1일 실운영 통과를 뜻하지 않는다.

## 이번 변경

- 5: 실제 promotion gate의 candidate request/event/plan 지문을 사용한다. `evidence.report.candidateSalesRequestId`라는 존재하지 않는 필드를 만들거나 검사하지 않는다.
- 6: 동일 후보에 대한 기존 full readback 대사가 VERIFIED인 경우만 완료로 인정한다. COMPLETED를 새 쓰기 권한으로 전환하지 않는다.
- 7~8: 기존 inventory priority에서 확정 입고원가·VERIFIED 재고를 가진 발주 후보만 소량 검증 후보로 분리한다. 캐시 원가, 초기 0, 미확인/PROVISIONAL 재고를 실제 실행 근거로 승격하지 않는다. 창고 전수 실사를 요구하지 않는다.
- 9: 기존 priority가 이미 읽은 canonical shadow의 출처 지문·월간 예산·비교 조건을 전달한다. 새 화면을 위해 shadow를 중복 실행하지 않는다.
- 10: 목표 월/전월 마감, 12시간 판매자료 신선도, 원본 조회 전후 고정, 현금/월간 예산 상한, SKU 수·품목별 수량 상한을 검증한다. 기존 엔진이 산출한 MOQ/박스단위 수량을 임의 축소하지 않고 한도 초과 행을 제외한다.
- 11: 기존 purchaseCycleClosureCore에 주문→부분입고→원가 반영→재고→판매상태→원가/자금 마감 모의 회귀 검증을 추가한다. 모의 통과는 실제 발주·입고 성공 증거가 아니다.

## 남겨둔 실제 운영 조건

1. 현재 후보의 원본/대조/evidence context와 공식 반영 게이트를 운영에서 통과시킨다. 이전 `EVIDENCE_SOURCE_NOT_PINNED` 일회성 검증 스크립트의 성공을 이번 화면 추가만으로 주장하지 않는다.
2. Product Master 1건 canary, 같은 계획 full apply, 재조회 대사를 기존 승인 경로로 수행한다.
3. 발주 대상 SKU의 확정 원가 및 재고 근거를 확보한다. 실제 DB 값을 이 개발에서 채우거나 변경하지 않는다.
4. `claim-auxiliary` 및 동일 분석시점 기존 방식 비교 등 상위 blocker는 계속 표시하며 승인을 위한 준비 완료로 숨기지 않는다.
5. 10월 1일에는 9월 마감 매출예산과 그날의 신선한 판매/재고/미입고로 재계산한다. 9월의 발주안을 10월에 재사용하지 않는다.
6. 승준이 실제 금액·품목·수량을 최종 승인한 뒤 기존 발주 경로에서 다시 검증한다. 이 화면은 실행 API나 승인서가 아니다.
7. 실제 입고·원가·재고 반영까지 한 사이클의 운영 증거가 있어야 11구간 완료로 기록한다.

## 테스트 및 배포 판정

`node --experimental-strip-types --test tests/purchaseCyclePreflight.test.mjs tests/purchaseCyclePreflightClosure.test.mjs`

전용 CI는 운영 계정/secret 없이 테스트·lint·전체 앱 build를 수행한다.
PR CI, 실제 Vercel 배포, 운영 데이터 점검 결과는 각각 별도 증거로 기록한다. 코드·모의 검증 통과를 운영 PASS로 적지 않는다.
카드 첫 진입은 자료를 조회하지 않는다. 버튼을 눌러 1회 조회하며 새 cron/polling/API 비용 루프는 없다.

## 다음 채팅이 확인할 항목

이 문서와 PR의 실제 merge/deploy 상태, 현재 후보 requestId/event/plan 지문, 5/6구간 원장 검증 결과, 미리보기의 blockers/reviewBlockers를 읽는다.
코드에서 PASS를 강제하거나 누락된 원가·재고를 0/추정치로 채워 진행하지 않는다.
