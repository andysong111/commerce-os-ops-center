import assert from "node:assert/strict";
import test from "node:test";
import {
  isExpectedShoplingStatusDialog,
  selectShoplingB7Frame,
  SHOPLING_B7_PAGE_PROBE_EXPRESSION,
  SHOPLING_B7_PREPARE_RETURN_SOURCE,
  SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION,
  SHOPLING_B7_SUBMIT_RETURN_SOURCE,
  SHOPLING_RETURN_B7_RULES,
} from "../local-agent/src/shopling-return-b7-browser-adapter.mjs";

test("B7 probe and snapshot expose only exact order identity and status", () => {
  assert.match(SHOPLING_B7_PAGE_PROBE_EXPRESSION, /order_list\.phtml/);
  assert.match(SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION, /orderNo/);
  assert.match(SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION, /statusCode/);
  assert.doesNotMatch(SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION, /recipient|수취인|연락처|주소/i);
  assert.doesNotMatch(SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION, /\.click\s*\(/);
});

test("B7 preparation fails closed unless every result row is the exact A05 order", () => {
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /matching\.length !== all\.length/);
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /B7_EXACT_ORDER_SET_CHANGED/);
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /B7_SOURCE_STATUS_CHANGED/);
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /checkbox\.checked = false/);
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /checkbox\.checked = true/);
  assert.match(SHOPLING_B7_PREPARE_RETURN_SOURCE, /status_claim_content/);
});

test("B7 submission rechecks selection and verifies the exact confirmation", () => {
  assert.match(SHOPLING_B7_SUBMIT_RETURN_SOURCE, /B7_SELECTED_ORDER_SET_CHANGED/);
  assert.match(SHOPLING_B7_SUBMIT_RETURN_SOURCE, /B7_STATUS_BUTTON_COUNT_INVALID/);
  assert.match(SHOPLING_B7_SUBMIT_RETURN_SOURCE, /주문상태변경/);
  assert.doesNotMatch(SHOPLING_B7_SUBMIT_RETURN_SOURCE, /window\.confirm|window\.alert/);
  assert.equal(isExpectedShoplingStatusDialog({
    type: "confirm",
    message: "선택하신 주문 상태를 변경하시겠습니까?",
  }), true);
  assert.equal(isExpectedShoplingStatusDialog({
    type: "confirm",
    message: "다른 확인 문구",
  }), false);
  assert.deepEqual(SHOPLING_RETURN_B7_RULES, {
    sourceStatus: "A05",
    nextStatus: "R01",
    exactConfirmation: "선택하신 주문 상태를 변경하시겠습니까?",
    searchType: "spl_code",
    searchMatch: "equal",
  });
});

test("B7 frame selection requires exactly one matching child frame", () => {
  const selected = selectShoplingB7Frame([{
    frame: { id: "b7", name: "main" },
    value: { isB7: true, readyState: "complete" },
  }]);
  assert.equal(selected.frame.id, "b7");
  assert.throws(() => selectShoplingB7Frame([]), (error) => (
    error.code === "SHOPLING_B7_FRAME_COUNT_INVALID" && error.matchCount === 0
  ));
});
