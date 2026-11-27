# Commerce OS 모바일 업무센터

## 운영 흐름

- 운영자 휴대폰의 `/mobile-work-center` → Supabase에서 실제 로그인 사용자 확인 → 모바일 전용 대기열 → 켜져 있는 Windows의 작업 수신기 → 기존 로컬 업무센터의 실행 결과 확인.
- PC의 43121·43122·9222는 계속 loopback에만 둔다. 모바일 웹에는 로컬 토큰, 자격증명, 원본 로그를 보내지 않는다.
- 새 요청은 한 번에 하나만 보낸다. PC가 수신한 요청의 입력값은 대기열의 현재 요청에서 제거한다. 연결이 끊겨 결과가 모호하면 실행을 반복하지 않고 작업자가 결과를 확인할 때까지 잠근다.
- 1688 발주차시 선택과 미결제 주문의 확인 문구를 유지한다. 11번대 업무는 전용 Chrome의 업무센터 탭을 정확히 하나 식별한 뒤 기존 온돌패스 확장 메시지와 대조 결과를 사용한다. 마켓 인증·검토와 실제 결제·입고확정 등 기존의 수동 단계는 그대로 둔다.

## 적용 순서

1. 운영 스키마 승인 후 별도 대기열 테이블 1개를 생성한다. RLS를 활성화하고 브라우저 역할에는 권한을 주지 않는다. 기존 주문·재고·발주 스키마에는 변경이 없다.
2. Vercel에 운영 환경의 실제 Auth 사용자 UUID인 `MOBILE_WORK_CENTER_OWNER_ID`와 새 전용 비밀 `MOBILE_WORK_CENTER_AGENT_TOKEN`을 등록한다. 운영 도메인을 바꿨을 때만 `MOBILE_WORK_CENTER_ORIGIN`을 지정한다. 두 설정이 없으면 원격 수신은 잠긴다.
3. 같은 전용 비밀을 전달해 `local-agent/mobile-work-center/install-windows.ps1`을 운영 Windows 계정으로 실행한다. Windows 사용자 암호화(DPAPI)로 저장한다. 첫 설치에서 `-StartNow`만 사용하면 연결 시험만 가능하다.
4. 운영 링크에서 미로그인·권한 없는 요청이 차단되는지 확인한다. 운영자가 로그인한 뒤 PC 연결 시험이 성공하면 작업 수신기만 `-AllowBusiness -StartNow`로 전환한다. 설치는 실제 주문·송장·출금 작업을 시작하지 않는다.
5. 중단할 때는 현재 요청 결과를 먼저 확인한 뒤 모바일 수신기 예약 작업을 정지하거나 전용 토큰을 폐기한다.

## 검증

- 샵플링 로그인이 만료되면 Windows 수신기가 같은 요청 번호로 PC의 인증 결과를 기다린다. 카카오톡 확인 링크 발송과 사람의 답변 처리는 기존 전용 Chrome 로그인 기능을 사용한다. 인증 대기 중에는 로컬 업무를 예약하지 않는다. 인증 성공 후 원래 요청을 1회만 전달하고, 인증 만료 또는 실패 시 실행을 종료한다.
- 독립 배포되는 Windows 로컬 업무센터에는 `local-agent/mobile-work-center/shopling-login.patch`를 해당 체크아웃에서 `git apply --check` 후 적용한다. 보호된 POST 경로는 업무 실행 입력을 받지 않으며, 유효하지 않은 요청 번호에 `MOBILE_LOGIN_ID_INVALID`를 반환한다. PC의 기존 자동 로그인과 카카오 발송 승인 설정을 사용한다.

- `node --test tests/mobileWorkCenter.test.mjs`로 확인 문구, 목록 외 작업 차단, 입력 고정, 재전송 방지, 정상/불명확 완료, 대상 Chrome 탭 선택을 검사한다. GitHub Actions CI의 `Test mobile Work Center request safety` 단계에 포함했다.
- `node tests/fixtures/mobileWorkCenterBrowserFixture.mjs`는 Supabase 세션·대기열만 로컬 격리 환경에 대체한다. 실제 Windows 업무센터에는 연결 시험용 읽기 요청만 보내고 거래 버튼은 실행 전에 차단한다.
- 테스트 브라우저에서 미로그인 화면, 합성 계정 로그인, Windows 연결 시험 완료, 출금 확인 체크 전 실행 잠금, 390px 너비 레이아웃을 확인했다. 운영 배포, 실제 휴대폰 홈 화면 추가와 실제 거래는 검증에 포함하지 않았다.
- 운영 적용 준비 중 실제 Windows 상태 응답의 완료 식별자가 `runId`임을 확인했다. 동일 실행 ID와 업무 ID를 확인하도록 수신기를 고치고, Windows `needs_attention` 결과의 재실행 차단을 회귀 검사에 추가했다.
- 운영 PC의 5-5 버튼은 대조 결과가 맞으면 입고 원가에 반영할 수 있다. 모바일에서도 점검을 기본값으로 두고 실제 반영 시 별도 확인을 받는다.
