import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyShoplingQnaPopupDraftState,
  verifyShoplingQnaTransmissionRowState,
} from "../local-agent/src/shopling-qna-browser-adapter.mjs";

test("B13 popup readback requires matching identity and answer", () => {
  assert.deepEqual(verifyShoplingQnaPopupDraftState({ qnaKey: "49884" }, {
    path: "/qna/qna_popup.phtml",
    identityMatches: true,
    answerMatches: true,
  }), { qnaKey: "49884", saved: true });
  assert.throws(() => verifyShoplingQnaPopupDraftState({ qnaKey: "49884" }, {
    path: "/qna/qna_popup.phtml",
    identityMatches: false,
    answerMatches: true,
  }), { code: "SHOPLING_QNA_POPUP_IDENTITY_MISMATCH" });
  assert.throws(() => verifyShoplingQnaPopupDraftState({ qnaKey: "49884" }, {
    path: "/qna/qna_popup.phtml",
    identityMatches: true,
    answerMatches: false,
  }), { code: "SHOPLING_QNA_POPUP_ANSWER_MISMATCH" });
});

test("B13 transmission row requires one exact selected sendable inquiry", () => {
  const expected = { qnaKey: "49884" };
  assert.deepEqual(verifyShoplingQnaTransmissionRowState(expected, {
    path: "/qna/qnaList.phtml",
    matchCount: 1,
    selectedCount: 1,
    checkboxValue: "49884",
    ableValue: "49884",
    sendStatus: "답변저장",
  }), { qnaKey: "49884", selected: true });
  assert.throws(() => verifyShoplingQnaTransmissionRowState(expected, {
    path: "/qna/qnaList.phtml",
    matchCount: 1,
    selectedCount: 2,
    checkboxValue: "49884",
    ableValue: "49884",
    sendStatus: "답변저장",
  }), { code: "SHOPLING_QNA_TRANSMISSION_SELECTION_INVALID" });
  assert.throws(() => verifyShoplingQnaTransmissionRowState(expected, {
    path: "/qna/qnaList.phtml",
    matchCount: 1,
    selectedCount: 1,
    checkboxValue: "49884",
    ableValue: "49884",
    sendStatus: "전송완료",
  }), { code: "SHOPLING_QNA_TRANSMISSION_ROW_STATUS_INVALID" });
});
