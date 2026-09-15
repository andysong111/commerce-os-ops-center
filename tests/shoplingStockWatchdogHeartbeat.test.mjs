import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";

test("HF28 watchdog observes every 30 seconds without redispatching Shopling execution", async () => {
  const source = await readFile(`${root}/background-v070.js`, "utf8");
  assert.match(source, /importScripts\("background-v069\.js"\)/);
  assert.match(source, /watchdog = async function watchdogV070/);
  assert.match(source, /HF28_HEARTBEAT_OBSERVE_ONLY/);
  assert.match(source, /watchdogRedispatchOnTick: false/);
  assert.match(source, /PRE_SUBMIT_IDLE_TIMEOUT_MS_V070 = 3 \* 60 \* 1000/);
  assert.match(source, /PRE_SUBMIT_HARD_TIMEOUT_MS_V070 = 30 \* 60 \* 1000/);
  assert.match(source, /RESULT_TIMEOUT_MS_V070 = 30 \* 60 \* 1000/);
  const watchdogBody = source.slice(source.indexOf("watchdog = async function watchdogV070"));
  assert.doesNotMatch(watchdogBody, /dispatchCurrent\s*\(/);
  assert.match(watchdogBody, /findExactRoleTarget\(stage\)/);
  assert.match(watchdogBody, /STOCK_SYNC_IDLE_TIMEOUT/);
  assert.match(watchdogBody, /STOCK_SYNC_STAGE_HARD_TIMEOUT/);
});

test("Commerce OS progress bridges meaningful work into watchdog heartbeat", async () => {
  const source = await readFile(`${root}/content-ops-heartbeat-v001.js`, "utf8");
  assert.match(source, /COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS/);
  assert.match(source, /STOCK_SYNC_HEARTBEAT_V070/);
  assert.match(source, /source: "OPS_PROGRESS"/);
  assert.match(source, /goodsKeyIndex/);
});

test("HF28 package upgrades to heartbeat watchdog while preserving two-lane sidecar", async () => {
  const source = await readFile("src/app/api/shopling-stock-state-sync/download-hf28/route.ts", "utf8");
  assert.match(source, /const BASE_VERSION = "0\.5\.5"/);
  assert.match(source, /const VERSION = "0\.5\.6"/);
  assert.match(source, /background-v070\.js/);
  assert.match(source, /content-ops-heartbeat-v001\.js/);
  assert.match(source, /OBSERVE_ONLY_HEARTBEAT/);
  assert.match(source, /watchdogRedispatchEvery30s: false/);
  assert.match(source, /preSubmitIdleTimeoutMinutes: 3/);
  assert.match(source, /preSubmitHardTimeoutMinutes: 30/);
  assert.match(source, /parallelMode: "TWO_LANE_OVERLAP_AFTER_SUBMIT"/);
});
