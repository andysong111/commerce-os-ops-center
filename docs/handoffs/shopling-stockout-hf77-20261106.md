# Shopling 재고상태 HF77 handoff — 2026-11-06

## 결론

- v0.6.39 실운영 `BBC4-3` 카나리는 API 상태·수량 재검증, goods key 14개 묶음, A21 검색 64행 선택까지 정상 완료했다.
- 실패 코드는 `A21_MODIFY_SEND_MAIN_CLICK_TIMEOUT`이었다. 정확한 빨간 `상품 수정전송` 대상에 표식까지 했지만 MAIN-world 클릭 브리지의 응답이 없었다.
- 직접 원인은 `main-shopling.js`가 Chrome `document_start`에서 `document.documentElement`가 아직 `null`인 경우 `MutationObserver.observe(null, ...)`를 호출해 예외가 났고, 그 아래의 `commerce-os-stock-main-click` 요청 수신기를 설치하지 못한 것이다.

## 수정

- HF77/v0.6.40 ZIP 생성 때만 MAIN-world 스크립트를 패치한다. 과거 버전의 공개 원본 파일은 변경하지 않는다.
- DOM 루트가 없으면 감시기 시작을 `DOMContentLoaded`까지 미루되, 스크립트 실행은 중단하지 않아 클릭 요청 수신기와 빨간 버튼 클릭 경로가 살아 있게 한다.
- HF72의 전송 방식별 goods key 최대 200개 일괄 묶음, API 상태·수량 readback, 논리 옵션+실제 옵션 1개의 상품상태 전송 분기, Shopling 처리중/결과 화면 시작 책임 경계는 그대로 유지한다.
- v0.6.39 이하는 운영 실행을 차단하고 v0.6.40부터 허용한다.

## 검증 증거

- 실제 실패 재현: DOM 루트가 없는 `document_start` fixture에서 v0.6.39 MAIN 스크립트는 예외가 나며 클릭 수신기가 설치되지 않는다.
- 수정 후 같은 fixture: 클릭 수신기 1개가 먼저 살아 있고, DOM 생성 뒤 감시기가 한 번 시작되며 표식된 대상 클릭과 성공 응답이 각각 한 번 발생한다.
- HF69~HF77 및 재고/API 영향 범위 회귀 54/54 통과, TypeScript와 변경 파일 ESLint 통과.
- `next build --webpack` 컴파일·TypeScript·124/124 정적 페이지 생성 통과.
- 로컬 실제 다운로드 API의 검증 JSON과 ZIP 모두 200. manifest `0.6.40`, MAIN entry `main-shopling-v002.js`, `world=MAIN`, `all_frames=true`, `run_at=document_start`, ZIP 245,749 byte를 확인했다.
- MAIN 스크립트 SHA-256: `4bae6604c9aab7bd58d3ebd9d6bc2265feda29c7bf07ce17b178cbc15d07018b`.

## 남은 실운영 확인

- 배포 후 v0.6.40을 설치하고 B코드 한 건만 카나리한다.
- 성공 기준은 해당 B코드의 Shopling 처리중 또는 결과 화면 시작이다. 마켓별 최종 반영 성공은 Commerce OS 책임 범위가 아니다.
