import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OCTOBER_2026_SOURCE_ORDER_PURCHASE_COST_EVIDENCE as evidence,
  OCTOBER_2026_UNRESOLVED_LEGACY_COST_BARCODES as unresolved,
} from "../src/data/october2026SourceOrderPurchaseCostEvidence.ts";

const [engine, route] = await Promise.all([
  readFile("src/lib/october2026SourceOrderPurchaseCostEvidence.ts", "utf8"),
  readFile(
    "src/app/api/purchase-cycle/source-order-cost-evidence/route.ts",
    "utf8",
  ),
]);

test("October source-order evidence contains exactly the 23 exact-model candidates", () => {
  assert.equal(evidence.length, 23);
  assert.equal(new Set(evidence.map((row) => row.barcode)).size, 23);
  for (const code of [
    "BAC1-1",
    "BAC1-3",
    "BAC2-1",
    "BAC3-2",
    "BAD3-1",
    "BAD5-2",
    "BAF3-1",
    "BAF3-3",
    "BAF4-1",
    "BAG4-1",
    "BBA1-1",
    "BBA7-2",
    "BBB4-1",
    "BBC5-1",
    "BBC5-2",
    "BBC8-2",
    "BBD3-1",
    "BBD4-1",
    "BBD4-2",
    "BCD3-1",
    "BCD5-1",
    "BEA1-1",
    "BGC3-1",
  ]) {
    assert.ok(evidence.some((row) => row.barcode === code), code);
  }
});

test("unresolved legacy identities and the excluded BGB receipt are never promoted", () => {
  assert.deepEqual(unresolved, [
    "BAC3-3",
    "BAE4-1",
    "BBC1-2",
    "BBC4-1",
    "BCC6-2",
  ]);
  const barcodes = new Set(evidence.map((row) => row.barcode));
  for (const code of [...unresolved, "BGB1-1"]) {
    assert.equal(barcodes.has(code), false, code);
  }
});

test("every source row is A-confidence, integer KRW and purchase-only", () => {
  for (const row of evidence) {
    assert.match(row.modelNo, /^AAA\d{3}$/);
    assert.match(row.costDate, /^20\d{2}-\d{2}-\d{2}$/);
    assert.ok(Number.isSafeInteger(row.unitCostKrw) && row.unitCostKrw > 0);
    assert.ok(Number.isSafeInteger(row.sourceRowNumber) && row.sourceRowNumber > 0);
    assert.equal(row.confidence, "A");
    assert.equal(row.evidenceClass, "SOURCE_ORDER_VERIFIED_COST_EVIDENCE");
    assert.equal(row.purchaseUseAllowed, true);
    assert.equal(row.priceUseAllowed, false);
    assert.equal(row.confirmedReceiptUseAllowed, false);
    assert.equal(row.inventoryWriteAllowed, false);
  }
});

test("live Product Master identity is re-proved before an import batch is built", () => {
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /matches\.length !== 1/);
  assert.match(engine, /SOURCE_ORDER_COST_MODEL_IDENTITY_CONFLICT/);
  assert.match(engine, /SOURCE_ORDER_COST_OPTION_IDENTITY_CONFLICT/);
  assert.match(engine, /SOURCE_ORDER_COST_UNRESOLVED_LEGACY_INCLUDED/);
  assert.match(engine, /skuId: text\(product\.skuId\)/);
  assert.match(engine, /optionName,/);
  assert.match(engine, /planningContentFingerprint: snapshot\.contentFingerprint/);
});

test("import is pinned to the preview fingerprint and Product Master purchase-only contract", () => {
  assert.match(engine, /preview\.importFingerprint !== expected/);
  assert.match(engine, /SOURCE_ORDER_COST_PRECONDITION_CHANGED/);
  assert.match(engine, /\/api\/integrations\/purchase-cost-evidence/);
  assert.match(engine, /x-commerce-os-integration-secret/);
  assert.match(engine, /body\.verifiedRowCount !== preview\.rows\.length/);
  assert.match(engine, /body\.priceUseAllowed !== false/);
  assert.match(engine, /body\.confirmedReceiptUseAllowed !== false/);
  assert.match(engine, /body\.inventoryWriteAllowed !== false/);
});

test("operator API accepts no arbitrary evidence rows and never executes an order", () => {
  assert.match(route, /resolveProductLaunchIdentity\(request\)/);
  assert.match(route, /IMPORT_SOURCE_ORDER_PURCHASE_COST_EVIDENCE_23/);
  assert.match(route, /expectedImportFingerprint/);
  assert.match(route, /Object\.keys\(body\)\.some/);
  assert.match(route, /actualPurchaseEnabled: false/);
  assert.match(route, /priceWritesEnabled: false/);
  assert.match(route, /inventoryWritesEnabled: false/);
  assert.match(route, /receiptWritesEnabled: false/);
  assert.doesNotMatch(route, /1688|payment|결제|purchase-order/);
});
