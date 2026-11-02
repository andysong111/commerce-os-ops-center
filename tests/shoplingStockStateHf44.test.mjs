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
  assert.match(route, /row\.productKind === expectedProductKind/);
  assert.match(route, /row\.desiredStatus === "SOLD_OUT"/);
  assert.match(route, /row\.exactInventoryQuantity === 0/);
  assert.match(route, /!row\.syncNeeded && row\.latestSyncOutcome === "SUCCEEDED"/);
  assert.match(route, /startedOrUncertain/);
  assert.match(route, /!row\.syncBlocked/);
  assert.match(route, /text\(body\.jobId\) !== job\.jobId/);
  assert.match(route, /text\(body\.desiredSince\) !== job\.desiredSince/);
  assert.match(route, /recoveredWithoutShoplingResend: true/);
  assert.match(route, /verifiedRow\.syncNeeded/);
  assert.match(route, /verifiedRow\.latestSyncOutcome !== "SUCCEEDED"/);
});

test("HF51 recovers only the exact BBD8 retransmission incident without another Shopling send", async () => {
  const [route, panel] = await Promise.all([
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
    readFile(
      "src/components/china-order-manager/InventoryStockRetransmissionPanel.tsx",
      "utf8",
    ),
  ]);
  const requestId =
    "owner-request-20261101140024695-b4d64f55-042d-4a04-9f7b-6dabf75f3969";
  assert.match(route, /"BBD8-1"/);
  assert.match(route, new RegExp(requestId));
  assert.match(route, /resultCounts: \{ total: 108, success: 83, failure: 25 \}/);
  assert.match(route, /latestSyncAt: "2026-11-01T14:36:34\.755Z"/);
  assert.match(route, /retransmission\.batches\.find/);
  assert.match(route, /batch\.requestId === retransmissionRequestId/);
  assert.match(route, /retransmissionItem\.jobId/);
  assert.match(route, /\["STARTED", "UNCERTAIN"\]/);
  assert.match(route, /row\.latestSyncAt === incident\.latestSyncAt/);
  assert.match(route, /allowPendingReplayRecovery/);
  assert.match(route, /\["PENDING", "STARTED", "BLOCKED"\]/);
  assert.match(panel, new RegExp(requestId));
  assert.match(panel, /item\.barcode === "BBD8-1"/);
  assert.match(panel, /\["STARTED", "BLOCKED"\]\.includes\(item\.state \|\| ""\)/);
  assert.match(panel, /"완료 결과 복구"/);
  const recovery = panel.slice(
    panel.indexOf("const recoverKnownTerminal"),
    panel.indexOf("const rows ="),
  );
  assert.doesNotMatch(recovery, /window\.postMessage/);
  assert.doesNotMatch(recovery, /COMMERCE_OS_SHOPLING_STOCK_SYNC_(?:START|PARALLEL_START)/);
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
  assert.match(panel, /retransmissionRequestId: job\.retransmissionRequestId/);
  assert.match(panel, /"완료 결과 복구"/);
  const recoveryHandler = panel.slice(
    panel.indexOf("const recoverKnownTerminal"),
    panel.indexOf("const pauseAfterCurrent"),
  );
  assert.doesNotMatch(recoveryHandler, /window\.postMessage/);
  assert.doesNotMatch(recoveryHandler, /SINGLE_START|PARALLEL_START/);
});
