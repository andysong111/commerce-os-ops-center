# Shopling 품절 HF33 (`v0.6.1`) — 2026-10-28

## Incident

- `BBB4-3` 품절 입력 뒤 Commerce OS가 성공으로 표시했지만 Shopling A6의 정확 12개 행은 계속 `판매중`이었다.
- `v0.6.0`으로 재시도하자 외부 상태를 바꾸기 전에 `SEARCH_DATE_FIELDS_AMBIGUOUS`로 안전 중단했다.
- 원인: HF31/HF32가 A6 `s_dt`·`e_dt`를 빈칸으로 만든 직후 공통 검색정책이 값이 있는 날짜 입력 두 개를 다시 찾도록 되어 있어 서로 모순됐다.

## Change

- HF33 `v0.6.1`은 A6 등록일을 `20220101`부터 KST 오늘까지 명시적으로 설정하고 값 재확인 후 검색한다.
- 정확 B코드 행의 goods key/option id는 체크박스 값(`goodsKey_optionId`)을 우선 사용하고 행 텍스트를 안전한 보조 경로로 사용한다.
- 발견된 정확 B코드 행 전체를 기존 Shopling 옵션상태 API(`SOLD_OUT -> C`)에 넘기며, 수량 보존과 수정 후 재조회 검증은 그대로 유지한다.
- 알려진 결함이 있는 `v0.5.9`와 `v0.6.0`은 Commerce OS 실행 게이트에서 차단한다.
- 운영 화면에는 `v0.6.1`만 다운로드 대상으로 노출한다.

## Verification

- 실제 로컬 Next.js 엔드포인트에서 ZIP 생성 성공.
- 생성 ZIP: manifest `0.6.1`, service worker `background-v072.js`, 41개 파일.
- 생성 worker에서 날짜 수정, 정확 행 식별, 기존 창고 host 권한 보존, 빈 날짜 대입 제거를 확인했다.
- 재고 회귀 테스트 77건 통과.
- 변경 파일 ESLint 통과.
- `tsc --noEmit` 통과.
- `next build --webpack` 통과. 기본 Turbopack 빌드는 로컬 샌드박스의 자식 프로세스 생성 오류로 실패했으며 코드 오류가 아니다.

## Remaining live check

1. 운영 배포 후 `v0.6.1` ZIP을 설치한다.
2. Commerce OS와 Shopling A6 탭을 새로고침한다.
3. Commerce OS에서 `BBB4-3` 품절을 한 번 실행한다.
4. A6에서 `BBB4-3` 정확 12개 행이 모두 품절로 보이는지 확인한다.
5. 성공 메시지는 Shopling 옵션상태 API 재조회가 `C`로 확인된 뒤에만 인정한다. 연결 마켓 실패 건수는 별도 자문 정보로 취급한다.
