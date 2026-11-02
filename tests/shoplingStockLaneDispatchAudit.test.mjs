import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("parallel stock launch records Lane 2 STARTED only after the extension confirms dispatch", async () => {
  const [queue, direct] = await Promise.all([
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
  ]);
  for (const source of [queue, direct]) {
    assert.match(source, /startedJobIds: Set<string>/);
    assert.match(source, /data\.secondStarted === true/);
    assert.match(source, /extensionConfirmedLaneStart: true/);
    assert.doesNotMatch(source, /Promise\.all\(\s*prepared\.map\(\(job\) =>\s*recordSync\([\s\S]*?"STARTED"/);
  }
  assert.match(queue, /Lane 2는 Shopling에 시작되지 않아 원장에는 대기로 유지/);
  assert.match(direct, /batch\.retainedJobIds\.add\(secondJob\.jobId\)/);
  assert.match(direct, /finishBatch\(batch, batch\.retainedJobIds\)/);
});

test("exception retry creates new replay job ids without requeueing successes or pending work", async () => {
  const route = await readFile(
    "src/app/api/inventory-stock-control/retransmission/route.ts",
    "utf8",
  );
  assert.match(route, /const RETRY_EXCEPTIONS_ACTION = "RETRY_EXCEPTIONS"/);
  assert.match(route, /\["FAILED", "UNCERTAIN"\]/);
  assert.match(route, /jobId: `stock-resend:\$\{requestId\}:\$\{item\.barcode\}:\$\{item\.desiredStatus\}`/);
  assert.match(route, /mode: "REPLAY" as const/);
  assert.match(route, /verified\.items\.some\(\(item\) => item\.state !== "PENDING"\)/);
});

test("operational queue dispatches one semantic mutation and prefers its audited replay job", async () => {
  const route = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  assert.match(route, /function semanticQueueIdentity/);
  assert.match(route, /job\.barcode/);
  assert.match(route, /job\.productKind/);
  assert.match(route, /job\.desiredStatus/);
  assert.match(route, /job\.desiredSince/);
  assert.match(route, /normalJobs\.map\(\(job\) => \[semanticQueueIdentity\(job\), job\]/);
  assert.match(route, /jobsBySemanticIdentity\.set\(semanticQueueIdentity\(replayJob\), replayJob\)/);
  assert.doesNotMatch(route, /\[\.\.\.normalJobs, \.\.\.replayJobs\]\.map\(\(job\) => \[job\.jobId/);
});
