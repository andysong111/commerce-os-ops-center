import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoplingQnaAutomationPlan,
  decideShoplingQnaAutomation,
} from "../local-agent/src/shopling-qna-automation-policy.mjs";

const NOW = new Date("2026-10-02T03:00:00.000Z");

function qna(overrides = {}) {
  return {
    qnaKey: "Q-1",
    orderNo: "3493809",
    qnaType: "상품문의",
    title: "재고 문의",
    question: "재고가 있나요?",
    ...overrides,
  };
}

function step(overrides = {}) {
  return {
    qnaKey: "Q-1",
    actionKey: "qna-reply:Q-1:abc",
    questionFingerprint: "a".repeat(64),
    reply: "현재 구매 가능합니다.",
    proposalSource: { kind: "AI_DRAFT", ruleId: "", ruleVersion: "" },
    review: { reviewTier: "STANDARD_REVIEW", riskCodes: [], requiredEvidence: [] },
    ...overrides,
  };
}

test("ordinary AI drafts require operator approval", () => {
  const decision = decideShoplingQnaAutomation(step(), qna(), { now: NOW });
  assert.equal(decision.decision, "APPROVAL_REQUIRED");
  assert.equal(decision.reasonCode, "NO_EXACT_APPROVED_RULE");
});

test("missing or stale evidence blocks an operational answer", () => {
  const reviewed = step({
    review: {
      reviewTier: "EVIDENCE_REQUIRED",
      riskCodes: ["DELIVERY_STATUS_CLAIM"],
      requiredEvidence: ["CURRENT_ORDER_AND_TRACKING_STATUS"],
    },
  });
  const missing = decideShoplingQnaAutomation(reviewed, qna(), { now: NOW });
  assert.equal(missing.decision, "BLOCKED_NEEDS_EVIDENCE");
  assert.deepEqual(missing.missingEvidence, ["CURRENT_ORDER_AND_TRACKING_STATUS"]);

  const stale = decideShoplingQnaAutomation(reviewed, qna(), {
    now: NOW,
    evidence: [{
      code: "CURRENT_ORDER_AND_TRACKING_STATUS",
      status: "VERIFIED",
      verifiedAt: "2026-10-02T01:00:00.000Z",
      maxAgeMinutes: 30,
    }],
  });
  assert.equal(stale.decision, "BLOCKED_NEEDS_EVIDENCE");
});

test("stock availability replies cannot auto-transmit without fresh stock evidence", () => {
  const reviewed = step({
    review: {
      reviewTier: "EVIDENCE_REQUIRED",
      riskCodes: ["INVENTORY_AVAILABILITY_CLAIM"],
      requiredEvidence: ["CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA"],
    },
  });
  const decision = decideShoplingQnaAutomation(reviewed, qna(), { now: NOW });
  assert.equal(decision.decision, "BLOCKED_NEEDS_EVIDENCE");
  assert.deepEqual(decision.missingEvidence, [
    "CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA",
  ]);
});

test("only an exact enabled rule and fresh evidence can auto-transmit", () => {
  const reviewed = step({
    proposalSource: { kind: "APPROVED_RULE", ruleId: "stock-available", ruleVersion: "1" },
  });
  const rule = {
    ruleId: "stock-available",
    version: "1",
    enabled: true,
    reply: "현재 구매 가능합니다.",
    match: { qnaTypes: ["상품문의"], includesAll: ["재고"] },
    allowedReviewTiers: ["STANDARD_REVIEW"],
  };
  const decision = decideShoplingQnaAutomation(reviewed, qna(), {
    approvedRules: [rule],
    now: NOW,
  });
  assert.equal(decision.decision, "AUTO_TRANSMIT");
  assert.equal(decision.reasonCode, "EXACT_APPROVED_RULE_MATCH");
  assert.equal(decision.policyFingerprint.length, 64);

  const changedReply = decideShoplingQnaAutomation({ ...reviewed, reply: "아마 있습니다." }, qna(), {
    approvedRules: [rule],
    now: NOW,
  });
  assert.equal(changedReply.decision, "APPROVAL_REQUIRED");
});

test("manual-only risk can never auto-transmit even with a matching rule", () => {
  const reviewed = step({
    proposalSource: { kind: "APPROVED_RULE", ruleId: "deny-return", ruleVersion: "1" },
    review: {
      reviewTier: "MANUAL_ONLY",
      riskCodes: ["CATEGORICAL_POLICY_DENIAL"],
      requiredEvidence: [],
    },
  });
  const decision = decideShoplingQnaAutomation(reviewed, qna(), {
    approvedRules: [{
      ruleId: "deny-return",
      version: "1",
      enabled: true,
      reply: reviewed.reply,
      match: {},
      allowedReviewTiers: ["MANUAL_ONLY"],
    }],
    now: NOW,
  });
  assert.equal(decision.decision, "APPROVAL_REQUIRED");
  assert.equal(decision.reasonCode, "MANUAL_REVIEW_POLICY");
});

test("automation plan reports each decision without customer text", () => {
  const replyPlan = { replySteps: [step()] };
  const plan = buildShoplingQnaAutomationPlan([qna()], replyPlan, { now: NOW });
  assert.equal(plan.counts.APPROVAL_REQUIRED, 1);
  assert.equal(plan.counts.AUTO_TRANSMIT, 0);
  assert.doesNotMatch(JSON.stringify(plan), /재고가 있나요|현재 구매 가능합니다/);
});

test("order-scoped return tracking evidence can satisfy the matching QnA only", () => {
  const reviewed = step({
    review: {
      reviewTier: "EVIDENCE_REQUIRED",
      riskCodes: ["RETURN_PICKUP_STATUS_CLAIM"],
      requiredEvidence: ["CURRENT_CLAIM_AND_PICKUP_STATUS"],
    },
  });
  const plan = buildShoplingQnaAutomationPlan([qna()], { replySteps: [reviewed] }, {
    now: NOW,
    evidence: [{
      orderNo: "3493809",
      code: "CURRENT_CLAIM_AND_PICKUP_STATUS",
      status: "VERIFIED",
      verifiedAt: NOW.toISOString(),
      maxAgeMinutes: 60,
    }],
  });
  assert.equal(plan.decisions[0].decision, "APPROVAL_REQUIRED");
  assert.deepEqual(plan.decisions[0].verifiedEvidence, ["CURRENT_CLAIM_AND_PICKUP_STATUS"]);
});
