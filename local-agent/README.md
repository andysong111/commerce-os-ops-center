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
  - Shopling의 중첩 `main` frame에서 실제 작업 화면 자동 선택
  - 가능하면 스크린샷 PNG
  - timestamp, agent version

## 수동 실행

```powershell
node .\local-agent\bin\commerce-os-local-agent.mjs status
node .\local-agent\bin\commerce-os-local-agent.mjs daemon
node .\local-agent\bin\commerce-os-local-agent.mjs diagnose --goods-key 123456
node .\local-agent\bin\commerce-os-local-agent.mjs order-preflight
node .\local-agent\bin\commerce-os-local-agent.mjs label-print --expected-orders 33 --expected-pages 31
npm run local-agent:fulfillment-preflight
npm run local-agent:daily-fulfillment -- --date 20261002
```

`local-agent:daily-fulfillment`는 주문·클레임·문의 3종 수집, B5 매핑 확인/확정, B7 발송준비, B12 자동합포장과 도소매사우루스 전송, B코드·수량 오름차순 송장 생성을 한 흐름으로 실행합니다. 기본값은 화면과 건수만 확인하는 드라이런입니다. 실제 변경과 Xprinter 출력을 함께 실행할 때만 `--execute`를 사용합니다.

```powershell
npm run local-agent:daily-fulfillment -- --date 20261002 --execute
```

미매핑 주문이 있으면 B5에서 자동 중단하고 날짜별 체크포인트를 남깁니다. 사용자가 매핑을 완료한 뒤 같은 명령에 `--resume`을 추가하면 완료된 앞 단계를 건너뛰고 이어갑니다. 로그인 계정 불일치, 건수 불일치, 예상하지 못한 확인창, 택배사 전송 검증 실패, 프린터 설정 오류도 다음 단계로 넘어가지 않습니다.

`label-print`는 열린 샵플링 송장 설정창에서 CJ 5인치 양식, 주문 건수, 출력 필드, 수취인 출력 제외 설정을 먼저 검증합니다. 기본 실행은 송장 PDF와 Xprinter `대한통운 송장` 용지 설정까지만 확인하는 드라이런이며 실제 용지는 출력하지 않습니다. 검증된 배치를 실제 출력할 때만 같은 명령 끝에 `--execute`를 추가합니다. 실제 출력은 Chrome 인쇄창을 클릭하지 않고 Windows 인쇄 스풀러에 직접 전달하며, 프린터명·용지명·109×127mm·페이지 수와 스풀 작업 ID가 모두 일치해야 성공으로 기록합니다. 일일 통합 명령은 합포장 후 생성된 실제 페이지 수를 송장 HTML에서 자동 검출하므로 `--expected-pages`를 수동 입력하지 않습니다.

주소와 전화번호가 포함된 중간 HTML 및 바코드 이미지는 Windows 임시 폴더에서 처리 후 삭제합니다. 최종 PDF는 기본적으로 `%LOCALAPPDATA%\CommerceOS\labels\shopling-labels.pdf`에 저장됩니다.

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

`order-preflight`는 주문 화면의 단계, 조회 건수, 체크 상태, 날짜와 선택된 필터만 읽습니다. 수취인명, 주소, 전화번호는 수집하지 않으며 주문 변경, 폼 전송, 인쇄를 실행하지 않습니다.

Chrome 자체 인쇄 화면을 사용하는 보조 진단이 필요할 때만 다음처럼 키오스크 인쇄 모드를 사용할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\start-commerce-chrome-debug.ps1 -KioskPrinting
```

`-KioskPrinting`은 Chrome의 기본 인쇄 대화상자를 생략하므로 기본값은 꺼져 있습니다. 운영 자동화의 기본 경로는 위 `label-print --execute` 직접 출력이며, 키오스크 인쇄는 전용 프로필에서 프린터 설정을 시험할 때만 사용합니다.

## 포장 후 미발송 송장 대조

송장을 출력한 직후 B12 목록에서 운송장번호, 샵플링 주문번호, 상품, 수량만 로컬 JSON으로 저장합니다. 수취인명, 전화번호, 주소는 읽거나 저장하지 않습니다.

```powershell
npm run local-agent:shipment-manifest -- --status A04 --output .\local-agent\data\shipment-manifest.json
```

주문조회 결과와 상품조회 결과가 준비되면 매핑 시점의 `prod_id`와 `opt_id`를 상품의 `goods_key`와 `optId`에 정확히 대조하여 B코드를 보강합니다. 상품명 유사도는 사용하지 않습니다.

```powershell
npm run local-agent:resolve-shipment-bcodes -- --manifest .\local-agent\data\shipment-manifest.json --orders .\local-agent\data\shopling-orders.json --products .\local-agent\data\shopling-products.json --output .\local-agent\data\shipment-manifest-resolved.json
```

`SHOPLING_LOGIN_ID`, `SHOPLING_COMPANY_ID`, `SHOPLING_API_AUTH_KEY`가 로컬 환경에 안전하게 설정된 뒤에는 캡처와 B코드 보강을 한 번에 실행할 수 있습니다. API 요청은 주문·상품·옵션 식별 필드만 조회합니다.

```powershell
npm run local-agent:resolved-shipment-manifest -- --status A04 --output .\local-agent\data\shipment-manifest-resolved.json
```

포장하지 못하고 남은 송장 사진을 로컬 OCR로 대조합니다. 결과는 실제 송장번호 삭제나 품절처리를 실행하지 않는 검토용 드라이런입니다.

```powershell
npm run local-agent:analyze-unshipped-labels -- --manifest .\local-agent\data\shipment-manifest.json --image C:\path\label-1.jpg --output .\local-agent\data\unshipped-review.json
```

API 인증 설정과 B12 화면이 준비된 뒤에는 전체 읽기 전용 검토 흐름을 한 번에 실행할 수 있습니다.

```powershell
npm run local-agent:review-unshipped-labels -- --image C:\path\leftover-label.jpg --reason STOCKOUT --output .\local-agent\data\unshipped-review.json
```

이 명령도 실제 송장번호 삭제, 품절처리, 쇼핑몰 송장전송을 실행하지 않습니다.

품절 송장이라면 `--reason STOCKOUT`을 추가합니다. B코드는 목록 화면에서 확정할 수 없으므로 별도 상품·옵션 조회로 정확히 확인되기 전까지 품절 후보는 차단됩니다. OCR 원문은 결과 파일에 저장하지 않으며, 촬영된 운송장번호가 캡처한 목록과 정확히 일치할 때만 삭제 후보가 생성됩니다.

검토 JSON에 생성된 송장삭제 후보는 B12에서 다시 조회할 수 있습니다. 기본 실행은 정확한 송장번호와 연결된 샵플링 주문번호 전체가 검토 내용과 같은지만 확인하며 삭제하지 않습니다.

```powershell
npm run local-agent:delete-b12-invoice -- --review .\local-agent\data\unshipped-review.json --invoice 000000000000
```

실제 삭제는 운영자가 해당 송장의 작업키를 확인하고 명시적으로 승인한 한 건에만 허용됩니다. 합포장 주문 집합이 바뀌었거나 다른 송장이 섞이면 실행 전에 중단됩니다. 삭제 후에는 `택배사전송완료`에서 사라지고 모든 연결 주문이 `택배사전송대기`에 정확히 한 번씩 나타나는지 재조회합니다.

```powershell
npm run local-agent:delete-b12-invoice -- --review .\local-agent\data\unshipped-review.json --invoice 000000000000 --execute --approval-key b12-delete-invoice:000000000000 --output .\local-agent\data\b12-delete-audit.json
```

위 실행은 송장번호 삭제만 수행합니다. 품절처리와 쇼핑몰 송장전송은 계속 잠겨 있으며 별도 검증 단계가 끝나기 전에는 이어서 실행하지 않습니다.

## 문의·반품 수거 검토

샵플링 API에서 최근 31일 이내의 주문, 클레임, 문의를 읽어 B13 미답변 문의와 B7 반품 수거 후보를 검토할 수 있습니다. 기본 범위는 서울 날짜 기준 오늘을 포함한 최근 31일입니다.
샵플링의 검색 제한에 맞춰 각 자료는 7일 이하의 요청으로 자동 분할한 뒤 하나의 검토 결과로 합칩니다.

```powershell
npm run local-agent:customer-service-review -- --output .\local-agent\data\customer-service-review.json
```

이 명령은 읽기 전용입니다. 결과 파일에는 수취인명, 전화번호, 주소, 문의 원문·제목을 저장하지 않습니다.
문의답변만 검토할 때는 주문·클레임 API와 분리된 문의 전용 모드를 사용합니다.

```powershell
npm run local-agent:customer-service-review -- --scope qna --output .\local-agent\data\qna-review.json
```

과거 문의번호 집합으로 케이스 분류와 초안 생성 안전성을 시험할 수 있습니다. 결과에는 문의 원문과 과거 답변을 저장하지 않으며, 실시간 근거가 없는 배송·반품·환불·상품정보 답변은 완성 초안 대신 확인 항목이 표시된 미리보기로 남깁니다. 샵플링 저장과 전송은 수행하지 않습니다.

```powershell
npm run local-agent:qna-history-drafts -- --start 20251001 --end 20251031 --keys 31586,31678 --output .\local-agent\data\qna-history-draft-test.json
```

검토 파일에 승인된 답변 제안이 정확히 1건 포함되어 있으면 B13 저장 전 검증을 실행할 수 있습니다. `--execute`에는 검토 파일의 정확한 `actionKey`가 필요합니다. 실행하더라도 답변을 `전송대기`로 저장하고 API로 재확인하는 데까지만 진행하며, 고객에게 보내는 `문의답변전송`은 수행하지 않습니다.

```powershell
npm run local-agent:qna-reply-draft -- --review .\local-agent\data\qna-review.json --qna 49884
npm run local-agent:qna-reply-draft -- --review .\local-agent\data\qna-review.json --qna 49884 --execute --approval-key qna-reply:49884:검토파일의12자리지문
```

문의 자동화 계획은 각 답변을 `AUTO_TRANSMIT`, `APPROVAL_REQUIRED`, `BLOCKED_NEEDS_EVIDENCE` 중 하나로 분류합니다. 기본값은 승인 필요이며, 자동전송은 활성화된 승인 규칙의 문의유형·키워드·답변 문구가 정확히 일치하고 요구 근거가 유효시간 안에 재검증된 경우에만 열립니다. 승인 규칙이 없는 초기 운영에서는 자동전송 건수가 항상 0입니다.

```powershell
npm run local-agent:customer-service-review -- --scope qna --reply-file .\local-agent\data\qna-proposals.json --rule-file .\local-agent\data\qna-approved-rules.json --evidence-file .\local-agent\data\qna-evidence.json --output .\local-agent\data\qna-review.json
```

초안이 `전송대기`로 저장된 뒤 최종 전송 전 검사를 실행하면 정확한 `qna-transmit:...` 승인키가 나옵니다. `--execute` 없이 실행하면 읽기 전용입니다. 실제 전송은 정확한 한 행만 선택하고 샵플링 확인 문구가 완전히 일치할 때만 승인하며, API에서 동일 답변과 `답변완료` 상태를 재확인합니다. 재실행 시 이미 완료된 동일 답변은 다시 전송하지 않습니다.

```powershell
npm run local-agent:qna-reply-transmit -- --review .\local-agent\data\qna-review.json --qna 49884
npm run local-agent:qna-reply-transmit -- --review .\local-agent\data\qna-review.json --qna 49884 --execute --approval-key qna-transmit:49884:문의지문12자:답변지문12자
```

- B7 반품 후보는 `단순변심`, 발송완료, 주문 전체 행의 국내 CJ대한통운 코드 `018`과 동일한 원송장이 모두 확인되어야 생성됩니다.
- 이미 반품송장이 있거나 중복 클레임, 복수 원송장, 일부 송장 누락이 있으면 자동 차단합니다.
- 수거 가치 판단은 `PICKUP_WORTHWHILE` 또는 `SKIP_NO_VALUE`로 운영자가 명시해야 합니다.
- CJ LOIS 접수 화면과 당일 저장 완료 신호는 학습했습니다. `저장하시겠습니까?` 확인 후 확인창이 닫히고, 원송장 입력칸이 초기화되며, 접수 목록에 행이 추가되면 신규 접수 성공입니다. 정확한 `선택하신 원운송장번호로 반품접수가 등록되어 있습니다.` 안내는 기존 접수의 멱등 증거로 기록하고 새 접수를 만들지 않습니다.
- 샵플링 상태변경은 정확한 주문번호를 완전일치로 다시 조회하고 모든 행이 `발송완료(A05)`일 때만 `반품접수(R01)`로 변경합니다. `선택하신 주문 상태를 변경하시겠습니까?` 이외의 확인창이나 경고가 나오면 중단합니다.
- CJ 신규 접수 또는 기존 접수의 정확한 확인은 샵플링 상태변경보다 먼저 별도 감사 파일에 저장합니다. 중간에 브라우저가 종료되어도 감사 파일이 있으면 CJ 로그인과 접수를 반복하지 않고 B7 상태변경부터 재개하며, 감사 파일 없이 이미 `R01`이면 중복 가능성을 막기 위해 자동 중단합니다.
- 반품운송장번호는 즉시 발급되지 않는 것이 정상이며 다음 영업일에 확인합니다. 다음 영업일 자동 재조회는 아직 잠겨 있고, 당일 실제 접수는 정확한 승인키가 있는 감독 실행에서만 허용합니다.
- 교환 건은 수거와 재발송 절차를 별도로 학습하기 전까지 후보 표시만 합니다.

CJ LOIS와 샵플링 B7을 같은 DevTools 전용 Chrome에 로그인한 뒤, 검토 파일에 포함된 정확한 수거 후보를 먼저 드라이런합니다.

```powershell
npm run local-agent:return-pickup-preflight
npm run local-agent:return-pickup-inspect-b7
```

사전점검은 로그인 계정과 CJ `예약 > 기업고객건별접수` 화면 또는 해당 화면으로 이동할 수 있는 정확한 메뉴만 읽으며 원송장 입력, 저장, 상태변경은 수행하지 않습니다. CJ 홈에 로그인된 상태라면 실행기가 `예약 > 기업고객건별접수`를 정확히 찾아 자동으로 이동합니다. 샵플링은 빈 최상위 문서 아래의 `main` 프레임에서 로그인 계정과 B7 제어를 확인합니다. B7 점검 결과가 `ready: true`, `path: /order/order_list.phtml`, `frameName: main`이고 사전점검의 `readyForDryRun`이 `true`일 때 아래 드라이런으로 넘어갑니다.

```powershell
npm run local-agent:return-pickup -- --review .\local-agent\data\customer-service-review.json --action-key cj-return-pickup:주문번호:원송장번호
```

실행기는 먼저 Chrome 저장 자격증명과 로그인된 네이버 메일 세션만 이용해 CJ 로그인을 복구하고, 필요하면 건별접수 화면까지 이동합니다. 비밀번호와 인증번호는 파일이나 로그에 저장하지 않으며 CAPTCHA가 나타나면 수동 처리 요청과 함께 중단합니다. 드라이런이 `PREFLIGHT_READY`일 때만 동일한 정확한 승인키로 실제 접수와 B7 상태변경을 실행할 수 있습니다. CJ 신규 저장의 세 가지 성공 신호 또는 정확한 기존 접수 안내가 확인되어야 감사기록을 남기며, 그 뒤에만 B7을 `반품접수(R01)`로 변경합니다. 2026-10-04 감독 실행에서는 기존 CJ 예약을 중복 생성하지 않고 감사기록에서 재개해 B7 `R01` 재조회까지 완료했습니다.

```powershell
npm run local-agent:return-pickup -- --review .\local-agent\data\customer-service-review.json --action-key cj-return-pickup:주문번호:원송장번호 --execute --approval-key cj-return-pickup:주문번호:원송장번호
```

- B13 답변은 문의 내용 지문과 정확히 일치하는 승인된 초안만 저장하며, 저장 직후 API 상태와 답변 내용을 다시 확인합니다.
- B13와 API의 미처리 상태 표기 차이를 반영해 `신규`와 `미답변`을 모두 답변 후보로 분류합니다.
- 과거 B13 답변은 참고 전용입니다. 배송·송장·반품·환불은 실시간 주문/클레임 근거가 필요하고, 확인성 단답·KC/인증 판단·반품 불가 단정은 수동 검토로 분류합니다.
- B13 답변 전송은 `전송대기` 확인, 정확한 한 행 선택, 최종 확인창 검증, 전송 후 API 상태 재조회가 모두 끝나기 전까지 완료로 간주하지 않습니다.

판단 파일 예시:

```json
{
  "valueDecisions": [
    {
      "claimKey": "SHOPLING_CLAIM_KEY",
      "orderNo": "SHOPLING_ORDER_NO",
      "decision": "PICKUP_WORTHWHILE"
    }
  ]
}
```

```powershell
npm run local-agent:customer-service-review -- --decision-file .\local-agent\data\return-decisions.json --output .\local-agent\data\customer-service-review.json
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
- 샵플링 API 인증값은 환경변수로만 읽고 출력 파일에 저장하지 않음
- URL은 토큰성 쿼리 파라미터를 `[redacted]`로 저장
- Supabase 업로드는 명시적 opt-in
