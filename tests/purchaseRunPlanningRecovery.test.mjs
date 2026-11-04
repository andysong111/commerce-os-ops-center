import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [preparation, recovery] = await Promise.all([
  readFile("src/lib/purchaseRunPreparation.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesEventRecovery.ts", "utf8"),
]);

test("purchase-run start automatically recovers a planning change instead of showing a raw blocker", () => {
  assert.match(preparation, /salesEventPlanningChangedFailure\(sales\.error\)/);
  assert.match(preparation, /recoverProductMasterShoplingSalesEventRequest\(\)/);
  assert.match(preparation, /recovery\.reason === "LATEST_NOT_FAILED"/);
  assert.match(preparation, /상품 연결정보가 준비 중 갱신되어 최신 연결 기준으로 판매자료를 자동 재계획했습니다/);
  assert.match(recovery, /text\(message\) === "SALES_EVENT_PLANNING_CHANGED"/);
});
