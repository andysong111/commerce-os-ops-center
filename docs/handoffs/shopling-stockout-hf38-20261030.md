# Shopling 재고상태 HF38 운영 인계 (2026-10-30)

## 실제 장애

- v0.6.5 HF37에서 A6 메뉴 클릭은 성공했고 `prodBulkOptLst.phtml?popup=Y` 팝업도 실제로 열렸다.
- 기존 coordinator는 새 팝업을 보지 않고 launcher 탭의 모든 frame만 반복 검사했다.
- launcher는 `A21_LIST`로 분류되어 45초 뒤 `옵션대량수정 자동진입 실패`로 안전 중단됐다.
- Shopling 상품 상태 변경이 확인된 건은 0건이다.

## HF38 변경

- 버전: v0.6.6 HF38
- 메뉴 클릭 직전 존재한 Shopling 탭은 모두 baseline으로 고정한다.
- baseline에 없고, 현재 launcher를 opener ancestry로 가지며, 정확한 stage role인 새 팝업만 후보로 인정한다.
- 후보가 정확히 1개일 때만 작업 frame으로 소유권을 기록한다.
- 오래된 A6 탭, opener가 다른 탭, 후보 2개 이상은 상품 변경 전에 fail-closed 한다.
- 같은 메뉴는 한 준비 실행에서 최대 한 번만 클릭한다.

## 검증

- 실장애 fixture: launcher=A21_LIST, A6=별도 새 탭 → 새 A6 탭 연결 성공.
- stale A6 탭이 함께 있어도 채택하지 않음.
- 새 A6 팝업 2개 → `HF38_FRESH_POPUP_AMBIGUOUS` 안전 차단.
- 관련 회귀 46개 통과, TypeScript 통과, 변경 파일 lint 통과.
- Next.js production build는 Turbopack sandbox process 오류 후 webpack 빌드로 통과.
- 로컬 production route verify와 실제 ZIP 생성 통과:
  - `version=0.6.6`
  - `zipBytes=148216`
  - `coordinatorSha256=c009cbcabce6e9e2bc324a58710a7107206c026019fbe7b214b3c5e68f2c399c`

## 운영 재개 순서

1. PR/운영 배포 완료 확인.
2. v0.6.6 HF38 ZIP 다운로드·압축 해제·Chrome 확장 교체.
3. Commerce OS에서 확장 `v0.6.6` 연결 확인.
4. `BBB4-3` 1건 카나리 실행 후 Shopling 최종 결과와 Commerce OS `SUCCEEDED`를 함께 확인.
5. 카나리 통과 후 나머지 품절 큐를 진행한다.
6. `BCC5-1`, `BCC5-2`는 판매중 전환으로 실행하고 각각 최종 결과를 확인한다.
7. `BBB3-2`는 이전 HF37 실패 예외 건이므로 자동 재시도하지 말고 HF38 카나리 통과 뒤 별도 재배정한다.
