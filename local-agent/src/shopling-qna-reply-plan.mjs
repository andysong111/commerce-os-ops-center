import { createHash } from "node:crypto";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function includesAny(value, terms) {
  const normalized = clean(value).toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

const ACKNOWLEDGEMENT_ONLY = /^(?:네\s*)?(?:확인|확인했습니다|확인하였습니다|확인드리겠습니다|알겠습니다|처리하겠습니다)[.! ]*$/u;
const UNANSWERED_STATUSES = new Set(["미답변", "신규"]);

export function assessShoplingQnaReply(qna = {}, replyValue = "") {
  const source = `${clean(qna.title)} ${clean(qna.question)}`;
  const reply = clean(replyValue);
  const riskCodes = [];
  const requiredEvidence = [];

  if (includesAny(source, ["배송", "출고", "송장", "운송장", "도착", "발송"])) {
    riskCodes.push("DELIVERY_STATUS_CLAIM");
    requiredEvidence.push("CURRENT_ORDER_AND_TRACKING_STATUS");
  }
  if (includesAny(source, ["재고", "현재고", "입고 예정", "입고 일정"])) {
    riskCodes.push("INVENTORY_AVAILABILITY_CLAIM");
    requiredEvidence.push("CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA");
  }
  if (includesAny(source, ["반품", "환불", "교환", "수거", "회수", "반송장"])) {
    riskCodes.push("CLAIM_OR_REFUND_DECISION");
    requiredEvidence.push("CURRENT_CLAIM_AND_PICKUP_STATUS");
  }
  if (includesAny(source, ["kc", "인증", "소명", "법령", "안전기준"])) {
    riskCodes.push("COMPLIANCE_OR_LEGAL_ASSERTION");
    requiredEvidence.push("VERIFIED_COMPLIANCE_DOCUMENT");
  }
  if (includesAny(source, ["파손", "불량", "하자", "오배송", "설명과 달라"])) {
    riskCodes.push("DEFECT_OR_NONCONFORMITY_CLAIM");
    requiredEvidence.push("ORDER_AND_CUSTOMER_EVIDENCE");
  }
  if (ACKNOWLEDGEMENT_ONLY.test(reply)) {
    riskCodes.push("ACKNOWLEDGEMENT_ONLY");
  }
  if (includesAny(reply, ["반품이 불가", "환불이 불가", "교환이 불가"])) {
    riskCodes.push("CATEGORICAL_POLICY_DENIAL");
    requiredEvidence.push("MARKETPLACE_POLICY_AND_ITEM_CONDITION");
  }
  if (/\d{8,}/u.test(reply.replaceAll(/[-\s]/g, ""))) {
    riskCodes.push("LONG_IDENTIFIER_IN_REPLY");
    requiredEvidence.push("IDENTIFIER_DESTINATION_MATCH");
  }

  const manualOnly = riskCodes.some((code) => [
    "ACKNOWLEDGEMENT_ONLY",
    "COMPLIANCE_OR_LEGAL_ASSERTION",
    "CATEGORICAL_POLICY_DENIAL",
  ].includes(code));
  const reviewTier = manualOnly
    ? "MANUAL_ONLY"
    : requiredEvidence.length
      ? "EVIDENCE_REQUIRED"
      : "STANDARD_REVIEW";

  return {
    reviewTier,
    riskCodes: [...new Set(riskCodes)],
    requiredEvidence: [...new Set(requiredEvidence)],
    historicalReplies: "REFERENCE_ONLY",
  };
}

export function shoplingQnaQuestionFingerprint(qna = {}) {
  const source = [qna.qnaKey, qna.status, qna.title, qna.question]
    .map(clean)
    .join("\n");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function shoplingQnaContentFingerprint(qna = {}) {
  const source = [qna.qnaKey, qna.title, qna.question]
    .map(clean)
    .join("\n");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function buildShoplingQnaReplyPlan(qnas = [], proposedReplies = []) {
  const proposals = new Map();
  for (const proposal of proposedReplies) {
    const qnaKey = clean(proposal?.qnaKey);
    if (!qnaKey || proposals.has(qnaKey)) {
      const error = new Error("QnA reply proposals require unique QnA keys.");
      error.code = "QNA_REPLY_PROPOSAL_INVALID";
      throw error;
    }
    proposals.set(qnaKey, proposal);
  }

  const qnaKeyCounts = new Map();
  for (const qna of qnas) {
    const qnaKey = clean(qna?.qnaKey);
    if (qnaKey) qnaKeyCounts.set(qnaKey, (qnaKeyCounts.get(qnaKey) || 0) + 1);
  }

  const unanswered = [];
  const replySteps = [];
  const skipped = [];
  const duplicateKeysReported = new Set();
  for (const qna of qnas) {
    const qnaKey = clean(qna.qnaKey);
    if (!qnaKey) {
      skipped.push({ qnaKey: "", code: "QNA_IDENTITY_INCOMPLETE" });
      continue;
    }
    if ((qnaKeyCounts.get(qnaKey) || 0) > 1) {
      if (!duplicateKeysReported.has(qnaKey)) {
        skipped.push({ qnaKey, code: "QNA_DUPLICATE_IDENTITY" });
        duplicateKeysReported.add(qnaKey);
      }
      continue;
    }
    if (!UNANSWERED_STATUSES.has(clean(qna.status))) {
      skipped.push({ qnaKey, code: "QNA_ALREADY_PROCESSED" });
      continue;
    }
    const fingerprint = shoplingQnaQuestionFingerprint(qna);
    unanswered.push({
      qnaKey,
      productId: clean(qna.productId),
      qnaType: clean(qna.qnaType),
      questionFingerprint: fingerprint,
      requiresAnswerDraft: !proposals.has(qnaKey),
    });

    const proposal = proposals.get(qnaKey);
    if (!proposal) continue;
    const reply = clean(proposal.reply);
    if (!reply || clean(proposal.questionFingerprint) !== fingerprint) {
      skipped.push({ qnaKey, code: "QNA_REPLY_STALE_OR_EMPTY" });
      continue;
    }
    replySteps.push({
      actionKey: `qna-reply:${qnaKey}:${fingerprint.slice(0, 12)}`,
      channel: "SHOPLING_QNA_API_OR_B13_UI",
      qnaKey,
      questionFingerprint: fingerprint,
      reply,
      proposalSource: {
        kind: clean(proposal?.source?.kind) || "AI_DRAFT",
        ruleId: clean(proposal?.source?.ruleId),
        ruleVersion: clean(proposal?.source?.ruleVersion),
      },
      review: assessShoplingQnaReply(qna, reply),
      status: "WAITING_FOR_OPERATOR_APPROVAL",
    });
  }

  return {
    schemaVersion: 1,
    mode: "PLAN_ONLY",
    unanswered,
    replySteps,
    skipped,
    gates: {
      replyExecutionEnabled: false,
      replyDraftExecutionEnabled: true,
      operatorApprovalRequired: true,
      historicalRepliesAreReferenceOnly: true,
      finalTransmissionApprovalRequired: true,
      b13PreSendStatus: "전송대기",
      b13ConfirmationText: "선택된 문의를 쇼핑몰로 전송하시겠습니까?",
      b13ReadbackRequired: true,
    },
    privacy: {
      rawQuestionStoredInPlan: false,
      rawTitleStoredInPlan: false,
      questionerIdentityStored: false,
    },
  };
}
