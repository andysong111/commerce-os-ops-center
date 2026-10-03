import assert from "node:assert/strict";
import test from "node:test";
import {
  isShoplingQnaReviewDraft,
  markShoplingQnaReviewDraft,
  stripShoplingQnaDraftPrefix,
} from "../local-agent/src/shopling-qna-draft-marker.mjs";
import {
  buildShoplingQnaDraftStagingPlan,
  runShoplingQnaDraftStaging,
} from "../local-agent/src/shopling-qna-draft-staging.mjs";
import { shoplingQnaQuestionFingerprint } from "../local-agent/src/shopling-qna-reply-plan.mjs";

function qna(overrides = {}) {
  return {
    qnaKey: "Q-1",
    title: "상품 문의",
    question: "사용 방법이 궁금합니다.",
    answer: "",
    status: "신규",
    ...overrides,
  };
}

function review(decision = "APPROVAL_REQUIRED") {
  const item = qna();
  const questionFingerprint = shoplingQnaQuestionFingerprint(item);
  const actionKey = `qna-reply:${item.qnaKey}:${questionFingerprint.slice(0, 12)}`;
  return {
    qnaReplyPlan: {
      replySteps: [{
        qnaKey: item.qnaKey,
        questionFingerprint,
        actionKey,
        reply: "안녕하세요. 손잡이를 시계 방향으로 돌려 사용해 주세요. 감사합니다.",
      }],
    },
    qnaAutomationPlan: {
      decisions: [{
        qnaKey: item.qnaKey,
        actionKey,
        decision,
        reasonCode: decision === "APPROVAL_REQUIRED" ? "NO_EXACT_APPROVED_RULE" : "REQUIRED_EVIDENCE_MISSING_OR_STALE",
        missingEvidence: decision === "APPROVAL_REQUIRED" ? [] : ["VERIFIED_PRODUCT_FACTS"],
        policyFingerprint: "a".repeat(64),
      }],
    },
  };
}

test("Shopling review draft marker is normalized exactly once", () => {
  assert.equal(markShoplingQnaReviewDraft("답변입니다."), "[초안] 답변입니다.");
  assert.equal(markShoplingQnaReviewDraft("[초안] [초안] 답변입니다."), "[초안] 답변입니다.");
  assert.equal(stripShoplingQnaDraftPrefix("[초안] 답변입니다."), "답변입니다.");
  assert.equal(isShoplingQnaReviewDraft(" [초안] 답변입니다."), true);
});

test("only approval-required replies are selected for Shopling draft staging", () => {
  assert.equal(buildShoplingQnaDraftStagingPlan(review()).counts.approvalDrafts, 1);
  const blocked = buildShoplingQnaDraftStagingPlan(review("BLOCKED_NEEDS_EVIDENCE"));
  assert.equal(blocked.counts.approvalDrafts, 0);
  assert.equal(blocked.counts.blocked, 1);
});

test("blocked replies perform no Shopling write", async () => {
  let writes = 0;
  const result = await runShoplingQnaDraftStaging(review("BLOCKED_NEEDS_EVIDENCE"), {
    execute: true,
  }, {
    readCurrentQnas: async () => [qna()],
    adapter: { saveReplyDraft: async () => { writes += 1; } },
  });
  assert.equal(writes, 0);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.counts.staged, 0);
});

test("approval-required reply is saved with [초안] and never transmitted", async () => {
  const input = review();
  const item = qna();
  let reads = 0;
  let savedReply = "";
  const result = await runShoplingQnaDraftStaging(input, { execute: true }, {
    readCurrentQnas: async () => {
      reads += 1;
      return reads === 1
        ? [item]
        : [qna({ status: "전송대기", answer: savedReply })];
    },
    adapter: {
      saveReplyDraft: async (expected) => {
        savedReply = expected.reply;
      },
    },
  });
  assert.equal(savedReply, "[초안] 안녕하세요. 손잡이를 시계 방향으로 돌려 사용해 주세요. 감사합니다.");
  assert.equal(result.counts.staged, 1);
  assert.equal(result.customerTransmissionPerformed, false);
  assert.equal(result.results[0].reviewDraftMarked, true);
});

test("an identical [초안] answer is an idempotent no-op", async () => {
  const input = review();
  const saved = "[초안] 안녕하세요. 손잡이를 시계 방향으로 돌려 사용해 주세요. 감사합니다.";
  let writes = 0;
  const result = await runShoplingQnaDraftStaging(input, { execute: true }, {
    readCurrentQnas: async () => [qna({ status: "전송대기", answer: saved })],
    adapter: { saveReplyDraft: async () => { writes += 1; } },
  });
  assert.equal(writes, 0);
  assert.equal(result.counts.alreadyStaged, 1);
  assert.equal(result.results[0].status, "ALREADY_DRAFTED_AND_VERIFIED");
});

test("a conflicting saved Shopling answer fails closed", async () => {
  await assert.rejects(
    runShoplingQnaDraftStaging(review(), { execute: true }, {
      readCurrentQnas: async () => [qna({ status: "전송대기", answer: "[초안] 다른 답변" })],
      adapter: { saveReplyDraft: async () => {} },
    }),
    { code: "QNA_REPLY_EXISTING_DRAFT_CONFLICT" },
  );
});
