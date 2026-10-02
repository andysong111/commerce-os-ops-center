import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeShoplingQnaHistory,
  buildShoplingQnaDraftCandidate,
  classifyShoplingQnaCase,
} from "../local-agent/src/shopling-qna-case-classifier.mjs";

const fixtures = [
  ["완제품으로 배송되나요, 조립해서 사용하나요?", "PRODUCT_INFORMATION"],
  ["언제 출고되나요?", "DELIVERY_SCHEDULE"],
  ["배송이 왜 지연되었나요?", "DELIVERY_DELAY_OR_TRACKING"],
  ["배송비가 36000원인데 맞나요?", "SHIPPING_FEE_ADJUSTMENT"],
  ["가송장입니다. 출고 여부 회신 바랍니다.", "DELIVERY_EXCEPTION_OR_INVOICE_ERROR"],
  ["120개 재고 있나요? 없으면 언제까지 가능한가요?", "BULK_STOCK_AVAILABILITY"],
  ["상품이 설명과 달라요. 반품하고 싶습니다.", "DEFECT_OR_ITEM_ISSUE"],
  ["수거가 안 되고 있습니다. 반송장 부탁드립니다.", "RETURN_PICKUP_OR_TRACKING"],
  ["선환불 처리 가능한가요?", "RETURN_REFUND_DECISION"],
  ["빠른 취소 승인 바랍니다.", "CANCELLATION_REQUEST"],
  ["KC인증 소명자료를 제출해 주세요.", "COMPLIANCE_OR_CERTIFICATION"],
  ["댓글 답변은 확인하지 않으며 상단 링크에 답변 부탁드립니다.", "EXTERNAL_ACTION_REQUIRED"],
  ["해당 문의는 답변이 필요하지 않으며 자동으로 답변 완료 처리됩니다.", "SYSTEM_NOTICE_NO_REPLY"],
];

test("historical QnA cases use specific, ordered classifications", () => {
  for (const [question, category] of fixtures) {
    assert.equal(classifyShoplingQnaCase({ question }).category, category, question);
  }
});

test("marketplace boilerplate does not override the actual return or external action", () => {
  assert.equal(classifyShoplingQnaCase({
    question: "배송비 결제 여부: 미기재. 반품 수거가 지연되어 수거접수 부탁드립니다.",
  }).category, "RETURN_PICKUP_OR_TRACKING");
  assert.equal(classifyShoplingQnaCase({
    question: "이미 응답하신 경우 다시 응답하지 않아도 됩니다. 댓글 답변은 확인하지 않으며 상단 링크에 답변 부탁드립니다.",
  }).category, "EXTERNAL_ACTION_REQUIRED");
  assert.equal(classifyShoplingQnaCase({
    question: "운송장 정보가 잘못 등록된 경우 수정해 주세요. 배송 예정일이 경과했습니다.",
  }).category, "DELIVERY_DELAY_OR_TRACKING");
});

test("draft generation blocks factual replies until matching evidence is verified", () => {
  const qna = {
    qnaKey: "Q-DELIVERY",
    title: "출고일정",
    question: "언제 출고되나요?",
    answer: "과거 답변은 새 초안에 들어가면 안 됩니다.",
  };
  const blocked = buildShoplingQnaDraftCandidate(qna);
  assert.equal(blocked.draftStatus, "BLOCKED_NEEDS_EVIDENCE");
  assert.equal(blocked.draft, null);
  assert.match(blocked.draftPreview, /확인된 출고 상태/);
  assert.doesNotMatch(blocked.draftPreview, /과거 답변/);

  const ready = buildShoplingQnaDraftCandidate(qna, [{
    code: "CURRENT_ORDER_AND_TRACKING_STATUS",
    status: "VERIFIED",
    replyText: "안녕하세요. 주문 건은 오늘 출고되었으며 운송장 조회가 가능합니다. 감사합니다.",
  }]);
  assert.equal(ready.draftStatus, "DRAFT_READY_FOR_APPROVAL");
  assert.match(ready.draft, /오늘 출고/);
  assert.equal(ready.historicalAnswerUsed, false);
});

test("bulk stock answers require verified quantity and replenishment evidence", () => {
  const qna = {
    qnaKey: "Q-STOCK",
    title: "상품문의",
    question: "120개 재고 있나요? 현재고 확인 부탁드립니다. 없으면 언제 가능한가요?",
  };
  const blocked = buildShoplingQnaDraftCandidate(qna);
  assert.equal(blocked.category, "BULK_STOCK_AVAILABILITY");
  assert.equal(blocked.draftStatus, "BLOCKED_NEEDS_EVIDENCE");
  assert.deepEqual(blocked.missingEvidence, [
    "CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA",
  ]);
  assert.match(blocked.draftPreview, /현재 확인 재고/);

  const ready = buildShoplingQnaDraftCandidate(qna, [{
    code: "CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA",
    status: "VERIFIED",
    replyText: "안녕하세요. 현재 120개 주문 가능하며 영업일 기준 1일 이내 출고 가능합니다. 감사합니다.",
  }]);
  assert.equal(ready.draftStatus, "DRAFT_READY_FOR_APPROVAL");
  assert.equal(ready.review.reviewTier, "EVIDENCE_REQUIRED");
  assert.deepEqual(ready.review.requiredEvidence, [
    "CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA",
  ]);
});

test("no-reply notices and external actions never create a Shopling draft", () => {
  const noReply = buildShoplingQnaDraftCandidate({
    question: "답변이 필요하지 않으며 자동으로 답변 완료 처리됩니다.",
  });
  assert.equal(noReply.draftStatus, "NO_REPLY_REQUIRED");
  assert.equal(noReply.draft, null);

  const external = buildShoplingQnaDraftCandidate({
    question: "댓글 답변은 확인하지 않습니다. 상단 링크에 답변해 주세요.",
  });
  assert.equal(external.draftStatus, "MANUAL_ACTION_REQUIRED");
  assert.equal(external.draft, null);
});

test("history report stores classifications and previews without raw inquiry text", () => {
  const report = analyzeShoplingQnaHistory(fixtures.map(([question], index) => ({
    qnaKey: String(index + 1),
    productId: `P-${index + 1}`,
    qnaType: "테스트",
    question,
    answer: "과거 답변",
  })));
  assert.equal(report.total, fixtures.length);
  assert.equal(report.externalWritesPerformed, false);
  assert.equal(report.privacy.rawQuestionStored, false);
  assert.doesNotMatch(JSON.stringify(report), /완제품으로 배송|과거 답변/);
});
