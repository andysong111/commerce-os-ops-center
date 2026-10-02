import { createHash } from "node:crypto";

const DECISIONS = new Set([
  "AUTO_TRANSMIT",
  "APPROVAL_REQUIRED",
  "BLOCKED_NEEDS_EVIDENCE",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function evidenceCodes(evidence = [], now = new Date()) {
  const current = now.getTime();
  return unique(evidence.filter((item) => {
    const verifiedAt = Date.parse(item?.verifiedAt || "");
    const maxAgeMinutes = Number(item?.maxAgeMinutes || 30);
    return clean(item?.status) === "VERIFIED"
      && Number.isFinite(verifiedAt)
      && Number.isFinite(maxAgeMinutes)
      && maxAgeMinutes > 0
      && current >= verifiedAt
      && current - verifiedAt <= maxAgeMinutes * 60_000;
  }).map((item) => item.code));
}

function ruleMatchesQuestion(rule, qna) {
  const source = `${clean(qna?.title)} ${clean(qna?.question)}`.toLowerCase();
  const type = clean(qna?.qnaType).toLowerCase();
  const types = unique(rule?.match?.qnaTypes || []).map((value) => value.toLowerCase());
  const anyTerms = unique(rule?.match?.includesAny || []).map((value) => value.toLowerCase());
  const allTerms = unique(rule?.match?.includesAll || []).map((value) => value.toLowerCase());
  return (!types.length || types.includes(type))
    && (!anyTerms.length || anyTerms.some((term) => source.includes(term)))
    && allTerms.every((term) => source.includes(term));
}

function approvedRule(step, qna, rules) {
  const source = step?.proposalSource || {};
  if (clean(source.kind) !== "APPROVED_RULE") return null;
  const matches = (rules || []).filter((rule) => clean(rule?.ruleId) === clean(source.ruleId)
    && clean(rule?.version) === clean(source.ruleVersion)
    && rule?.enabled === true
    && clean(rule?.reply) === clean(step?.reply)
    && ruleMatchesQuestion(rule, qna));
  return matches.length === 1 ? matches[0] : null;
}

export function decideShoplingQnaAutomation(step = {}, qna = {}, options = {}) {
  const requiredEvidence = unique(step?.review?.requiredEvidence || []);
  const verifiedEvidence = evidenceCodes(options.evidence, options.now);
  const missingEvidence = requiredEvidence.filter((code) => !verifiedEvidence.includes(code));
  let decision;
  let reasonCode;
  let rule = null;

  if (clean(step?.review?.reviewTier) === "MANUAL_ONLY") {
    decision = "APPROVAL_REQUIRED";
    reasonCode = "MANUAL_REVIEW_POLICY";
  } else if (missingEvidence.length) {
    decision = "BLOCKED_NEEDS_EVIDENCE";
    reasonCode = "REQUIRED_EVIDENCE_MISSING_OR_STALE";
  } else {
    rule = approvedRule(step, qna, options.approvedRules);
    const allowedTiers = unique(rule?.allowedReviewTiers || ["STANDARD_REVIEW"]);
    if (rule && allowedTiers.includes(clean(step?.review?.reviewTier))) {
      decision = "AUTO_TRANSMIT";
      reasonCode = "EXACT_APPROVED_RULE_MATCH";
    } else {
      decision = "APPROVAL_REQUIRED";
      reasonCode = "NO_EXACT_APPROVED_RULE";
    }
  }

  const policySource = {
    qnaKey: clean(step?.qnaKey),
    questionFingerprint: clean(step?.questionFingerprint),
    replyHash: hash(clean(step?.reply)),
    reviewTier: clean(step?.review?.reviewTier),
    riskCodes: unique(step?.review?.riskCodes || []).sort(),
    requiredEvidence: requiredEvidence.sort(),
    verifiedEvidence: verifiedEvidence.sort(),
    decision,
    reasonCode,
    ruleId: clean(rule?.ruleId),
    ruleVersion: clean(rule?.version),
  };

  return {
    decision,
    reasonCode,
    missingEvidence,
    verifiedEvidence,
    rule: rule ? { ruleId: clean(rule.ruleId), version: clean(rule.version) } : null,
    policyFingerprint: hash(JSON.stringify(policySource)),
  };
}

export function buildShoplingQnaAutomationPlan(qnas = [], replyPlan = {}, options = {}) {
  const current = new Map(qnas.map((qna) => [clean(qna?.qnaKey), qna]));
  const decisions = (replyPlan.replySteps || []).map((step) => {
    const qna = current.get(clean(step.qnaKey));
    const decision = decideShoplingQnaAutomation(step, qna, {
      approvedRules: options.approvedRules,
      evidence: (options.evidence || []).filter((item) => clean(item?.qnaKey) === clean(step.qnaKey)),
      now: options.now,
    });
    return {
      qnaKey: clean(step.qnaKey),
      actionKey: clean(step.actionKey),
      state: decision.decision === "AUTO_TRANSMIT"
        ? "READY_FOR_DRAFT"
        : decision.decision === "APPROVAL_REQUIRED"
          ? "WAITING_FOR_OPERATOR_APPROVAL"
          : "BLOCKED_NEEDS_EVIDENCE",
      ...decision,
    };
  });

  return {
    schemaVersion: 1,
    mode: "PLAN_ONLY",
    decisions,
    approvalQueue: decisions.filter((item) => item.decision === "APPROVAL_REQUIRED"),
    blockedQueue: decisions.filter((item) => item.decision === "BLOCKED_NEEDS_EVIDENCE"),
    counts: Object.fromEntries([...DECISIONS].map((decision) => [
      decision,
      decisions.filter((item) => item.decision === decision).length,
    ])),
    gates: {
      automaticTransmissionRequiresExactApprovedRule: true,
      automaticTransmissionRequiresFreshEvidence: true,
      manualOnlyCanNeverAutoTransmit: true,
    },
  };
}
