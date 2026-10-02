import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8CanonicalPurchaseShadow.ts", "utf8"),
  readFile("src/app/stage8-canonical-purchase-shadow/page.tsx", "utf8"),
]);

test("canonical purchase shadow uses persisted Product Master rolling sales as the primary demand source", () => {
  assert.match(engine, /loadProductMasterCanonicalSalesAudit/);
  assert.match(engine, /loadPostApplyCanonicalReconciliation/);
  assert.match(engine, /PRODUCT_MASTER_CANONICAL_SALES_EVENTS/);
  assert.match(engine, /units: canonical\.monthlyUnits\.map\(integer\)/);
  assert.match(engine, /revenue: canonical\.monthlyRevenue\.map\(integer\)/);
  assert.match(engine, /buildLiveProductDecisionSnapshot/);
});

test("purchase funding is frozen to previous calendar month while rolling history remains the demand source", () => {
  assert.match(engine, /cycleAsOf: Date \| string = new Date\(\)/);
  assert.match(engine, /const generatedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(engine, /monthlyPurchaseCycleFor\(cycleAsOf\)/);
  assert.match(engine, /loadCalendarMonthNormalRevenue\(cycle\.budgetMonth\)/);
  assert.match(engine, /recent30Revenue: purchaseBudgetMonthRevenue/);
  assert.match(engine, /1일~말일 정상매출/);
  assert.match(engine, /Demand units\/revenue buckets remain untouched/);
});

test("phase one cannot silently fall back to direct Shopling order demand", () => {
  assert.doesNotMatch(engine, /ShoplingReadClient/);
  assert.doesNotMatch(engine, /aggregateShoplingOrderChunk/);
  assert.doesNotMatch(engine, /combineShoplingLiveChunks/);
  assert.match(engine, /shippedOrders: emptyBuckets\(\)/);
  assert.match(engine, /weightedClaims: emptyBuckets\(\)/);
  assert.match(engine, /claimSignalMode: "NEUTRAL_SHADOW_ONLY"/);
});

test("promotion remains fail closed until claim auxiliary signal is connected", () => {
  assert.match(engine, /promotionReady: false/);
  assert.match(engine, /businessWritesEnabled: false/);
  assert.match(engine, /key: "claim-auxiliary"/);
  assert.match(engine, /key: "calendar-month-purchase-budget"/);
  assert.match(engine, /CANONICAL_FRESHNESS_MAX_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(page, /실제 발주 항상 차단/);
  assert.match(page, /claim auxiliary 연결 전까지 전환 금지/);
});

test("canonical shadow still consumes planning inventory cost MOQ and open China commitments", () => {
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /openChinaOrderCommitmentsByBarcode/);
  assert.match(engine, /planning: matches\[0\]/);
  assert.match(engine, /commitments\.commitments/);
  assert.match(page, /중국 미입고 코드/);
});

test("replacement draft commitments are excluded before product portfolio allocation", () => {
  assert.match(engine, /commitmentOverride/);
  assert.match(engine, /new Map\(options\.commitmentOverride\)/);
  assert.match(engine, /buildLiveProductDecisionSnapshot/);
});

test("planning and canonical active SKU coverage must be exact before shadow is ready", () => {
  assert.match(engine, /matches\.length !== 1/);
  assert.match(engine, /planningMismatchBarcodes/);
  assert.match(engine, /exactPlanningMatchCount !== canonical\.rows\.length/);
  assert.match(
    engine,
    /\(snapshot\.products \?\? \[\]\)\.length !== exactPlanningMatchCount/,
  );
  assert.match(page, /Engine 입력 일치/);
});
