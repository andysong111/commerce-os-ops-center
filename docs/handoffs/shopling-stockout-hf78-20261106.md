# Shopling 재고상태 HF78 handoff — 2026-11-06

## 결론

- v0.6.40 실운영 카나리는 `FAILED · Shopling 본문 클릭 브리지 응답이 없어 상품 수정전송을 완료하지 못했습니다.`로 끝났다.
- 실제 A21 작업 창은 `https://kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml`이지만, v0.6.40 manifest의 content script 대상은 `https://a.shopling.co.kr/*`뿐이었다.
- 이 때문에 검색·API 단계는 동작해도 현재 `kt` A21 창에는 MAIN-world 클릭 브리지가 주입되지 않아 빨간 `상품 수정전송` 클릭 응답을 받을 수 없었다.

## 수정

- HF78/v0.6.41 ZIP 생성 시 모든 Shopling content script와 MAIN-world entry를 `a.shopling.co.kr` 및 `kt.shopling.co.kr` 양쪽에 주입한다.
- 일반 A21, 옵션 팝업, 결과 화면, 단일 옵션 팝업의 match/exclude 범위를 함께 확장한다.
- goods key 최대 200개 묶음, API 상태·수량 readback, 실제 옵션 1개 상품의 일반 상품상태 전송, Shopling 처리중/결과 화면 시작 책임 경계는 그대로 유지한다.
- v0.6.40 이하는 운영 실행을 차단하고 v0.6.41부터 허용한다.

## 검증 증거

- 실제 운영 URL과 같은 `kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml` 회귀 fixture를 추가했다.
- 관련 회귀 테스트 77/77 통과, TypeScript 통과, `git diff --check` 통과.
- 운영 빌드에서 컴파일·TypeScript·124/124 정적 페이지 생성 통과.
- 로컬 실제 다운로드 API의 검증 JSON과 ZIP 모두 200. manifest `0.6.41`, host permissions와 모든 A21/팝업/result content script가 `a`와 `kt` 양쪽을 포함함을 확인했다.
- manifest SHA-256: `62ea4d44ee21b00e79ed0883c8e461a224cbc5c21f8038543f7402a389734239`.
- 단일 옵션 팝업 스크립트 SHA-256: `4b63225a505da5499c9e67d9f9eec21c81ceadb5d8008a357769a1f4a36f9448`.

## 남은 실운영 확인

- 배포 후 v0.6.41을 설치하고 B코드 한 건만 카나리한다.
- 성공 기준은 해당 B코드의 Shopling 처리중 또는 결과 화면 시작이다. 마켓별 최종 반영 성공은 Commerce OS 책임 범위가 아니다.
