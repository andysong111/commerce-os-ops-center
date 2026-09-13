import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0332/download/route.ts", import.meta.url);
const claimAllRoute = new URL("../src/app/api/shopling-market-group-canary/selection/claim-all/route.ts", import.meta.url);
const statusRoute = new URL("../src/app/api/shopling-market-group-canary/selection/status/route.ts", import.meta.url);
const read = (url) => readFile(url, "utf8");

test("v0.3.32 derives from market-only v0.3.31 and preserves period-only package", async () => {
  const source = await read(packageRoute);
  assert.match(source, /const VERSION = "0\.3\.32"/);
  assert.match(source, /getV0331Package/);
  assert.match(source, /Market Sender · 기간 미전송 전용/);
  assert.match(source, /Market only: title diversification excluded/);
  assert.doesNotMatch(source, /content-shopling-account-titles\.js|background-shopling-title-batch\.js/);
});

test("v0.3.32 reuses only the active worker that owns the same durable claim epoch", async () => {
  const source = await read(packageRoute);
  assert.match(source, /claimEpoch: text\(raw\?\.claimEpoch\)/);
  assert.match(source, /const reusableGoodsKeys = new Set\(\)/);
  assert.match(source, /assignment\?\.status !== 'active'/);
  assert.match(source, /assignment\?\.task\?\.claimEpoch/);
  assert.match(source, /assignmentEpoch === incomingEpoch/);
  assert.match(source, /age < 30000/);
  assert.match(source, /tasks\.filter\(\(task\) => !reusableGoodsKeys\.has\(task\.goodsKey\)\)/);
});

test("selected claim-all issues a fresh claimed_at claimEpoch and releases pre-submit dead workers after two minutes", async () => {
  const source = await read(claimAllRoute);
  assert.match(source, /STALE_PRE_SUBMIT_MS = 2 \* 60 \* 1000/);
  assert.match(source, /claimEpoch: text\(row\.claimed_at\)/);
  assert.match(source, /claimed_at/);
  assert.match(source, /stale_selected_claim_released_v0332/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
  assert.match(source, /claimEpochs:/);
});

test("status polling watchdog uses the same pre-submit safety boundary", async () => {
  const source = await read(statusRoute);
  assert.match(source, /STALE_PRE_SUBMIT_MS = 2 \* 60 \* 1000/);
  assert.match(source, /auto_stale_pre_submit_released_v0331/);
  assert.match(source, /\.eq\("status", "claimed"\)/);
  assert.match(source, /\.eq\("market_status", "pending"\)/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
});
