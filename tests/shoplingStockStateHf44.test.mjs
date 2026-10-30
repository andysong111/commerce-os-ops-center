import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF44/HF45 recover only allowlisted exact terminal incidents", async () => {
  const route = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );

  assert.match(route, /RECOVER_KNOWN_SHOPLING_TERMINAL/);
  assert.match(route, /"BBB4-3"/);
  assert.match(route, /"BBD3-1"/);
  assert.match(route, /productKind: "OPTION"/);
  assert.match(route, /상품옵션 수정 전송이 완료되었습니다\./);
  assert.match(route, /row\.barcode === requestedBarcode/);
  assert.match(route, /row\.productKind === incident\.productKind/);
  assert.match(route, /row\.desiredStatus === "SOLD_OUT"/);
  assert.match(route, /row\.exactInventoryQuantity === 0/);
  assert.match(route, /!row\.syncNeeded && row\.latestSyncOutcome === "SUCCEEDED"/);
  assert.match(route, /!row\.syncNeeded \|\| row\.syncBlocked/);
  assert.match(route, /text\(body\.jobId\) !== job\.jobId/);
  assert.match(route, /text\(body\.desiredSince\) !== job\.desiredSince/);
  assert.match(route, /recoveredWithoutShoplingResend: true/);
  assert.match(route, /verifiedRow\.syncNeeded/);
  assert.match(route, /verifiedRow\.latestSyncOutcome !== "SUCCEEDED"/);
});

test("HF44/HF45 expose allowlisted recovery buttons without Shopling dispatch", async () => {
  const panel = await readFile(
    "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "utf8",
  );

  assert.match(panel, /const recoverKnownTerminal = async \(job: SyncJob\)/);
  assert.match(panel, /job\.barcode === "BBB4-3"/);
  assert.match(panel, /job\.barcode === "BBD3-1"/);
  assert.match(panel, /isKnownTerminalRecoveryJob\(job\)/);
  assert.match(panel, /action: KNOWN_TERMINAL_RECOVERY_ACTION/);
  assert.match(panel, /"완료 결과 복구"/);
  const recoveryHandler = panel.slice(
    panel.indexOf("const recoverKnownTerminal"),
    panel.indexOf("const pauseAfterCurrent"),
  );
  assert.doesNotMatch(recoveryHandler, /window\.postMessage/);
  assert.doesNotMatch(recoveryHandler, /SINGLE_START|PARALLEL_START/);
});
