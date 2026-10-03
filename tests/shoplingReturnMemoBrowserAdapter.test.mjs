import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOPLING_RETURN_MEMO_POPUP_PROBE_SOURCE,
  SHOPLING_RETURN_MEMO_PREPARE_SOURCE,
  SHOPLING_RETURN_MEMO_RULES,
  SHOPLING_RETURN_MEMO_SAVE_SOURCE,
  createShoplingReturnMemoBrowserAdapter,
} from "../local-agent/src/shopling-return-memo-browser-adapter.mjs";

test("Shopling return memo adapter saves only the exact order memo and verifies readback", async () => {
  let stored = false;
  let prepared = false;
  const session = {
    async send(method, params) {
      if (method === "Page.reload") {
        stored = true;
        return {};
      }
      assert.equal(method, "Runtime.evaluate");
      const expression = params.expression;
      if (expression.startsWith(`(${SHOPLING_RETURN_MEMO_POPUP_PROBE_SOURCE})`)) {
        return { result: { value: {
          readyState: "complete",
          path: "/order/order_detail_popup.phtml",
          orderNo: "3501008",
          formReady: true,
          memoCategoryAvailable: true,
          saveButtonCount: 1,
          completionChecked: false,
          memoPresent: stored,
        } } };
      }
      if (expression.startsWith(`(${SHOPLING_RETURN_MEMO_PREPARE_SOURCE})`)) {
        prepared = true;
        return { result: { value: {
          prepared: true,
          orderNo: "3501008",
          category: "R",
          memoLength: 80,
          completionChecked: false,
        } } };
      }
      if (expression.startsWith(`(${SHOPLING_RETURN_MEMO_SAVE_SOURCE})`)) {
        assert.equal(prepared, true);
        return { result: { value: { clicked: true } } };
      }
      throw new Error(`Unexpected expression: ${expression}`);
    },
  };
  const adapter = createShoplingReturnMemoBrowserAdapter(session, "3501008", { saveDelayMs: 0 }, {
    sleep: async () => {},
  });
  const result = await adapter.recordReturnInvoiceMemo(
    "[반품수거] CJ대한통운 반품운송장번호: 844764751234 / 원송장: 587625375225",
  );
  assert.deepEqual(result, {
    changed: true,
    alreadyRecorded: false,
    orderNo: "3501008",
    category: "R",
  });
});

test("Shopling return memo contract keeps C/S completion unchecked", () => {
  assert.equal(SHOPLING_RETURN_MEMO_RULES.categoryValue, "R");
  assert.equal(SHOPLING_RETURN_MEMO_RULES.completionUnchecked, true);
  assert.equal(SHOPLING_RETURN_MEMO_RULES.exactOrderRequired, true);
  assert.match(SHOPLING_RETURN_MEMO_PREPARE_SOURCE, /complete\.checked = false/);
});
