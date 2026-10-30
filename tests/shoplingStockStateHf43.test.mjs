import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF43 durably records an exact operational terminal replay after page or extension reload", async () => {
  const source = await readFile(
    "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "utf8",
  );

  assert.match(source, /initialPayload\.jobs\.map\(\(job\) => \[job\.jobId, job\]\)/);
  assert.match(source, /replayJob\?\.operationalQueue === true/);
  assert.match(source, /queuedJob\.barcode === replayJob\.barcode/);
  assert.match(source, /queuedJob\.productKind === replayJob\.productKind/);
  assert.match(source, /queuedJob\.desiredStatus === replayJob\.desiredStatus/);
  assert.match(source, /recoveredTerminalReplay: true/);
  assert.match(source, /recoveredWithoutShoplingResend: true/);
  assert.match(source, /await recordSync\([\s\S]*?await loadQueue\(\)/);
  assert.doesNotMatch(
    source,
    /recoveredTerminalReplay[\s\S]{0,800}window\.postMessage\([\s\S]{0,100}SINGLE_START/,
  );
});

test("HF43 keeps ordinary live batch handling and result-persist failure stop behavior", async () => {
  const source = await readFile(
    "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "utf8",
  );

  assert.match(source, /if \(!batch\.jobs\.some\(\(job\) => job\.jobId === result\.jobId\)\) return/);
  assert.match(source, /setPhase\("RESULT_PERSIST_FAILED"\)/);
  assert.match(source, /continueAfterBatch\.current = false/);
});
