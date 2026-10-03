import { createHash } from "node:crypto";
import { shoplingQnaContentFingerprint } from "./shopling-qna-reply-plan.mjs";
import { isShoplingQnaReviewDraft } from "./shopling-qna-draft-marker.mjs";

const QUEUED_STATUS = "전송대기";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function exactQna(qnas, qnaKey, code) {
  const matches = (qnas || []).filter((qna) => clean(qna?.qnaKey) === qnaKey);
  if (matches.length !== 1) {
    fail(code, `Expected one current QnA for ${qnaKey}, found ${matches.length}.`, {
      matchCount: matches.length,
    });
  }
  return matches[0];
}

function completed(status) {
  return /^답변완료(?:\s*\(사이트\))?$/u.test(clean(status));
}

export function normalizeShoplingQnaTransmissionStep(step = {}, currentQna = {}) {
  const qnaKey = clean(step.qnaKey);
  const reply = clean(step.reply);
  if (!qnaKey || !reply || clean(currentQna?.qnaKey) !== qnaKey) {
    fail("QNA_TRANSMISSION_STEP_INVALID", "A transmission requires one exact inquiry and reply.");
  }
  if (isShoplingQnaReviewDraft(reply) || isShoplingQnaReviewDraft(currentQna?.answer)) {
    fail("QNA_TRANSMISSION_REVIEW_DRAFT_BLOCKED", "A reply marked [초안] cannot be transmitted to the marketplace.");
  }
  const replyHash = sha256(reply);
  const contentFingerprint = shoplingQnaContentFingerprint(currentQna);
  const actionKey = `qna-transmit:${qnaKey}:${contentFingerprint.slice(0, 12)}:${replyHash.slice(0, 12)}`;
  return { qnaKey, reply, replyHash, contentFingerprint, actionKey };
}

export function verifyShoplingQnaBeforeTransmission(step, qnas = []) {
  const qnaKey = clean(step?.qnaKey);
  const current = exactQna(qnas, qnaKey, "QNA_TRANSMISSION_CURRENT_IDENTITY_INVALID");
  const expected = normalizeShoplingQnaTransmissionStep(step, current);
  if (sha256(clean(current.answer)) !== expected.replyHash) {
    fail("QNA_TRANSMISSION_REPLY_CHANGED", "The B13 answer differs from the reviewed reply.");
  }
  if (completed(current.status)) {
    return { ...expected, alreadyCompleted: true, currentStatus: clean(current.status) };
  }
  if (clean(current.status) !== QUEUED_STATUS) {
    fail("QNA_TRANSMISSION_STATUS_INVALID", "Only a B13 transmission-queue reply can be sent.", {
      status: clean(current.status),
    });
  }
  return { ...expected, alreadyCompleted: false, currentStatus: QUEUED_STATUS };
}

export function verifyShoplingQnaTransmissionReadback(expected, qnas = []) {
  const current = exactQna(qnas, expected.qnaKey, "QNA_TRANSMISSION_READBACK_IDENTITY_INVALID");
  if (shoplingQnaContentFingerprint(current) !== expected.contentFingerprint) {
    fail("QNA_TRANSMISSION_READBACK_QUESTION_CHANGED", "The inquiry content changed during transmission.");
  }
  if (sha256(clean(current.answer)) !== expected.replyHash) {
    fail("QNA_TRANSMISSION_READBACK_REPLY_CHANGED", "The transmitted answer no longer matches review.");
  }
  if (!completed(current.status)) {
    fail("QNA_TRANSMISSION_NOT_CONFIRMED", "Shopling did not report a completed answer status.", {
      status: clean(current.status),
    });
  }
  return { qnaKey: expected.qnaKey, status: clean(current.status), verified: true };
}

export async function runShoplingQnaReplyTransmission(step, options = {}, dependencies = {}) {
  if (typeof dependencies.readCurrentQnas !== "function"
    || typeof dependencies.adapter?.transmitReply !== "function") {
    fail("QNA_TRANSMISSION_DEPENDENCIES_INVALID", "Current QnA reads and a B13 browser adapter are required.");
  }
  const before = await dependencies.readCurrentQnas();
  const expected = verifyShoplingQnaBeforeTransmission(step, before);
  const base = {
    schemaVersion: 1,
    qnaKey: expected.qnaKey,
    actionKey: expected.actionKey,
    contentFingerprint: expected.contentFingerprint,
    replyHash: expected.replyHash,
  };

  if (expected.alreadyCompleted) {
    return {
      ...base,
      mode: "VERIFY_ONLY",
      status: "ALREADY_TRANSMITTED_AND_VERIFIED",
      b13Status: expected.currentStatus,
      externalWritePerformed: false,
      customerTransmissionPerformed: false,
    };
  }
  if (options.execute !== true) {
    return {
      ...base,
      mode: "DRY_RUN",
      status: "PREFLIGHT_READY",
      externalWritePerformed: false,
      customerTransmissionPerformed: false,
    };
  }

  const manualApproved = clean(options.approvalKey) === expected.actionKey;
  const automaticApproved = options.allowAutomatic === true
    && clean(options.decision?.decision) === "AUTO_TRANSMIT"
    && clean(options.decision?.reasonCode) === "EXACT_APPROVED_RULE_MATCH"
    && clean(options.decision?.qnaKey) === expected.qnaKey
    && clean(options.decision?.actionKey) === clean(step.actionKey)
    && clean(options.decision?.rule?.ruleId)
    && clean(options.decision?.rule?.version)
    && (options.decision?.missingEvidence || []).length === 0
    && /^[a-f0-9]{64}$/i.test(clean(options.decision?.policyFingerprint));
  if (!manualApproved && !automaticApproved) {
    fail("QNA_TRANSMISSION_APPROVAL_REQUIRED", "Transmission requires the exact action key or a verified automatic-policy decision.");
  }

  await dependencies.adapter.transmitReply(expected);
  const attempts = Number(options.readbackAttempts || 6);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await (dependencies.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
      Number(options.readbackDelayMs || 2_000),
    );
    try {
      const readback = verifyShoplingQnaTransmissionReadback(
        expected,
        await dependencies.readCurrentQnas(),
      );
      return {
        ...base,
        mode: "EXECUTE",
        status: "TRANSMITTED_AND_VERIFIED",
        b13Status: readback.status,
        externalWritePerformed: true,
        customerTransmissionPerformed: true,
      };
    } catch (error) {
      if (error.code !== "QNA_TRANSMISSION_NOT_CONFIRMED") throw error;
      lastError = error;
    }
  }
  throw lastError;
}
