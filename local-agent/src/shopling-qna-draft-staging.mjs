import { runShoplingQnaReplyDraft } from "./shopling-qna-reply-draft.mjs";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function uniqueByKey(items, label) {
  const values = new Map();
  for (const item of items || []) {
    const qnaKey = clean(item?.qnaKey);
    if (!qnaKey || values.has(qnaKey)) {
      fail("QNA_DRAFT_STAGING_REVIEW_INVALID", `${label} require unique inquiry keys.`);
    }
    values.set(qnaKey, item);
  }
  return values;
}

export function buildShoplingQnaDraftStagingPlan(review = {}) {
  const replySteps = uniqueByKey(review?.qnaReplyPlan?.replySteps || review?.replySteps || [], "Reply steps");
  const decisions = uniqueByKey(review?.qnaAutomationPlan?.decisions || [], "Automation decisions");
  const eligible = [];

  for (const qnaKey of replySteps.keys()) {
    if (!decisions.has(qnaKey)) {
      fail("QNA_DRAFT_STAGING_DECISION_MISSING", `The reply step for ${qnaKey} has no automation decision.`);
    }
  }

  for (const [qnaKey, decision] of decisions) {
    const step = replySteps.get(qnaKey);
    if (!step || clean(step.actionKey) !== clean(decision.actionKey)) {
      fail("QNA_DRAFT_STAGING_DECISION_MISMATCH", `The automation decision for ${qnaKey} does not match one reply step.`);
    }
    if (clean(decision?.decision) !== "APPROVAL_REQUIRED") continue;
    if ((decision.missingEvidence || []).length > 0
      || !/^[a-f0-9]{64}$/iu.test(clean(decision.policyFingerprint))) {
      fail("QNA_DRAFT_STAGING_DECISION_INVALID", `The approval decision for ${qnaKey} is incomplete.`);
    }
    eligible.push({ qnaKey, step, decision });
  }

  return {
    eligible,
    counts: {
      approvalDrafts: eligible.length,
      autoTransmit: [...decisions.values()].filter((item) => clean(item?.decision) === "AUTO_TRANSMIT").length,
      blocked: [...decisions.values()].filter((item) => clean(item?.decision) === "BLOCKED_NEEDS_EVIDENCE").length,
    },
  };
}

export async function runShoplingQnaDraftStaging(review = {}, options = {}, dependencies = {}) {
  if (typeof dependencies.readCurrentQnas !== "function"
    || typeof dependencies.adapter?.saveReplyDraft !== "function") {
    fail("QNA_DRAFT_STAGING_DEPENDENCIES_INVALID", "Current QnA reads and a B13 browser adapter are required.");
  }
  const plan = buildShoplingQnaDraftStagingPlan(review);
  const results = [];
  for (const item of plan.eligible) {
    results.push(await runShoplingQnaReplyDraft(item.step, {
      execute: options.execute === true,
      markAsReviewDraft: true,
      allowAutomaticDraft: true,
      decision: item.decision,
    }, dependencies));
  }
  return {
    schemaVersion: 1,
    mode: options.execute === true ? "EXECUTE" : "DRY_RUN",
    status: options.execute === true ? "APPROVAL_DRAFTS_STAGED" : "PREFLIGHT_READY",
    counts: {
      ...plan.counts,
      staged: results.filter((item) => item.externalWritePerformed).length,
      alreadyStaged: results.filter((item) => item.status === "ALREADY_DRAFTED_AND_VERIFIED").length,
    },
    results,
    customerTransmissionPerformed: false,
  };
}
