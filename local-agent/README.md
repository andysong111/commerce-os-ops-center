# Commerce OS Local Agent

Windows PC에서 ChatGPT Work/Codex와 독립적으로 실행되는 1단계 로컬 에이전트입니다. 기본 동작은 로컬 JSON 기록이며, 상품 가격/재고/판매상태를 변경하지 않습니다.

## 수집 내용

- `local-agent/data/latest-status.json`
  - 현재 시각, PC/Agent 상태, Chrome 실행 여부
  - Chrome DevTools 연결 가능 여부
  - Shopling 탭 존재 여부와 안전 처리된 URL
  - A21 확장/페이지 감지 가능 범위의 신호
  - 마지막 오류 코드, 현재 자동화 단계
- `local-agent/data/diagnostics/`
  - URL, GOODSKEY, 검색 드롭다운 값, 검색 입력값
  - 체크박스 이름/checked 상태 전체
  - 검색 결과 건수, 핵심 DOM 구조
  - 가능하면 스크린샷 PNG
  - timestamp, agent version

## 수동 실행

```powershell
node .\local-agent\bin\commerce-os-local-agent.mjs status
node .\local-agent\bin\commerce-os-local-agent.mjs daemon
node .\local-agent\bin\commerce-os-local-agent.mjs diagnose --goods-key 123456
```

## Windows 자동 시작

로그인 시 Scheduled Task로 에이전트를 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\install-startup-task.ps1 -StartNow
```

제거:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\uninstall-startup-task.ps1
```

로그는 `local-agent/logs/agent.log`에 남습니다.

## Shopling 탭/DOM/스크린샷 감지

Chrome 탭 URL과 DOM 진단은 Chrome DevTools 포트가 열려 있을 때만 가능합니다. 필요하면 별도 Commerce OS Chrome 프로필을 다음처럼 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\start-commerce-chrome-debug.ps1
```

기본 DevTools 엔드포인트는 `http://127.0.0.1:9222`입니다. 변경하려면 `COMMERCE_OS_CHROME_DEBUG_URL`을 설정합니다.

## Supabase 업로드

기본값은 비활성화입니다. 로컬 파일 저장은 항상 수행합니다.

```powershell
$env:COMMERCE_OS_LOCAL_AGENT_UPLOAD = "1"
$env:COMMERCE_OS_LOCAL_AGENT_HEARTBEAT_TABLE = "commerce_os_local_agent_heartbeats"
$env:COMMERCE_OS_LOCAL_AGENT_DIAGNOSTIC_TABLE = "commerce_os_local_agent_diagnostics"
node .\local-agent\bin\commerce-os-local-agent.mjs status
```

테이블이 필요하면 `local-agent/supabase/schema.sql`을 검토 후 승인된 환경에서만 적용하세요. 이 SQL은 새 테이블만 사용하며 `anon`/`authenticated` 접근을 열지 않습니다.

## 안전 범위

- 원격 shell 실행 기능 없음
- 상품 가격/재고/판매상태 변경 없음
- 비밀번호/쿠키/세션/토큰 로그 저장 금지
- URL은 토큰성 쿼리 파라미터를 `[redacted]`로 저장
- Supabase 업로드는 명시적 opt-in
