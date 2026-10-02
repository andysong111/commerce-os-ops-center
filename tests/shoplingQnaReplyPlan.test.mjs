import assert from "node:assert/strict";
import test from "node:test";
import {
  assessShoplingQnaReply,
  buildShoplingQnaReplyPlan,
  shoplingQnaQuestionFingerprint,
} from "../local-agent/src/shopling-qna-reply-plan.mjs";

function qna(overrides = {}) {
  return {
    qnaKey: "Q-1",
    productId: "116501",
    qnaType: "상품문의",
    title: "PII-TITLE",
    question: "PII-QUESTION",
    status: "미답변",
    ...overrides,
  };
}

test("unanswered QnA plan stores a freshness fingerprint but no raw customer text", () => {
  const plan = buildShoplingQnaReplyPlan([qna()]);
  assert.equal(plan.unanswered.length, 1);
  assert.equal(plan.unanswered[0].requiresAnswerDraft, true);
  assert.equal(plan.unanswered[0].questionFingerprint.length, 64);
  assert.doesNotMatch(JSON.stringify(plan), /PII-TITLE|PII-QUESTION/);
  assert.equal(plan.replySteps.length, 0);
});

test("B13 신규 status is treated as an unanswered inquiry", () => {
  const plan = buildShoplingQnaReplyPlan([qna({ status: "신규" })]);
  assert.equal(plan.unanswered.length, 1);
  assert.equal(plan.skipped.length, 0);
});

test("matching proposal creates an approval-gated reply step", () => {
  const item = qna({ title: "배송", question: "언제 오나요?" });
  const fingerprint = shoplingQnaQuestionFingerprint(item);
  const plan = buildShoplingQnaReplyPlan([item], [{
    qnaKey: "Q-1",
    questionFingerprint: fingerprint,
    reply: "확인 후 안내드리겠습니다.",
  }]);
  assert.equal(plan.replySteps.length, 1);
  assert.equal(plan.replySteps[0].status, "WAITING_FOR_OPERATOR_APPROVAL");
  assert.equal(plan.gates.replyExecutionEnabled, false);
  assert.equal(plan.gates.replyDraftExecutionEnabled, true);
  assert.equal(plan.gates.historicalRepliesAreReferenceOnly, true);
  assert.equal(plan.gates.finalTransmissionApprovalRequired, true);
  assert.equal(plan.gates.b13PreSendStatus, "전송대기");
});

test("delivery and return questions require live operational evidence", () => {
  const review = assessShoplingQnaReply({
    title: "반품 수거와 송장 문의",
    question: "언제 수거되고 반송장 번호는 무엇인가요?",
  }, "현재 수거 중입니다.");
  assert.equal(review.reviewTier, "EVIDENCE_REQUIRED");
  assert.deepEqual(review.riskCodes, [
    "DELIVERY_STATUS_CLAIM",
    "CLAIM_OR_REFUND_DECISION",
  ]);
  assert.deepEqual(review.requiredEvidence, [
    "CURRENT_ORDER_AND_TRACKING_STATUS",
    "CURRENT_CLAIM_AND_PICKUP_STATUS",
  ]);
  assert.equal(review.historicalReplies, "REFERENCE_ONLY");
});

test("acknowledgement-only and categorical denial replies stay manual", () => {
  const acknowledgement = assessShoplingQnaReply({}, "확인하였습니다");
  assert.equal(acknowledgement.reviewTier, "MANUAL_ONLY");
  assert.deepEqual(acknowledgement.riskCodes, ["ACKNOWLEDGEMENT_ONLY"]);

  const denial = assessShoplingQnaReply({ question: "상품 반품 문의" }, "정상제품이라 반품이 불가합니다.");
  assert.equal(denial.reviewTier, "MANUAL_ONLY");
  assert.ok(denial.riskCodes.includes("CATEGORICAL_POLICY_DENIAL"));
  assert.ok(denial.requiredEvidence.includes("MARKETPLACE_POLICY_AND_ITEM_CONDITION"));
});

test("compliance answers require verified documents and manual review", () => {
  const review = assessShoplingQnaReply({
    title: "KC인증 소명 요청",
    question: "인증 자료를 제출해 주세요.",
  }, "인증 대상이 아닙니다.");
  assert.equal(review.reviewTier, "MANUAL_ONLY");
  assert.deepEqual(review.riskCodes, ["COMPLIANCE_OR_LEGAL_ASSERTION"]);
  assert.deepEqual(review.requiredEvidence, ["VERIFIED_COMPLIANCE_DOCUMENT"]);
});

test("stale proposal is skipped when the question contents changed", () => {
  const before = qna({ question: "기존 질문" });
  const after = qna({ question: "수정된 질문" });
  const plan = buildShoplingQnaReplyPlan([after], [{
    qnaKey: "Q-1",
    questionFingerprint: shoplingQnaQuestionFingerprint(before),
    reply: "기존 답변",
  }]);
  assert.equal(plan.replySteps.length, 0);
  assert.equal(plan.skipped[0].code, "QNA_REPLY_STALE_OR_EMPTY");
});

test("duplicate QnA identity blocks every reply candidate", () => {
  const plan = buildShoplingQnaReplyPlan([qna(), qna()]);
  assert.deepEqual(plan.skipped, [{ qnaKey: "Q-1", code: "QNA_DUPLICATE_IDENTITY" }]);
  assert.equal(plan.unanswered.length, 0);
  assert.equal(plan.replySteps.length, 0);
});

test("already processed QnA is never proposed for a reply", () => {
  const plan = buildShoplingQnaReplyPlan([qna({ status: "답변완료" })]);
  assert.equal(plan.skipped[0].code, "QNA_ALREADY_PROCESSED");
  assert.equal(plan.replySteps.length, 0);
});

test("reply proposals require one unique key", () => {
  assert.throws(() => buildShoplingQnaReplyPlan([], [
    { qnaKey: "Q-1", reply: "A" },
    { qnaKey: "Q-1", reply: "B" },
  ]), { code: "QNA_REPLY_PROPOSAL_INVALID" });
});
