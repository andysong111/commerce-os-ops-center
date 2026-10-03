# 샵플링 문의답변 자동화 인수인계

기준일: 2026-10-04 (Asia/Seoul)

이 문서는 다른 Codex 채팅이 샵플링 B13 문의답변 업무를 이어받기 위한 단일 진입점이다.

## 1. 사용자 목표

- 매일 수집된 문의를 읽고 답변 초안을 생성한다.
- 검증된 반복 문의는 사용자 승인 없이 샵플링 B13에 `답변저장`한다.
- 판단, 최신 근거, 표현 수정이 필요한 문의는 답변 앞에 `[초안]`을 붙여 샵플링 B13에 저장한다.
- 사용자는 별도 승인 화면이 아니라 샵플링 B13에서 초안을 바로 확인한다.
- 문의 답변을 위한 별도 Vercel 서비스, 별도 관리 화면, 별도 예약 실행은 만들지 않는다.
- 평일 12시 31분 통합 작업은 주문·클레임·문의 수집까지만 담당한다. 사용자가 이 채팅에서 `문의 처리해`라고 요청하면 현재 미답변 문의를 한 번에 처리한다.
- 사용자가 수정하고 승인한 최종 답변을 학습 기록으로 축적한다.
- 반복 승인으로 안정된 유형은 단계적으로 자동 저장 대상으로 승격한다.
- 장기적으로는 충분히 검증된 유형만 승인 없이 자동전송한다.

## 2. 현재 확인된 운영 상태

- Shopling QnA API를 이용한 최근 31일 문의 조회가 구현되어 있다.
- 주문·클레임을 읽지 않는 문의 전용 조회 모드가 있다.
- B13 답변 팝업에 정확한 한 문의의 답변을 저장하는 실행기가 있다.
- 저장 후 API에서 동일 문의, 동일 답변, 저장 상태를 재확인한다.
- B13의 정확한 한 행을 선택해 쇼핑몰로 최종 전송하고 결과를 재확인하는 실행기가 있다.
- 자동화 정책은 `AUTO_TRANSMIT`, `APPROVAL_REQUIRED`, `BLOCKED_NEEDS_EVIDENCE`로 나뉜다.
- 기본 승인 규칙은 비어 있으므로 일반 AI 초안은 자동전송되지 않는다.
- 2026-10-02 문의 `49983`은 사용자 확인 재고를 근거로 B13 `답변저장`까지 실제 검증했다.
- 해당 문의는 쇼핑몰로 최종 전송하지 않았다.
- Shopling은 `qna_submit()` 후 팝업 렌더러가 계속 로딩될 수 있다. 팝업 완료 여부가 아니라 QnA API의 상태와 정확한 답변 본문을 최종 성공 기준으로 사용한다.

## 3. 확정된 사용자 운영 규칙

### 승인 불필요

1. 문의와 상품을 정확히 식별한다.
2. 필요한 최신 근거를 Commerce OS 또는 검증된 외부 상태에서 읽는다.
3. 정확히 승인된 규칙과 근거가 모두 일치할 때만 초안을 생성한다.
4. B13에 자동으로 `답변저장`한다.
5. QnA API에서 답변 본문과 저장 상태를 재확인한다.
6. 최종 쇼핑몰 전송은 별도의 자동전송 승격 정책을 통과해야 한다.

### 승인 필요

답변 맨 앞에 `[초안]`을 정확히 한 번 붙여 샵플링 B13에 저장한다. 동일 초안이 이미 저장되어 있으면 다시 쓰지 않는다. 사용자는 B13에서 내용을 수정·확정하며, `[초안]` 표지가 남아 있는 동안에는 최종 쇼핑몰 전송을 허용하지 않는다.

### 근거 부족

- 추측 답변을 만들지 않는다.
- 필요한 정보만 사용자에게 질문한다.
- 재고·배송·입고일 등 시간에 따라 바뀌는 근거는 유효시간을 둔다.

## 4. 학습 및 자동화 승격 구조

모델을 무조건 재학습하는 방식이 아니라 승인 이력을 비식별 운영 규칙으로 축적한다.

각 승인 이벤트에 보존할 항목:

- 문의 유형과 정규화된 특징
- 상품·옵션 식별자와 B코드
- 최초 초안의 해시
- 최종 승인 답변의 해시
- 사용자가 수정한 필드 또는 문장 유형
- 사용한 근거 코드와 확인 시각
- 승인 결과와 처리 결과
- 적용한 규칙 ID와 버전

보존하지 않을 항목:

- 질문자 이름이나 계정
- 전화번호, 주소, 이메일
- 로그인 비밀번호, OTP, 쿠키, 세션
- 불필요한 원문 전체

승격 단계:

1. `NEW_CASE`: 항상 승인 필요
2. `LEARNING`: 과거 수정사항을 반영해 초안을 만들지만 승인 필요
3. `AUTO_SAVE_ELIGIBLE`: 동일 조건에서 반복 승인되고 근거가 신선하면 B13 자동 저장
4. `AUTO_TRANSMIT_ELIGIBLE`: 별도 검증을 마친 정확한 규칙만 쇼핑몰 자동전송 가능
5. `DEMOTED`: 수정, 실패, 근거 불일치 또는 새로운 조건이 발생하면 즉시 승인 단계로 복귀

권장 초기 승격 기준:

- 같은 규칙에서 실질적 수정 없이 3회 연속 승인되면 자동 저장 후보
- 자동 저장 후 10회 연속 본문 수정·전송 실패·사용자 철회가 없으면 자동전송 검토 후보
- 재고, 입고일, 배송상태처럼 변하는 답변은 횟수와 무관하게 최신 근거가 없으면 차단
- 법률, 인증, 반품 불가 단정, 보상 약속, 금액 변경은 자동전송 금지

## 5. 상태와 작업 경계

답변 생성, B13 저장, 쇼핑몰 전송은 서로 다른 작업이다.

- `DRAFT_GENERATED`: 로컬 초안만 존재
- `WAITING_FOR_APPROVAL`: `[초안]`으로 B13 저장 후 사용자 확인 필요
- `BLOCKED_NEEDS_EVIDENCE`: 근거 부족
- `B13_DRAFT_SAVED`: 샵플링에 저장됐지만 쇼핑몰 전송 전
- `TRANSMITTED_AND_VERIFIED`: 쇼핑몰 전송 후 API 재확인 완료

현재 `AUTO_TRANSMIT` 판정은 최종 전송 권한까지 의미한다. `APPROVAL_REQUIRED`는 자동전송과 분리되어 `[초안]` B13 저장만 허용한다. 다음 개발에서는 승인·수정 이력을 기반으로 `AUTO_SAVE_ELIGIBLE` 규칙 승격을 구현한다.

## 6. 코드 지도

조회와 파싱:

- `local-agent/src/shopling-customer-service-source.mjs`
- `local-agent/src/shopling-api-transport.mjs`
- `local-agent/src/simple-xml.mjs`

문의 분류와 답변 계획:

- `local-agent/src/shopling-qna-case-classifier.mjs`
- `local-agent/src/shopling-qna-reply-plan.mjs`
- `local-agent/src/shopling-qna-automation-policy.mjs`

B13 저장과 전송:

- `local-agent/src/shopling-qna-browser-adapter.mjs`
- `local-agent/src/shopling-qna-draft-marker.mjs`
- `local-agent/src/shopling-qna-draft-staging.mjs`
- `local-agent/src/shopling-qna-reply-draft.mjs`
- `local-agent/src/shopling-qna-reply-transmission.mjs`
- `local-agent/src/shopling-browser-dialog.mjs`

명령 진입점:

- `local-agent/scripts/prepare-shopling-customer-service-review.mjs`
- `local-agent/scripts/save-shopling-qna-reply-draft.mjs`
- `local-agent/scripts/stage-shopling-qna-review-drafts.mjs`
- `local-agent/scripts/transmit-shopling-qna-reply.mjs`
- `local-agent/scripts/analyze-shopling-qna-history.mjs`
- `local-agent/scripts/inspect-shopling-qna-structure.mjs`
- `local-agent/scripts/inspect-shopling-qna-reply-popup.mjs`

회귀 테스트:

- `tests/shoplingCustomerServiceSource.test.mjs`
- `tests/shoplingQnaCaseClassifier.test.mjs`
- `tests/shoplingQnaReplyPlan.test.mjs`
- `tests/shoplingQnaAutomationPolicy.test.mjs`
- `tests/shoplingQnaBrowserAdapter.test.mjs`
- `tests/shoplingQnaReplyDraft.test.mjs`
- `tests/shoplingQnaReplyTransmission.test.mjs`
- `tests/shoplingBrowserDialog.test.mjs`

## 7. 실행 예시

문의 전용 검토:

```powershell
npm run local-agent:customer-service-review -- --scope qna --start YYYYMMDD --end YYYYMMDD --reply-file .\local-agent\data\qna-proposals.json --evidence-file .\local-agent\data\qna-evidence.json --output .\local-agent\data\qna-review.json
```

B13 저장 드라이런:

```powershell
npm run local-agent:qna-reply-draft -- --review .\local-agent\data\qna-review.json --qna QNA_KEY
```

승인된 한 건 B13 저장:

```powershell
npm run local-agent:qna-reply-draft -- --review .\local-agent\data\qna-review.json --qna QNA_KEY --execute --approval-key EXACT_ACTION_KEY
```

승인 필요 건 전체를 `[초안]`으로 B13 저장:

```powershell
npm run local-agent:qna-stage-review-drafts -- --review .\local-agent\data\qna-review.json --execute --output .\local-agent\data\qna-draft-staging-audit.json
```

최종 전송은 별도 명령이며 정확한 승인 키 또는 검증된 자동 정책 판정 없이는 실행하지 않는다.

```powershell
npm run local-agent:qna-reply-transmit -- --review .\local-agent\data\qna-review.json --qna QNA_KEY
```

## 8. 다른 채팅이 시작할 때 확인할 순서

1. 이 문서와 `docs/handoffs/shopling-qna-automation-state.json`을 읽는다.
2. 현재 브랜치와 최신 원격 변경을 확인한다.
3. 주문수집은 사용자가 명시적으로 요청하지 않으면 실행하지 않는다.
4. 문의수집 완료 여부를 사용자에게 받은 정보 또는 Shopling API로 확인한다.
5. 미답변 문의만 읽고 분류한다.
6. Commerce OS 최신 근거를 우선 사용한다.
7. 승인 필요 건은 `[초안]`으로 B13에 저장하고, 근거 부족 건은 쓰지 않고 예외로 보고한다.
8. 실제 저장 전 현재 질문 지문과 상태를 다시 확인한다.
9. 저장 후 API로 정확한 답변과 상태를 재확인한다.
10. 최종 쇼핑몰 전송은 저장과 분리한다.

## 9. 다음 개발 우선순위

1. 승인·수정 차이를 비식별 학습 이벤트로 저장
2. 규칙 승격·강등 엔진과 버전 관리
3. Commerce OS 재고·입고 예정 근거 연결
4. 이 채팅의 수동 일괄 실행에서 초안 생성·저장과 예외 보고를 검증

## 10. 안전 불변조건

- 질문 지문이 바뀌면 기존 초안을 폐기한다.
- 한 문의 키가 중복되면 실행하지 않는다.
- 최신 근거 없는 운영 사실은 답변하지 않는다.
- B13 저장 성공은 API의 동일 본문 재조회로 확인한다.
- 쇼핑몰 전송 성공은 완료 상태 재조회로 확인한다.
- 자동화 실패를 성공으로 기록하지 않는다.
- 개인정보와 인증정보를 GitHub, 로그, 승인 목록에 저장하지 않는다.
