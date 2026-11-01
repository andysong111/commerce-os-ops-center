# Shopling 재고상태 재전송 사고 기록 — 2026-11-02

## 책임 경계

- Commerce OS 책임: 사용자가 지시한 각 B코드의 판매중·품절 전환을 Shopling에 빠짐없이 전달하고, Shopling의 최종 완료 증거를 Commerce OS 원장에 저장한다.
- Shopling 책임: Shopling이 각 마켓으로 보낸 뒤 마켓이 반환한 성공·실패 결과와 실제 마켓 반영.
- 마켓 실패가 있더라도 Shopling 최종 완료 footer가 확인되면 Commerce OS→Shopling 전달은 완료로 기록하고, 마켓 실패 수는 별도 참고 증거로 보존한다.

## 확인된 원인

1. 최초 BCG5-2·BCG5-3 실패는 Shopling 로그인 만료 상태에서 시작해 Shopling 쓰기 전에 종료됐다.
2. 2-Lane 배치에서 Lane 1 완료와 Lane 2 시작 사이에 MV3 서비스워커가 절전되면, 단일 작업에 묶인 기존 watchdog이 이미 해제되어 Lane 2 시작을 깨울 이벤트가 없었다.
3. BBD8-1 Lane 2는 Shopling 최종 footer `상품상태 변경 전송이 완료되었습니다.`와 결과 108건(성공 83·실패 25)을 표시했지만, 옵션 결과 관찰기가 이 공용 footer를 옵션 완료로 분류하지 않아 Commerce OS 원장에는 STARTED가 남았다.

## 수정

- v0.6.15/HF50: 로그인 사전점검과 재고 이력 불변 Shopling-only 재전송을 추가했다.
- v0.6.16/HF51:
  - Lane 2 미시작 체크포인트를 깨우는 write-free alarm을 추가했다. 실제 시작 소유자는 기존 idempotent HF28 coordinator 하나로 유지한다.
  - 공용 `상품상태 변경 전송이 완료되었습니다.` footer를 활성 작업의 OPTION/SINGLE 형태에 따라 완료로 수용한다.
  - BBD8-1은 고정된 21건 재전송 요청번호, 작업 ID, 현재 상품형태·품절·재고 0, STARTED/UNCERTAIN 상태, 확인된 83/25 결과가 모두 맞을 때만 Shopling 재전송 없이 원장 완료를 복구한다.

## 재전송 요청

- requestId: `owner-request-20261101140024695-b4d64f55-042d-4a04-9f7b-6dabf75f3969`
- 품절 18건: BCG5-2, BCG5-3, BAE4-1, BAF1-1, BBA7-1, BBB3-2, BBB4-3, BBC3-3, BBD3-1, BBD8-1, BCA5-1, BCB6-2, BCC2-1, BCC5-3, BCC6-1, BCF8-3, BDE7-3, BZZ341-1
- 판매중 3건: BBB8-1, BCC5-1, BCC5-2
- 판단 보류 제외: BCC6-2, BAB3-1, BCB2-1, BDB2-1

## 검증

- 관련 회귀 테스트 23개 통과.
- TypeScript `tsc --noEmit` 통과.
- `next build --webpack` 프로덕션 빌드 통과.
- 전체 테스트는 이번 변경과 무관한 기존 Windows 경로·오래된 화면 계약 실패가 남아 있어 녹색 기준으로 사용하지 않았다.
