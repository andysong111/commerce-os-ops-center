import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lib = await readFile("src/lib/stage8StocktakeCanaryOperator.ts", "utf8");
const route = await readFile("src/app/api/stage8/stocktake-canary/route.ts", "utf8");
const page = await readFile("src/app/stage8-stocktake-canary/page.tsx", "utf8");

test("operator bridge is pinned to the deterministic first stocktake canary", () => {
  assert.match(lib, /loadStocktakeInterventionPlan/);
  assert.match(lib, /firstCanaryBarcode/);
  assert.match(lib, /planFingerprint/);
  assert.match(lib, /inventoryGuard/);
  assert.match(lib, /INITIAL_ZERO/);
  assert.match(lib, /canaryEligible/);
});

test("operator bridge signs the exact one-row request with the existing integration secret", () => {
  assert.match(lib, /createHmac\("sha256", secret\)/);
  assert.match(lib, /commerce-os-stocktake-canary-v1/);
  assert.match(lib, /x-commerce-os-stocktake-canary-signature/);
  assert.match(lib, /physicalQuantity/);
  assert.match(lib, /expectedInventoryGuard/);
  assert.match(lib, /expectedPlanFingerprint/);
});

test("operator bridge can write at most one Product Master stocktake and no business action", () => {
  assert.match(lib, /api\/integrations\/stocktake-canary/);
  assert.match(route, /maxWriteRows: 1/);
  assert.match(route, /purchaseWritesEnabled: false/);
  assert.match(route, /priceWritesEnabled: false/);
  assert.match(route, /receiptWritesEnabled: false/);
  assert.doesNotMatch(lib, /1688/);
  assert.doesNotMatch(lib, /shopling/i);
});

test("POST is same-origin and requires explicit one-row confirmation", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /APPLY_ONE_STOCKTAKE_CANARY/);
  assert.match(route, /STOCKTAKE_CANARY_CONFIRMATION_REQUIRED/);
});

test("operator page asks only for physical quantity and keeps fail-closed state visible", () => {
  assert.match(page, /일반 발주사이클은 실사 없이 추정재고로 진행/);
  assert.match(page, /재고 불일치를 교정해야 할 때만/);
  assert.match(page, /창고에서 직접 센 실물 수량/);
  assert.match(page, /physicalQuantity/);
  assert.match(page, /WRITE_GATE_OFF/);
  assert.match(page, /STOCKTAKE canary 1건 적용/);
});
