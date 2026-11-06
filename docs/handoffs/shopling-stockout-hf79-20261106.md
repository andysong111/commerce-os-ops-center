# Shopling 재고상태 HF79 handoff — 2026-11-06

## 결론

- v0.6.41 `BBC4-3` 한 건 카나리는 goods key 묶음 검색과 A21 수정전송 팝업 열기까지 진행했지만, 팝업 하단이 `assignment 대기 · 응답 없음`에 머물러 3분 뒤 실패했다.
- HF78은 현재 `kt.shopling.co.kr`에 팝업 content script를 주입했지만, background의 옵션·단품 팝업 claim과 클릭 전 팝업 기준선 조회는 여전히 `a.shopling.co.kr`만 허용했다.
- 따라서 팝업 화면은 열렸으나 현재 작업의 OPTION/SINGLE 지시를 background에서 받을 수 없었다. Shopling 처리중/결과 화면은 시작되지 않아 Commerce OS 책임 경계에도 도달하지 못했다.

## 수정

- HF79/v0.6.42는 옵션·단품의 팝업 claim과 클릭 전 팝업 기준선 조회를 `a.shopling.co.kr` 및 `kt.shopling.co.kr` 양쪽에 적용한다.
- 정확한 현재 경로, 새 팝업 한 개, 기존 기준선 제외, 모호한 후보 거부 규칙은 그대로 유지한다.
- 같은 방식 goods key 최대 200개 묶음, API 상태·수량 readback, 실제 옵션 1개 쪼개기 상품의 일반 상품상태 전송, 묶음별 Shopling 처리중/결과 화면 시작 책임 경계는 변경하지 않는다.
- v0.6.41 이하는 새 실행을 차단하고 v0.6.42부터 허용한다.

## 검증 증거

- 실제 운영 주소 `kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml`에서 HF78 이전 claim 실패를 재현하고, HF79 적용 뒤 OPTION/SINGLE 배정 수령을 확인하는 회귀 fixture를 추가했다.
- 기존 팝업과 새 후보 복수는 계속 fail-closed임을 확인했다.
- HF70/HF72/HF78/HF79/실행계획기 집중 회귀 30/30, TypeScript `tsc --noEmit`, 변경 파일 ESLint가 통과했다.
- 로컬 Webpack 빌드는 Windows/OneDrive `.next` 생성 경로의 `EPERM`, 기본 Turbopack 빌드는 격리환경 보조 프로세스 기동 제한으로 중단됐다. 소스 컴파일 오류가 아니므로 Vercel 배포 빌드와 실제 다운로드 API에서 최종 검증한다.

## 남은 실운영 확인

- 운영 배포 후 v0.6.42를 설치하고 `BBC4-3` 한 건만 카나리한다.
- 성공 기준은 해당 묶음의 Shopling 처리중 또는 결과 화면 시작이다. 마켓별 최종 반영 성공은 Commerce OS 책임 범위가 아니다.
- 이 한 건이 통과하기 전에는 전체 큐를 실행하지 않는다.
