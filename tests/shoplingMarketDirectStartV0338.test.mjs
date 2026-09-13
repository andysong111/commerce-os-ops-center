import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const builderPath = new URL("../src/lib/shoplingMarketDirectStartV0338.ts", import.meta.url);
const routePath = new URL("../src/app/api/shopling-market-group-canary/v0338/download/route.ts", import.meta.url);

test("v0.3.38 removes storage-intent dependency from the actual send click", async () => {
  const source = await readFile(builderPath, "utf8");
  assert.match(source, /safeSendStartMessage/);
  assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: recovery\.constants\.safeSendStartMessage/);
  assert.match(source, /jobIds\.length !== 1/);
  assert.match(source, /직접 안전 claim/);
});

test("v0.3.38 background directly claims from the hardened v0.3.37 server endpoint before opening workers", async () => {
  const source = await readFile(builderPath, "utf8");
  assert.match(source, /startSafeRealSendV0338/);
  assert.match(source, /selectedClaimApi\(runId, item\.jobId, \[\]\)/);
  assert.match(source, /openParallelWorkers\(runId, tasks, \{ tab: control \}\)/);
  assert.match(source, /safe_send_item_not_fresh_pending/);
  assert.match(source, /v0337\/claim/);
  assert.match(source, /replaceAll\([\s\S]*v0338\/claim[\s\S]*v0337\/claim/);
});

test("v0.3.38 package route is versioned and based on v0.3.37", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /previousPackage.*v0337/s);
  assert.match(source, /manifest\.json.*0\.3\.37/s);
  assert.match(source, /commerce-os-shopling-market-sender-v0\.3\.38\.zip/);
});
