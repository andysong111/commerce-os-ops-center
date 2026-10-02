import assert from "node:assert/strict";
import test from "node:test";
import { shoplingQnaQuestionFingerprint } from "../local-agent/src/shopling-qna-reply-plan.mjs";
import {
  normalizeShoplingQnaReplyStep,
  runShoplingQnaReplyDraft,
  verifyShoplingQnaDraftReadback,
} from "../local-agent/src/shopling-qna-reply-draft.mjs";

function qna(overrides = {}) {
  return {
    qnaKey: "Q-1",
    title: "배송 문의",
    question: "언제 출고되나요?",
    answer: "",
    status: "신규",
    ...overrides,
  };
}

function step(item = qna(), reply = "금일 출고 예정입니다.") {
  const fingerprint = shoplingQnaQuestionFingerprint(item);
  return {
    qnaKey: item.qnaKey,
    questionFingerprint: fingerprint,
    reply,
    actionKey: `qna-reply:${item.qnaKey}:${fingerprint.slice(0, 12)}`,
  };
}

test("QnA draft stays read-only without execution", async () => {
  let writes = 0;
  const item = qna();
  const result = await runShoplingQnaReplyDraft(step(item), {}, {
    readCurrentQnas: async () => [item],
    adapter: { saveReplyDraft: async () => { writes += 1; } },
  });
  assert.equal(result.status, "PREFLIGHT_READY");
  assert.equal(result.externalWritePerformed, false);
  assert.equal(writes, 0);
  assert.equal("reply" in result, false);
});

test("QnA draft requires the exact reviewed action key", async () => {
  const item = qna();
  await assert.rejects(
    runShoplingQnaReplyDraft(step(item), { execute: true, approvalKey: "wrong" }, {
      readCurrentQnas: async () => [item],
      adapter: { saveReplyDraft: async () => {} },
    }),
    { code: "QNA_REPLY_DRAFT_APPROVAL_REQUIRED" },
  );
});

test("QnA draft saves once and verifies transmission-queue readback", async () => {
  const item = qna();
  const reviewed = step(item);
  let reads = 0;
  let writes = 0;
  const result = await runShoplingQnaReplyDraft(reviewed, {
    execute: true,
    approvalKey: reviewed.actionKey,
  }, {
    readCurrentQnas: async () => {
      reads += 1;
      return reads === 1 ? [item] : [qna({ status: "전송대기", answer: reviewed.reply })];
    },
    adapter: {
      saveReplyDraft: async (expected) => {
        writes += 1;
        assert.equal(expected.qnaKey, "Q-1");
      },
    },
  });
  assert.equal(writes, 1);
  assert.equal(result.status, "DRAFT_SAVED_AND_VERIFIED");
  assert.equal(result.customerTransmissionPerformed, false);
  assert.equal("reply" in result, false);
});

test("QnA draft blocks stale questions and non-queued readback", async () => {
  const original = qna();
  const reviewed = step(original);
  await assert.rejects(
    runShoplingQnaReplyDraft(reviewed, {}, {
      readCurrentQnas: async () => [qna({ question: "질문이 수정됨" })],
      adapter: { saveReplyDraft: async () => {} },
    }),
    { code: "QNA_REPLY_QUESTION_CHANGED" },
  );
  const expected = {
    ...normalizeShoplingQnaReplyStep(reviewed),
    contentFingerprint: "not-the-current-fingerprint",
  };
  assert.throws(
    () => verifyShoplingQnaDraftReadback(expected, [qna({ status: "신규" })]),
    { code: "QNA_REPLY_DRAFT_STATUS_NOT_VERIFIED" },
  );
});

test("QnA draft refuses duplicate current identities", async () => {
  const item = qna();
  await assert.rejects(
    runShoplingQnaReplyDraft(step(item), {}, {
      readCurrentQnas: async () => [item, item],
      adapter: { saveReplyDraft: async () => {} },
    }),
    { code: "QNA_REPLY_CURRENT_IDENTITY_INVALID" },
  );
});
