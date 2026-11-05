# Shopling stock-state HF76 handoff — 2026-11-06

## 운영 장애

- v0.6.38은 B코드마다 새 A21 창을 열었지만 content script가 실제 검색조건 준비 전에 `{ok:true, accepted:true}`를 먼저 회신했다. Commerce OS는 이를 작업 접수로 오인할 수 있었다.
- A21 작업창 소유권에 진행 단계(`LIST_START`, `SEARCH_SUBMITTED`)까지 포함되어, 같은 B코드·같은 goods key 묶음이 검색 직후 단계만 바뀌어도 다른 작업처럼 거부됐다. 이 때문에 goods key 검색 반복, 빈 A21 창, 수정전송 미실행이 나타났다.

## HF76 결정

- 패키지는 v0.6.39, service worker는 `background-v095.js`, canonical A21 작업기는 `content-a21-canonical-v019.js`다.
- A21 content script는 정확한 전용 목록창에서 전체기간·샵플링상품코드·쇼핑몰별판매가·200행·정확 goods key 검색어까지 실제로 준비한 뒤에만 강한 접수증을 회신한다.
- background는 owner key, goods key 전체 검색어, 개수, A21 역할, canonical v0.1.9가 모두 일치하는 접수증만 인정한다. 종전의 약한 `{ok:true, accepted:true}`는 실패로 닫는다.
- 작업창 소유권은 B코드 실행 ID + OPTION/SINGLE 방식 + 정렬된 goods key 묶음으로 고정하고, 진행 단계는 소유권에서 제외한다. 따라서 같은 창이 검색 전후에도 같은 실행으로 유지된다.
- 새 A21 창은 로딩 직후 최대 6초 기다린 뒤 정확한 A21 역할이 확인될 때만 배정한다.
- 호환 goods key는 계속 전송 방식별 최대 200개를 한 번에 검색·전송한다. API 상태·수량 readback, 1옵션 쪼개기 상품의 상품 판매상태 송신, Shopling 처리중/결과 화면 시작 책임 경계는 변경하지 않는다.

## 검증

- HF74~HF76·계획기 회귀 22/22, TypeScript, 변경 파일 ESLint, `background-v094.js`·`background-v095.js` 문법 검사가 통과했다.
- 실제 v0.6.38 ZIP을 부모로 로컬 HTTP 다운로드 API를 호출했다. 검증 JSON과 ZIP 다운로드 모두 200이었고, 생성 ZIP은 245,679 byte, manifest `0.6.39`, service worker `background-v095.js`, canonical `content-a21-canonical-v019.js`를 확인했다.
- background SHA-256은 `4861027dad450a62271ba5b534084a178522188ba849ad0285a9834bb43220fb`, canonical SHA-256은 `e1dfdd9bd84ace339e53e3471229cfd35df91fe9c1d7c716803fdafc14c4e36e`다.
- 기본 Turbopack 빌드는 보조 프로세스 기동 오류, Webpack 빌드는 OneDrive `.next` 하위 디렉터리 생성 `EPERM`으로 중단됐다. 타입·라우트 컴파일 오류는 아니며 로컬 개발 서버에서 실제 다운로드 라우트와 ZIP을 별도로 검증했다. 운영 배포 빌드에서 재확인한다.
- 실제 Shopling 쓰기는 운영 배포·v0.6.39 설치 뒤 사용자의 B코드 한 건 카나리에서 확인한다. 성공 기준은 현재 B코드의 Shopling 처리중 또는 결과 화면 시작이며 마켓별 최종 반영은 범위 밖이다.
