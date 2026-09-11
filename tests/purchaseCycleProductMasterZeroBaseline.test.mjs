import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const baselineAt = "2026-09-10T00:34:21.643Z";
const planning = {
  products: [
    {
      barcode: "BAB3-1",
      modelNo: "AAA231",
      optionName: "단품",
      productName: "차량용 led 재떨이",
      skuActive: true,
      listings: [{ goodsKey: "123456", active: true }],
    },
    {
      barcode: "BBB8-1",
      modelNo: "AAA339",
      optionName: "단품",
      productName: "fixture positive stocktake",
      skuActive: true,
      listings: [{ goodsKey: "654321", active: true }],
    },
  ],
};

const payload = {
  ok: true,
  inventories: [
    {
      barcode: "BAB3-1",
      confirmed: true,
      verified: true,
      requiresReview: false,
      baselineKind: "SOLD_OUT_RESET",
      baselineQuantity: 0,
      baselineAt,
    },
    {
      barcode: "BBB8-1",
      confirmed: true,
      verified: true,
      requiresReview: false,
      baselineKind: "STOCKTAKE",
      baselineQuantity: 10,
      baselineAt,
    },
    {
      barcode: "BZZ1-1",
      confirmed: false,
      verified: false,
      requiresReview: false,
      baselineKind: "SOLD_OUT_RESET",
      baselineQuantity: 0,
      baselineAt,
    },
  ],
};

function baseReport(rows = []) {
  return {
    generatedAt: "2026-09-12T00:00:00.000Z",
    state: "READY",
    message: "fixture",
    fingerprint: "before",
    resetCount: rows.length,
    exactCount: rows.filter((row) => row.salesCoverageReady).length,
    soldOutCount: 0,
    onSaleCount: 0,
    pendingSyncCount: 0,
    uncertainSyncCount: 0,
    rows,
    blockers: [],
  };
}

function moduleWith(fetcher) {
  return load(
    "src/lib/productMasterVerifiedInventoryBaselines.ts",
    {
      "@/lib/productDecisionLiveRefresh": {
        loadProductPlanningSnapshot: async () => planning,
      },
    },
    {
      fetch: fetcher,
      process: {
        env: {
          PRODUCT_MASTER_INTEGRATION_SECRET: "fixture-secret",
          PRODUCT_MASTER_BASE_URL: "https://pm.example",
        },
      },
    },
  );
}

test("only Product Master VERIFIED sold-out zero becomes reusable physical baseline", () => {
  const service = moduleWith(async () => {
    throw new Error("network not expected");
  });
  const rows = service.parseProductMasterVerifiedInventoryBaselines(
    payload,
    planning.products,
  );
  assert.deepEqual([...rows.keys()], ["BAB3-1"]);
  const row = rows.get("BAB3-1");
  assert.equal(row.baselineQuantity, 0);
  assert.equal(row.productKind, "SINGLE");
  assert.equal(row.modelNo, "AAA231");
  assert.equal(row.occurredAt, baselineAt);
});

test("actual overlay performs one authenticated GET, never writes, and seeds zero as unverified-until-sales-tail", async () => {
  const calls = [];
  const service = moduleWith(async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, "https://pm.example/api/integrations/inventory-snapshot");
    assert.equal(options.method, "GET");
    assert.equal(options.headers["x-commerce-os-integration-secret"], "fixture-secret");
    assert.equal(options.cache, "no-store");
    return Response.json(payload);
  });
  const original = baseReport();
  const result = await service.overlayProductMasterVerifiedZeroBaselines(original);
  assert.equal(calls.length, 1);
  assert.equal(original.rows.length, 0);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.barcode, "BAB3-1");
  assert.equal(row.exactInventoryQuantity, 0);
  assert.equal(row.desiredStatus, "SOLD_OUT");
  assert.equal(row.salesCoverageReady, false);
  assert.equal(row.syncBlocked, true);
  assert.equal(row.goodsKeys[0], "123456");
  assert.match(row.resetEventId, /^product-master-sold-out-reset:BAB3-1:/);
});

test("newer local baseline wins and Product Master read failure cannot manufacture completion", async () => {
  const existing = {
    barcode: "BAB3-1",
    productName: "local",
    optionName: "단품",
    modelNo: "AAA231",
    goodsKeys: ["123456"],
    productKind: "SINGLE",
    resetAt: "2026-09-11T00:00:00.000Z",
    resetEventId: "local-newer",
    receivedSinceReset: 0,
    soldSinceReset: 0,
    exactInventoryQuantity: 3,
    recent30StockoutDays: 0,
    desiredStatus: "ON_SALE",
    desiredSince: "2026-09-11T00:00:00.000Z",
    salesCoverageReady: true,
    receiptEvidenceCount: 0,
    salesEvidenceCount: 0,
    latestSyncOutcome: "SUCCEEDED",
    latestSyncAt: "2026-09-11T00:00:01.000Z",
    syncNeeded: false,
    syncBlocked: false,
    syncBlockReason: null,
  };
  const good = moduleWith(async () => Response.json(payload));
  const preserved = await good.overlayProductMasterVerifiedZeroBaselines(
    baseReport([existing]),
  );
  assert.equal(preserved.rows[0].resetEventId, "local-newer");
  assert.equal(preserved.rows[0].exactInventoryQuantity, 3);

  const failed = moduleWith(async () => Response.json({ ok: false }, { status: 503 }));
  const unchanged = baseReport();
  const afterFailure = await failed.overlayProductMasterVerifiedZeroBaselines(unchanged);
  assert.deepEqual(afterFailure, unchanged);
});
