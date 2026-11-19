# Shopling stock-state HF101 — 실행 중 최초 팝업 소유권 보존

## 실제 사건

- v0.6.60을 설치하고 `BCC5-2` 판매중 한 건을 다시 실행했다.
- 정확한 A21 목록창과 상품수정 팝업은 열렸지만, 판매중 라디오와 원본 `상품수정 송신`은 실행되지 않았다.
- Commerce OS는 `HF92_EXACT_POPUP_OWNER_CHANGED`, 단계 `A21_LIST`, 성공 0/1로 안전 중단했다. 외부 Shopling 전송 접수 영수증은 없다.

## 확인된 원인

- HF100의 초기 소유권 검사는 정상 팝업과 HF90 영수증을 정확히 확인했다.
- 초기 검사 뒤 팝업 프레임을 읽는 짧은 구간에 같은 `BCC5-2` 준비가 다시 저장됐다.
- 이 늦은 저장은 같은 job·execution·goods-key 묶음이었지만, 초기 검사 때 존재하던 HF90 팝업 영수증과 `A21_POPUP` 작업 필드를 오래된 상태로 덮어썼다.
- 최종 검사에는 정상 팝업을 증명할 초기 영수증이 남지 않아 파란 전송 직전에 차단됐다. 여러 B코드 병렬 실행, 판매중·품절 혼합, 판매종료(E) 제외는 직접 원인이 아니다.

## HF101 수정 경계

- v0.6.61은 HF100 초기 검사에서 확인한 정확한 HF90 소유 증거를 그 한 번의 함수 실행 안에서 변경 불가능한 스냅샷으로 보존한다.
- 최종 검사에서 라이브 소유 필드가 같은 작업의 늦은 재저장으로 사라졌을 때만 이 스냅샷을 사용한다.
- 현재 jobId, executionId, 상품종류, 정규화된 goods-key 묶음, A21 목록창, 팝업 탭, assignment가 초기 스냅샷과 모두 같아야 한다.
- 다른 goods-key, 다른 목록창, 다른 팝업 claim, 다른 실행이면 `HF101_IN_FLIGHT_POPUP_OWNER_CHANGED`로 외부 전송 0회 차단하고 하위 원인 코드도 화면 결과에 남긴다.
- B코드 한 건씩 직렬 실행, 판매종료(E) 제외, 원본 Shopling 전송 접수까지를 Commerce OS 책임 완료로 보는 정책은 바꾸지 않는다.

## 자동 검증 기준

- 실제 `BCC5-2` goods-key 묶음에서 초기 검사를 통과한 뒤 HF90·A21_POPUP 필드가 오래된 같은 작업 저장으로 사라지는 사건을 재현한다.
- 같은 작업: 원본 Shopling commit 정확히 1회, `WAIT_A21_RESULT` 진입.
- 평상시 작업: 기존과 동일하게 commit 정확히 1회.
- goods-key 변경, 목록창 변경, 다른 팝업 claim: commit 0회.
- 이 회귀는 `tests/shoplingStockStateHf101.test.mjs`이며 `.github/workflows/shopling-stock-state-sync-ci.yml`의 HF101 전용 단계에서 실행한다.

## 로컬 검증 영수증

- 변경 영향 테스트: 195/195 통과.
- TypeScript, 변경 파일 ESLint, `git diff --check`: 통과.
- Next.js 운영 빌드(`next build --webpack`): 통과.
- 로컬 운영 서버에서 `/api/shopling-stock-state-sync/download-hf101?verify=1`과 실제 ZIP을 각각 읽어 대조했다.
- ZIP: 276,275 bytes, manifest `0.6.61`, service worker `background-v101.js`.
- 패치 background SHA-256: `06cb5aac9d0d1d666640424acad70a1c81d8ced2cc85ec89e1f4eb75fd65ef60`.
- service worker SHA-256: `7f90fbcb48203095bc96cc85f94f423739071fbf00698583be608c8d6d172833`.
- ops SHA-256: `952432441fcb4e034855386414a10a2e1ee2586550c8f4d408533c8f6899d04a`.
- 서버 검증 응답과 실제 ZIP 내부 3개 파일 해시가 모두 일치했다.

## 운영 카나리

1. 현재 열려 있으나 전송하지 않은 `BCC5-2` A21 팝업을 닫고 수동 전송하지 않는다.
2. 운영 배포 뒤 v0.6.61 ZIP으로 확장 폴더를 교체하고 Chrome 확장 화면에서 다시 로드한다.
3. Shopling 로그인과 Commerce OS `자동화 연결됨 · v0.6.61`을 확인한다.
4. 이미 성공한 건은 제외하고 미전송 `BCC5-2` 한 건만 다시 실행한다.
5. 원본 전송 접수와 Commerce OS `1/1`을 확인하기 전에는 다건 실행을 재개하지 않는다.
