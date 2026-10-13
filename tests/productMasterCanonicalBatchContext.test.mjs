import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dependentSkuContext } from "../src/lib/productMasterCanonicalBatchContext.ts";

const source = await readFile("src/lib/productMasterCanonicalSync.ts", "utf8");

test("dependent Product Master batches carry the exact distinct referenced SKU context", () => {
  const skuA = { id: "sku-source:a", barcode: "BAA1-1" };
  const skuB = { id: "sku-source:b", barcode: "BAA1-2" };
  const context = dependentSkuContext(
    "listingMappings",
    [
      { id: "listing-1", skuId: skuA.id },
      { id: "listing-2", skuId: skuA.id },
      { id: "listing-3", skuId: skuB.id },
    ],
    new Map([
      [skuA.id, skuA],
      [skuB.id, skuB],
    ]),
  );

  assert.deepEqual(context, [skuA, skuB]);
  assert.ok(source.includes('key === "listingMappings" || key === "receiptCosts"'));
  assert.ok(source.includes("requestPayload.skus = dependentSkuContext(key, batch, skuById)"));
  assert.ok(source.includes("body: JSON.stringify(requestPayload)"));
});

test("missing dependent SKU context fails closed before an orphan foreign-key write", () => {
  assert.throws(
    () => dependentSkuContext(
      "receiptCosts",
      [{ id: "receipt-1", skuId: "sku-source:missing" }],
      new Map(),
    ),
    /PRODUCT_MASTER_DEPENDENT_SKU_CONTEXT_MISSING:receiptCosts:sku-source:missing/,
  );
  assert.throws(
    () => dependentSkuContext(
      "listingMappings",
      [{ id: "listing-blank" }],
      new Map(),
    ),
    /PRODUCT_MASTER_DEPENDENT_SKU_CONTEXT_MISSING:listingMappings:EMPTY/,
  );
});

test("canonical SKU context fix protects both listing and finalized receipt-cost batches", () => {
  assert.ok(source.includes('["listingMappings", payload.listingMappings]'));
  assert.ok(source.includes('["receiptCosts", payload.receiptCosts]'));
  assert.ok(source.includes("const skuById = new Map("));
  assert.equal(source.includes("body: JSON.stringify({ [key]: batch })"), false);
});
