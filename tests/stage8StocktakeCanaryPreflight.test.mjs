import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8StocktakeCanaryPreflight.ts", "utf8"),
  readFile("src/app/stage8-stocktake-canary-preflight/page.tsx", "utf8"),
]);

test("preflight starts from the current one-canary intervention plan", () => {
  assert.match(engine, /loadStocktakeInterventionPlan/);
  assert.match(engine, /plan\.rows\.find\(\(row\) => row\.canary\)/);
  assert.match(engine, /plan\.state === "READY_FOR_OPERATOR_COUNT"/);
});

test("preflight rechecks Product Master exact inventory guard read-only", () => {
  assert.match(engine, /\/api\/integrations\/stocktake-canary\?barcode=/);
  assert.match(engine, /method: "GET"/);
  assert.match(engine, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(engine, /x-commerce-os-integration-secret/);
  assert.match(engine, /inventoryBaselineKind === "INITIAL_ZERO"/);
  assert.match(engine, /preview\.inventoryVerified === false/);
  assert.doesNotMatch(engine, /preview\.writeEnabled !== true/);
  assert.match(engine, /productMasterWriteEnabled: preview\.writeEnabled === true/);
});

test("signed one-row write availability does not block the read-only preflight", () => {
  assert.match(
    engine,
    /plan\.state === "READY_FOR_OPERATOR_COUNT" &&\s*exactIdentity &&\s*safeInventory/,
  );
  assert.match(engine, /preview\.writeEnabled\s*\?\s*"Product Master 현재 재고 guard와 서명된 1건 write 경로/);
});

test("operator is asked for one physical quantity only after all gates pass", () => {
  assert.match(engine, /READY_FOR_PHYSICAL_COUNT/);
  assert.match(engine, /requestedOperatorInput: ready \? "PHYSICAL_QUANTITY" : null/);
  assert.match(page, /입력할 값: 현재 창고에 실제로 있는 개수/);
  assert.match(page, /실제 수량 1개뿐입니다/);
});

test("preflight never writes stocktake or purchase data", () => {
  assert.match(engine, /stocktakeWritesEnabled: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(`${engine}\n${page}`, /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(/);
});
