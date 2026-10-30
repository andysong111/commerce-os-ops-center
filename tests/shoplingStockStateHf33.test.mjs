import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF33 builds v0.6.1 from HF32 and replaces the contradictory empty A6 date range", async () => {
  const source = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf33/route.ts",
    "utf8",
  );

  assert.match(source, /getHf32Download/);
  assert.match(source, /const BASE_VERSION = "0\.6\.0"/);
  assert.match(source, /const VERSION = "0\.6\.1"/);
  assert.match(source, /HF33_A6_2022_RANGE_AND_ROW_IDENTITY/);
  assert.match(source, /expectedDateRange = \{ start: "20220101", end: todayKst \}/);
  assert.match(source, /dateScope: "2022_TO_TODAY"/);
  assert.match(source, /A6_DATE_SCOPE_SET_FAILED/);
  assert.match(source, /replaceOnce\(\s*worker,\s*DATE_SCOPE_BEFORE,\s*DATE_SCOPE_AFTER/);
  assert.match(source, /new Function\(worker\)/);
});

test("HF33 binds every exact B-code row to a Shopling goods/option identity and preserves fail-closed guards", async () => {
  const source = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf33/route.ts",
    "utf8",
  );

  assert.match(source, /function a6IdentityPairHF33\(row, text\)/);
  assert.match(source, /input\[name="chk\[\]"\]/);
  assert.match(source, /source: "CHECKBOX_VALUE"/);
  assert.match(source, /source: "ROW_TEXT"/);
  assert.match(source, /const resultRows = allResultRows/);
  assert.match(source, /a6ExactBcodeRowsRequired: true/);
  assert.match(source, /a21AllDateGuardPreserved: true/);
  assert.match(source, /warehouseBridgePreserved: true/);
  assert.match(source, /liveShoplingVerificationRequired: true/);
  assert.match(source, /commerce-os-shopling-stock-state-v\$\{VERSION\}-hf33\.zip/);
});

test("the stock-control UI rejects known-broken extensions through v0.6.4", async () => {
  const [planner, panel] = await Promise.all([
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(
      "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
      "utf8",
    ),
  ]);

  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 6\]/);
  assert.match(panel, /SEARCH_DATE_FIELDS_AMBIGUOUS/);
  assert.match(panel, /A6_DATE_SCOPE_SET_FAILED/);
  assert.match(panel, /v0\.6\.6으로 업데이트해 주세요/);
});
