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
  assert.match(engine, /preview\.writeEnabled\s*\?\s*"선택형 재고보정 경로의 Product Master guard와 서명된 1건 write 경로/);
});

test("physical quantity is optional and reserved for inventory correction", () => {
  assert.match(engine, /READY_FOR_PHYSICAL_COUNT/);
  assert.match(engine, /requestedOperatorInput: ready \? "PHYSICAL_QUANTITY" : null/);
  assert.match(page, /오류 교정이 필요하다고 판단한 경우에만 실제 수량을 입력/);
  assert.match(page, /재고실사 필수 아님/);
  assert.match(page, /SOLD_OUT_RESET=0/);
  assert.match(page, /중국 확정입고와 판매를 누적/);
});

test("preflight never writes stocktake or purchase data", () => {
  assert.match(engine, /stocktakeWritesEnabled: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(`${engine}\n${page}`, /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(/);
});
