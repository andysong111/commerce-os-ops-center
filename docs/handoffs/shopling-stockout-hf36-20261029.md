# Shopling 품절 HF36 (`v0.6.4`) — 2026-10-29

## 운영 확인 결과

- `BCB6-2`는 Shopling A6에서 옵션 8개가 모두 `품절`로 바뀌었고 수정 시각은 2026-10-29 10:58 전후로 확인됐다.
- Shopling A21 옵션 전송도 성공했다. 따라서 이 건은 Shopling 상태 반영 실패가 아니며 다시 실행하면 안 된다.
- 반면 Commerce OS에는 `SEARCH_DATE_FIELDS_AMBIGUOUS`, `SINGLE_EXCEPTION`이 남았다. 실제 외부 변경 성공과 내부 최종 판정이 어긋난 허위 실패다.

## 원인과 변경

- 같은 Shopling 탭 안의 여러 프레임이 A6 화면으로 응답할 수 있는데, 기존 coordinator의 page-ready 경로는 탭만 확인해 실행 프레임을 다시 지정할 수 있었다.
- 그 결과 지정된 프레임은 옵션 8개의 품절·전송을 완료했지만, 지정되지 않은 프레임의 날짜 입력 탐지 실패가 먼저 최종 실패로 기록될 수 있었다.
- HF36은 page-ready와 step-result를 모두 coordinator가 지정한 정확한 `tabId + frameId`에서만 수락한다. 다른 프레임의 성공·실패 응답은 `STOCK_SYNC_UNASSIGNED_FRAME_IGNORED_HF36`으로 무시한다.
- Commerce OS 최소 확장 버전은 `v0.6.4`이며 `v0.6.3` 이하는 실행을 차단한다. HF35의 `2023-01-01~KST 오늘`, A6 상품행 식별, 수량 보존, 옵션상태 API, A21 전송 규칙은 그대로 유지한다.

## 검증

- 실제 사고 형태인 `지정 프레임 7 성공 + 비지정 프레임 0 날짜 모호 실패` 회귀 테스트에서 비지정 실패가 무시되고 지정 프레임 결과만 coordinator에 전달됨을 확인했다.
- Inventory Stock Control 관련 테스트 91건 통과.
- Shopling 재고상태 관련 테스트 37건 통과.
- TypeScript typecheck와 변경 파일 ESLint 통과.
- 프로덕션 빌드 통과. 빌드된 서버의 `/api/shopling-stock-state-sync/download-hf36?verify=1`에서 `v0.6.4`, 정확 탭·프레임 소유권, 비지정 page-ready·step-result 무시, HF35 보호 규칙 유지를 확인했다.

## 배포 후 단일 운영 검증

1. HF36을 배포하고 `v0.6.4` ZIP으로 확장을 교체한 뒤 Commerce OS와 Shopling 탭을 새로고침한다.
2. 이미 품절 완료된 `BCB6-2`는 재실행하지 않는다.
3. 대기 목록의 다른 B코드 한 건만 실행한다.
4. Shopling 품절·A21 전송과 Commerce OS 성공 판정이 함께 완료되고 해당 건이 대기 목록에서 빠지는지 확인한다.
5. 이 단일 검증을 통과하기 전에는 대기 15건 전체 자동처리를 재개하지 않는다.

`BCB6-2`의 기존 예외는 실제 실패가 아니라 과거 허위 판정이다. 배포 후 큐 재조회 또는 별도 대사로 정리하되 Shopling 쓰기를 다시 실행하지 않는다.
