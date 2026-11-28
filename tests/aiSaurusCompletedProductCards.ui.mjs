import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletedProductActions } from "../src/app/ai-saurus-bulk-detail/AiSaurusReviewDecisions.tsx";

test("completed product cards expose one retry beside image review for pending and approved results", () => {
  const card = (stage, attempts) => renderToStaticMarkup(createElement(CompletedProductActions, {
    item: { stage, attempts, receipt: { transferReceiptId: "1e31fa04-ed07-43e3-8573-b0988d195cc3" } }, busy: false,
    error: "", decide: assert.fail, onOpen: assert.fail,
  }));
  for (const stage of ["awaiting_review", "approved"]) {
    assert.match(card(stage, 1), /이미지 검수<\/button>.*재시도 · 1회 남음<\/button>/);
    assert.doesNotMatch(card(stage, 1), /disabled=""|승인 거절|URL 저장/);
    assert.match(card(stage, 2), /<button[^>]*disabled=""[^>]*>재시도 사용 완료<\/button>/);
  }
  assert.doesNotMatch(card("approving", 1), /재시도/);
  assert.equal(card("rejected", 1), "");
});
