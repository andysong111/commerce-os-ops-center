import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const libPath = new URL("../src/lib/internalChinaBrowserMallPriceReadback.ts", import.meta.url);
const bridgePath = new URL("../src/app/api/shopling-price-readback-bridge/route.ts", import.meta.url);
const controlPath = new URL("../src/app/api/china-order-manager/price-review/browser-readback/route.ts", import.meta.url);
const executeRoutePath = new URL("../src/app/api/china-order-manager/price-review/group-aware-execute/route.ts", import.meta.url);
const backgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-price-readback.js", import.meta.url);
const contentPath = new URL("../public/shopling-account-title-bridge/content-shopling-price-readback.js", import.meta.url);
const rootPath = new URL("../public/shopling-account-title-bridge/background-shopling-root.js", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url);

test("browser mall-price queue is read-only, durable and fail-closed", async () => {
  const source = await readFile(libPath, "utf8");
  assert.match(source, /INTERNAL_CHINA_GROUP_COST_PRICE_BROWSER_READBACK_ITEM/);
  assert.match(source, /commerce_operation_runs/);
  assert.match(source, /status: "PENDING"/);
  assert.match(source, /status: "RUNNING"/);
  assert.match(source, /status: succeeded \? "SUCCEEDED" : "FAILED"/);
  assert.match(source, /shoplingWritesEnabled: false/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /mallMismatchCount/);
  assert.match(source, /mallMissingCount/);
  assert.doesNotMatch(source, /prod_modify_api|prod_each_mall_modify_api|apiProdMdy|apiProdEachMdy/);
});

test("extension bridge only claims and reports readback tasks", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE/);
  assert.match(source, /action === "claim"/);
  assert.match(source, /action === "report"/);
  assert.doesNotMatch(source, /prod_modify_api|prod_each_mall_modify_api|apiProdMdy|apiProdEachMdy/);
});

test("Ops control remains same-origin and supports failed-only retry", async () => {
  const source = await readFile(controlPath, "utf8");
  assert.match(source, /isSameOriginOpsRequest/);
  assert.match(source, /retryFailed/);
  assert.match(source, /delayMs/);
});

test("retired unscoped execution cannot bypass synchronous monthly price readback", async () => {
  const source = await readFile(executeRoutePath, "utf8");
  assert.match(source, /isSameOriginOpsRequest/);
  assert.match(source, /MONTHLY_PRICE_EXECUTION_REQUIRED/);
  assert.match(source, /status: 409/);
  assert.doesNotMatch(source, /executeInternalChinaDirectTargetPrices\(/);
  const monthly = await readFile(new URL("../src/lib/monthlyPriceActions.ts", import.meta.url), "utf8");
  const claim = monthly.slice(monthly.indexOf('action === "resendClaim"'));
  assert.match(claim, /verifyMonthlyPricePlan\(item\.plan, item\.candidate, live, observed\)/);
  assert.ok(claim.indexOf("verifyMonthlyPricePlan(") < claim.indexOf('item.state = "RESENDING"'));
});

test("browser worker never writes Shopling and serializes against other workers", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /shopling-price-readback-bridge/);
  assert.match(source, /mode", "price_chg"/);
  assert.match(source, /active: false/);
  assert.match(source, /priceReadbackOtherWorkerBusy/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /prod_modify_api|prod_each_mall_modify_api|\.click\s*\(|requestSubmit|\.submit\s*\(/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("price page parser only reads DOM values and reports canonical columns", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /소비자가/);
  assert.match(source, /판매가/);
  assert.match(source, /매입가\|원가/);
  assert.match(source, /sellPrice/);
  assert.match(source, /purchasePrice/);
  assert.match(source, /consumerPrice/);
  assert.match(source, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(source, /\.click\s*\(|dispatchEvent\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("v0.6.3 package contains browser readback worker and parser", async () => {
  const [root, download] = await Promise.all([
    readFile(rootPath, "utf8"),
    readFile(downloadPath, "utf8"),
  ]);
  assert.match(root, /background-shopling-price-readback\.js/);
  assert.match(download, /content-shopling-price-readback\.js/);
  assert.match(download, /background-shopling-price-readback\.js/);
  assert.match(download, /manifest\.version = "0\.6\.3"/);
  assert.match(download, /v0\.6\.3\.zip/);
  assert.match(download, /content-shopling-price-readback\.js/);
});
