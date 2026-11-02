# Shopling 재고상태 수동 B코드 권한·직렬 전송 — 2026-11-02

## 확인된 운영 사고

- 통합 입력에서 사용자가 `BCG5-2`, `BCG5-3`, `BDE7-3`을 품절로 명시했지만, 화면 복구 뒤 일반 정확재고 큐가 Canonical 판매범위 불확실을 다시 적용해 세 지시를 예외 큐로 옮겼다.
- 같은 실행에서 `BAE4-1`이 Shopling 공유 작업자를 점유한 상태로 다음 B코드가 겹쳐 시작되어 `BCC6-2`가 시작 전에 거부됐다.
- 따라서 저장 성공은 Shopling 전달 완료를 보장하지 않았고, 화면 메모리에만 있던 수동 지시는 새로고침·재진입 뒤 권한을 잃었다.

## 변경된 권한 규칙

- 사용자가 통합 입력의 품절·판매중 칸에 넣은 B코드는 `DIRECT_OPERATOR_BCODE_COMMAND_V1` 내구성 명령으로 재고 이벤트와 같은 배치에 저장한다.
- 이 명령은 B코드, 목표상태, 상품형태, 전환시점이 현재 원장과 정확히 일치할 때만 실행 가능하다.
- 수동 B코드 명령은 Canonical 판매범위 불확실만 우회한다. 이전 Shopling 작업이 `STARTED/UNCERTAIN`, 모델번호 누락, 신원·상태·시점 불일치이면 계속 차단한다.
- 대표 모델번호는 Shopling 대상 검색에만 쓰며, 수동 상태지시의 권한 기준은 B코드다.

## 전송 순서

- 재고상태 전송은 최대 1 Lane으로 직렬화한다.
- 한 B코드의 Shopling 최종 결과가 원장에 기록된 뒤에만 다음 B코드를 배정한다.
- 실패·불확실 결과는 자동 재시도하지 않는다.
- 수동 명령이 실행 가능 큐에 있으면 같은 B코드를 Canonical 판매범위 예외로 중복 표시하지 않는다.

## 회귀 검증

- `tests/inventoryStockRetransmission.test.mjs`
  - 수동 명령이 Canonical 판매범위 불확실만 우회함
  - `STARTED/UNCERTAIN` 중복위험은 우회하지 않음
  - 실행 가능 수동 명령이 예외 큐에 중복 표시되지 않음
- `tests/inventoryStockShoplingLaunchPlan.test.mjs`
  - 확장 버전·상품형태와 무관하게 동시 배정은 1건뿐임
- `tests/inventoryStockUnifiedBatch.test.mjs`
  - 재고 이벤트와 수동 Shopling 명령을 한 번의 내구성 저장으로 기록함
- Inventory Stock Control CI가 위 회귀 파일들을 영구 실행한다.

## 다음 실제 검증

배포 후 새 B코드 수동 입력으로 한 건을 먼저 실행한다. Shopling 최종 완료 문구, Commerce OS `SUCCEEDED`, 다음 B코드 배정 순서를 각각 확인한 뒤 나머지를 진행한다. 이미 `STARTED`, `UNCERTAIN`, 또는 완료 결과가 있는 과거 작업은 새 명령으로 맹목 재시도하지 않는다.
