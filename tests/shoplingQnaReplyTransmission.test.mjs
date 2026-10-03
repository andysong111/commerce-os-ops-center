import assert from "node:assert/strict";
import test from "node:test";
import { shoplingQnaQuestionFingerprint } from "../local-agent/src/shopling-qna-reply-plan.mjs";
import {
  runShoplingQnaReplyTransmission,
  verifyShoplingQnaBeforeTransmission,
  verifyShoplingQnaTransmissionReadback,
} from "../local-agent/src/shopling-qna-reply-transmission.mjs";

function qna(overrides = {}) {
  return {
    qnaKey: "Q-1",
    title: "재고 문의",
    question: "재고가 있나요?",
    answer: "현재 구매 가능합니다.",
    status: "전송대기",
    ...overrides,
  };
}

function step(item = qna()) {
  const questionFingerprint = shoplingQnaQuestionFingerprint({ ...item, status: "신규" });
  return {
    qnaKey: item.qnaKey,
    questionFingerprint,
    actionKey: `qna-reply:${item.qnaKey}:${questionFingerprint.slice(0, 12)}`,
    reply: item.answer,
  };
}

test("QnA transmission dry-run returns an exact action key without writing", async () => {
  let writes = 0;
  const result = await runShoplingQnaReplyTransmission(step(), {}, {
    readCurrentQnas: async () => [qna()],
    adapter: { transmitReply: async () => { writes += 1; } },
  });
  assert.equal(result.status, "PREFLIGHT_READY");
  assert.match(result.actionKey, /^qna-transmit:Q-1:[a-f0-9]{12}:[a-f0-9]{12}$/);
  assert.equal(writes, 0);
});

test("QnA transmission requires the exact action key", async () => {
  await assert.rejects(
    runShoplingQnaReplyTransmission(step(), { execute: true, approvalKey: "wrong" }, {
      readCurrentQnas: async () => [qna()],
      adapter: { transmitReply: async () => {} },
    }),
    { code: "QNA_TRANSMISSION_APPROVAL_REQUIRED" },
  );
});

test("QnA transmission sends once and verifies terminal API state", async () => {
  const reviewed = step();
  const preflight = verifyShoplingQnaBeforeTransmission(reviewed, [qna()]);
  let reads = 0;
  let writes = 0;
  const result = await runShoplingQnaReplyTransmission(reviewed, {
    execute: true,
    approvalKey: preflight.actionKey,
    readbackAttempts: 2,
  }, {
    readCurrentQnas: async () => {
      reads += 1;
      return reads < 3 ? [qna()] : [qna({ status: "답변완료 (사이트)" })];
    },
    adapter: { transmitReply: async () => { writes += 1; } },
    delay: async () => {},
  });
  assert.equal(writes, 1);
  assert.equal(result.status, "TRANSMITTED_AND_VERIFIED");
  assert.equal(result.customerTransmissionPerformed, true);
});

test("already completed matching reply is idempotent", async () => {
  let writes = 0;
  const result = await runShoplingQnaReplyTransmission(step(), { execute: true }, {
    readCurrentQnas: async () => [qna({ status: "답변완료" })],
    adapter: { transmitReply: async () => { writes += 1; } },
  });
  assert.equal(result.status, "ALREADY_TRANSMITTED_AND_VERIFIED");
  assert.equal(writes, 0);
});

test("changed reply, duplicate identity, and incomplete readback fail closed", () => {
  const reviewed = step();
  assert.throws(
    () => verifyShoplingQnaBeforeTransmission(reviewed, [qna({ answer: "다른 답변" })]),
    { code: "QNA_TRANSMISSION_REPLY_CHANGED" },
  );
  assert.throws(
    () => verifyShoplingQnaBeforeTransmission(reviewed, [qna(), qna()]),
    { code: "QNA_TRANSMISSION_CURRENT_IDENTITY_INVALID" },
  );
  const expected = verifyShoplingQnaBeforeTransmission(reviewed, [qna()]);
  assert.throws(
    () => verifyShoplingQnaTransmissionReadback(expected, [qna()]),
    { code: "QNA_TRANSMISSION_NOT_CONFIRMED" },
  );
});

test("a Shopling answer marked [초안] can never be transmitted", async () => {
  const draft = qna({ answer: "[초안] 현재 구매 가능합니다." });
  await assert.rejects(
    runShoplingQnaReplyTransmission({ ...step(draft), reply: draft.answer }, {
      execute: true,
      approvalKey: "any-key",
    }, {
      readCurrentQnas: async () => [draft],
      adapter: { transmitReply: async () => assert.fail("draft transmission must stay blocked") },
    }),
    { code: "QNA_TRANSMISSION_REVIEW_DRAFT_BLOCKED" },
  );
});
