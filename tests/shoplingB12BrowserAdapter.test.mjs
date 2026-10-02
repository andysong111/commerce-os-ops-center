import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOPLING_B12_DELETE_CLICK_SOURCE,
  SHOPLING_B12_PAGE_PROBE_EXPRESSION,
  SHOPLING_B12_PREPARE_SELECTION_SOURCE,
  SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION,
} from "../local-agent/src/shopling-b12-browser-adapter.mjs";

test("B12 browser probes identify the framed courier page without personal fields", () => {
  assert.match(SHOPLING_B12_PAGE_PROBE_EXPRESSION, /dlvy_list\.phtml/);
  assert.match(SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, /shoplingOrderNo/);
  assert.match(SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, /cells\?\.\[11\]/);
  assert.doesNotMatch(SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, /cells\?\.\[(?:7|8|9)\]/);
  assert.doesNotMatch(SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, /수취인|연락처|주소/);
  assert.doesNotMatch(SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, /\.click\s*\(/);
});

test("B12 deletion source rechecks and selects only the approved order set", () => {
  assert.match(SHOPLING_B12_PREPARE_SELECTION_SOURCE, /expectedSet/);
  assert.match(SHOPLING_B12_PREPARE_SELECTION_SOURCE, /checkbox\.checked = false/);
  assert.match(SHOPLING_B12_PREPARE_SELECTION_SOURCE, /checkbox\.checked = true/);
  assert.match(SHOPLING_B12_DELETE_CLICK_SOURCE, /B12_SELECTED_ORDER_SET_CHANGED/);
  assert.match(SHOPLING_B12_DELETE_CLICK_SOURCE, /송장번호삭제/);
});
