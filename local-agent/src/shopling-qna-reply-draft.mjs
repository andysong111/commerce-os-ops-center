import { createHash } from "node:crypto";
import {
  assessShoplingQnaReply,
  shoplingQnaContentFingerprint,
  shoplingQnaQuestionFingerprint,
} from "./shopling-qna-reply-plan.mjs";

const UNANSWERED_STATUSES = new Set(["미답변", "신규"]);
const DRAFTED_STATUS = "전송대기";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

export function normalizeShoplingQnaReplyStep(step = {}) {
  const qnaKey = clean(step.qnaKey);
  const questionFingerprint = clean(step.questionFingerprint);
  const reply = clean(step.reply);
  if (!qnaKey || !/^[a-f0-9]{64}$/i.test(questionFingerprint) || !reply) {
    fail("QNA_REPLY_STEP_INVALID", "A QnA reply step requires its key, question fingerprint, and reply text.");
  }
  const actionKey = `qna-reply:${qnaKey}:${questionFingerprint.slice(0, 12)}`;
  if (clean(step.actionKey) !== actionKey) {
    fail("QNA_REPLY_ACTION_KEY_INVALID", "The QnA reply action key does not match its reviewed question.");
  }
  return {
    qnaKey,
    questionFingerprint,
    reply,
    actionKey,
    replyHash: createHash("sha256").update(reply, "utf8").digest("hex"),
  };
}

function exactQna(qnas, qnaKey, code) {
  const matches = (qnas || []).filter((qna) => clean(qna?.qnaKey) === qnaKey);
  if (matches.length !== 1) {
    fail(code, `Expected one current QnA for ${qnaKey}, found ${matches.length}.`, { matchCount: matches.length });
  }
  return matches[0];
}

export function verifyShoplingQnaBeforeDraft(step, qnas = []) {
  const expected = normalizeShoplingQnaReplyStep(step);
  const current = exactQna(qnas, expected.qnaKey, "QNA_REPLY_CURRENT_IDENTITY_INVALID");
  if (!UNANSWERED_STATUSES.has(clean(current.status))) {
    fail("QNA_REPLY_STATUS_CHANGED", "The inquiry is no longer unanswered.", { status: clean(current.status) });
  }
  if (shoplingQnaQuestionFingerprint(current) !== expected.questionFingerprint) {
    fail("QNA_REPLY_QUESTION_CHANGED", "The inquiry changed after the reply was reviewed.");
  }
  return {
    ...expected,
    contentFingerprint: shoplingQnaContentFingerprint(current),
    review: assessShoplingQnaReply(current, expected.reply),
  };
}

export function verifyShoplingQnaDraftReadback(expected, qnas = []) {
  const current = exactQna(qnas, expected.qnaKey, "QNA_REPLY_READBACK_IDENTITY_INVALID");
  if (clean(current.status) !== DRAFTED_STATUS) {
    fail("QNA_REPLY_DRAFT_STATUS_NOT_VERIFIED", "The saved reply did not enter the B13 transmission queue.", {
      status: clean(current.status),
    });
  }
  if (shoplingQnaContentFingerprint(current) !== expected.contentFingerprint) {
    fail("QNA_REPLY_READBACK_QUESTION_CHANGED", "The inquiry content changed while the reply was being saved.");
  }
  if (clean(current.answer) !== expected.reply) {
    fail("QNA_REPLY_DRAFT_TEXT_NOT_VERIFIED", "The answer read back from Shopling differs from the approved reply.");
  }
  return { qnaKey: expected.qnaKey, status: DRAFTED_STATUS, verified: true };
}

export async function runShoplingQnaReplyDraft(step, options = {}, dependencies = {}) {
  if (typeof dependencies.readCurrentQnas !== "function"
    || typeof dependencies.adapter?.saveReplyDraft !== "function") {
    fail("QNA_REPLY_DRAFT_DEPENDENCIES_INVALID", "Current QnA reads and a B13 browser adapter are required.");
  }

  const before = await dependencies.readCurrentQnas();
  const expected = verifyShoplingQnaBeforeDraft(step, before);
  const base = {
    schemaVersion: 1,
    qnaKey: expected.qnaKey,
    actionKey: expected.actionKey,
    questionFingerprint: expected.questionFingerprint,
    contentFingerprint: expected.contentFingerprint,
    replyHash: expected.replyHash,
    review: expected.review,
  };

  if (options.execute !== true) {
    return {
      ...base,
      mode: "DRY_RUN",
      status: "PREFLIGHT_READY",
      externalWritePerformed: false,
    };
  }
  if (clean(options.approvalKey) !== expected.actionKey) {
    fail("QNA_REPLY_DRAFT_APPROVAL_REQUIRED", "Execution requires the exact reviewed QnA action key.");
  }

  await dependencies.adapter.saveReplyDraft(expected);
  const after = await dependencies.readCurrentQnas();
  const readback = verifyShoplingQnaDraftReadback(expected, after);
  return {
    ...base,
    mode: "EXECUTE",
    status: "DRAFT_SAVED_AND_VERIFIED",
    b13Status: readback.status,
    externalWritePerformed: true,
    customerTransmissionPerformed: false,
  };
}
