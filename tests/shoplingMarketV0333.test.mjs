import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0333/download/route.ts", import.meta.url);
const pipelineRoute = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);

const read = (url) => readFile(url, "utf8");

test("v0.3.33 keeps market-only period sender and uses fresh browser runtime keys", async () => {
  const source = await read(packageRoute);
  assert.match(source, /const VERSION = "0\.3\.33"/);
  assert.match(source, /getV0332Package/);
  assert.match(source, /commerceOsShoplingParallelRunV0333/);
  assert.match(source, /commerceOsShoplingParallelWorkerMetaV0333/);
  assert.match(source, /commerceOsShoplingMarketSelectionQueueV0333/);
  assert.match(source, /commerce-os-shopling-selected-market-start-v0333/);
  assert.match(source, /stale browser runtime state is never revived/);
  assert.doesNotMatch(source, /content-shopling-account-titles\.js|background-shopling-title-batch\.js/);
});

test("A18 identity reads hidden DOM goods_key evidence before falling back", async () => {
  const source = await read(packageRoute);
  assert.match(source, /rowHasGoodsKeyEvidence/);
  assert.match(source, /row\?\.outerHTML/);
  assert.match(source, /identityMode: \\"goods_key_dom\\"/);
  assert.match(source, /identityMode: \\"single_result_exact_code\\"/);
  assert.match(source, /resultCount === 1 && codeRows\.length === 1/);
  assert.match(source, /Multiple results never use this fallback/);
});

test("A18 failure diagnostics include result and identity row counts", async () => {
  const source = await read(packageRoute);
  assert.match(source, /코드일치행=\$\{codeRows\.length\}/);
  assert.match(source, /goods_key DOM일치행=\$\{exactRows\.length\}/);
  assert.match(source, /exact_product_identity_ambiguous/);
});

test("pre-submit release preserves failure reason and message in durable ledger", async () => {
  const source = await read(pipelineRoute);
  assert.match(source, /const failureReasonCode = text\(payload\.reasonCode\)\.slice\(0, 120\)/);
  assert.match(source, /const failureMessage = text\(payload\.message\)\.slice\(0, 1000\)/);
  assert.match(source, /reason_code: failureReasonCode/);
  assert.match(source, /message: failureMessage/);
  assert.match(source, /\.eq\("market_status", "pending"\)/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
});
