import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF34 builds v0.6.2 from HF33 and accepts the unique named A6 date pair in background windows", async () => {
  const source = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf34/route.ts",
    "utf8",
  );

  assert.match(source, /getHf33Download/);
  assert.match(source, /const BASE_VERSION = "0\.6\.1"/);
  assert.match(source, /const VERSION = "0\.6\.2"/);
  assert.match(source, /HF34_A6_NAMED_DATE_CONTROLS_BACKGROUND_SAFE/);
  assert.match(source, /DATE_PAIR_HEADER_BEFORE/);
  assert.match(source, /DATE_PAIR_HEADER_AFTER/);
  assert.match(source, /const namedStarts = \[\.\.\.form\.querySelectorAll/);
  assert.match(source, /namedStarts\.length === 1 && namedEnds\.length === 1/);
  assert.match(source, /a6NamedDateControlVisibilityRequired: false/);
  assert.match(source, /a6NamedDateControlUniquenessRequired: true/);
  assert.match(source, /hf33ExactBcodeAndIdentityGuardsPreserved: true/);
  assert.match(source, /new Function\(worker\)/);
});

test("HF34 remains packaged but current stock execution surfaces reject v0.6.2", async () => {
  const [queuePanel, operatorPanel, page] = await Promise.all([
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
  ]);

  assert.match(queuePanel, /supportsAllDateStockSync\(version\)/);
  assert.match(queuePanel, /setExtensionReady\(supported\)/);
  assert.match(queuePanel, /v0\.6\.14로 업데이트해 주세요/);
  assert.match(operatorPanel, /v0\.6\.14로 업데이트/);
  assert.match(page, /download-hf49/);
  assert.doesNotMatch(page, /download-hf34/);
});
