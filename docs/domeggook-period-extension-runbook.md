# 도매꾹 상품기간 자동연장 운영기록

## 목적

도매꾹 `상품등록관리 > 기간종료`에 나타난 승인완료 상품을 로컬 Commerce OS가 매일 확인하고, 운영자가 승인한 경우에만 최대 90일 범위로 연장한다.

입력 -> 처리 -> 출력은 다음과 같다.

`도매꾹 기간종료 목록 -> 정확한 상품번호/상태 확인 -> 0원·유료옵션 미연장 확인 -> 기간연장 -> 같은 목록 재조회 영수증`

## 2026-11-12 확인한 실제 계약

- 기간종료 URL: `https://www.domeggook.com/main/mySell/register/my_sellList.php?mode=OVER`
- 실제 기간종료 상품 수: 3개
- 실제 상품번호: `61942623`, `40449639`, `61924681`
- 목록은 `form[name="multiExecForUpdate"]`에 쉼표로 연결한 `nos`를 POST하여 `/main/mySell/register/my_sellUpdateItems.php`를 연다.
- 도매꾹 자체 스크립트도 승인완료 상태 `DONE`만 연장하도록 검사한다.
- 실제 연장 화면은 2026-11-12에 선택일 `2027-02-11`을 사용했을 때 상품별 종료일을 최대 `2027-02-10`으로 계산했다. 따라서 자동화의 90일 정책은 선택일 D+91을 사용하고, 상품별 계산값이 90일을 넘지 않는지 다시 검사한다.
- 현재 3개 상품에서 `2027-02-11`과 유료옵션 `아니오`를 선택한 실제 계산값은 상품기간 각 90일, 유료옵션 각 0일, 모든 수수료·결제·부족금액 0원이었다.
- 연장 화면의 초기 선택은 유료옵션 `예`이므로, 자동화는 반드시 `#noUpdateAdvT`를 눌러 `아니오`로 바꾸고 다시 계산한다.
- 최종 확인창은 `기간연장을 실행하겠습니까?`, 완료 신호는 `기간연장이 완료되었습니다`이다.
- 기존 Selenium 프로그램의 실패 로그는 상품 전체선택 체크박스 클릭이 상단 이벤트 배너 이미지에 가로막힌 `element click intercepted`였다.

## 안전장치

- 기본 실행은 드라이런이며 `--execute` 없이는 폼을 열거나 연장하지 않는다.
- 화면 좌표와 배너 위치를 사용하지 않는다. 도매꾹 페이지가 제공하는 폼, 상품번호, 상태, 완료 문구만 사용한다.
- 로그인 이탈, 상품번호 누락, `DONE` 이외 상태, 유료옵션 연장, 비용 미확인/0원 초과, 예상하지 못한 확인창에서 중단한다.
- 실행 후 같은 상품번호가 기간종료 목록에서 사라진 것을 확인해야 성공으로 기록한다.
- 실행 잠금과 원자적 영수증을 `local-agent/data/domeggook-period-extension/`에 남긴다.
- 전용 Chrome 프로필을 사용하며 도매꾹 비밀번호를 Commerce OS에 저장하지 않는다.

## 명령

드라이런:

```powershell
npm run local-agent:domeggook-period-extension
```

로컬 전용 Chrome을 포함한 드라이런:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\run-domeggook-period-extension.ps1
```

실제 실행은 최초 3개 상품 카나리 검증 뒤에만 사용한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\run-domeggook-period-extension.ps1 -Execute
```

매일 04:10 드라이런 작업 설치:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\install-domeggook-period-extension-task.ps1 -At 04:10
```

실제 자동연장은 `-Execute`를 명시한 작업으로만 열린다. 제거는 다음과 같다.

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\uninstall-domeggook-period-extension-task.ps1
```

## 아직 열지 않은 운영 경계

- 전용 Chrome 프로필의 도매꾹 로그인
- 현재 3개 상품에 대한 최초 실제 카나리
- 실제 자동연장 Scheduled Task 설치

위 세 단계 전까지 실제 도매꾹 상품 상태는 변경하지 않는다.
