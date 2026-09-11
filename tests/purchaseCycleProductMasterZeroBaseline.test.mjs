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

function operationAdmin(rowsForType) {
  return {
    from(table) {
      assert.equal(table, "commerce_operation_runs");
      const filters = {};
      const chain = {
        select() {
          return chain;
        },
        eq(field, value) {
          filters[field] = value;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return Promise.resolve({
            data: rowsForType(filters.operation_type) ?? [],
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

test("only strict numeric Product Master VERIFIED sold-out zero becomes reusable physical baseline", () => {
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

  for (const invalidZero of [null, "", false, "0"]) {
    const invalid = structuredClone(payload);
    invalid.inventories = [{ ...invalid.inventories[0], baselineQuantity: invalidZero }];
    assert.equal(
      service.parseProductMasterVerifiedInventoryBaselines(
        invalid,
        planning.products,
      ).size,
      0,
    );
  }
});

test("required parser rejects every incomplete authoritative zero reset instead of converting it to baseline absence", () => {
  const service = moduleWith(async () => {
    throw new Error("network not expected");
  });
  for (const patch of [
    { baselineQuantity: null },
    { baselineQuantity: "0" },
    { baselineAt: null },
    { baselineAt: "not-a-date" },
    { barcode: "" },
    { barcode: "BZZ999-1" },
  ]) {
    const invalid = structuredClone(payload);
    invalid.inventories = [{ ...invalid.inventories[0], ...patch }];
    assert.throws(
      () => service.parseProductMasterVerifiedInventoryBaselines(
        invalid,
        planning.products,
        { requireCompleteVerifiedResets: true },
      ),
      /PRODUCT_MASTER_VERIFIED_ZERO_RESET_INCOMPLETE/,
    );
  }
});

test("required zero-reset loader performs one authenticated GET and returns reset events only", async () => {
  const calls = [];
  const service = moduleWith(async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, "https://pm.example/api/integrations/inventory-snapshot");
    assert.equal(options.method, "GET");
    assert.equal(options.headers["x-commerce-os-integration-secret"], "fixture-secret");
    assert.equal(options.cache, "no-store");
    return Response.json(payload);
  });
  const resets = await service.loadRequiredProductMasterVerifiedZeroResetEvents();
  assert.equal(calls.length, 1);
  assert.equal(resets.length, 1);
  assert.equal(resets[0].eventId, `product-master-sold-out-reset:BAB3-1:${baselineAt}`);
  assert.equal(resets[0].barcode, "BAB3-1");
  assert.equal(resets[0].productKind, "SINGLE");
  assert.equal(resets[0].modelNo, "AAA231");
  assert.equal(resets[0].occurredAt, baselineAt);
  assert.equal(resets[0].note, "Product Master VERIFIED SOLD_OUT_RESET 기준점");
});

test("Product Master outage is fail-closed for purchase-cycle reads but fail-soft for the operational queue", async () => {
  const service = moduleWith(async () =>
    Response.json({ ok: false }, { status: 503 }),
  );
  await assert.rejects(
    service.loadRequiredProductMasterVerifiedZeroResetEvents(),
    /PRODUCT_MASTER_INVENTORY_BASELINE_HTTP_503/,
  );
  const resets = await service.loadProductMasterVerifiedZeroResetEvents();
  assert.equal(resets.length, 0);
});

test("supplemental Product Master zero is recomputed by canonical inventory ledger and equal local reset wins", async () => {
  let localResetRows = [];
  const service = load("src/lib/inventoryStockControl.ts", {
    "@/lib/chinaOrderLedger": {
      CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_EVENT",
    },
    "@/lib/productDecisionLiveRefresh": {
      loadProductPlanningSnapshot: async () => planning,
    },
    "@/lib/stage8CanonicalSalesEventSnapshot": {
      loadStage8CanonicalSalesEventSnapshot: async () => ({
        state: "READY_READ_ONLY",
        coverageStartAt: "2026-09-01T00:00:00.000Z",
        coverageEndAt: "2026-09-12T00:00:00.000Z",
        events: [],
      }),
    },
    "@/lib/supabase/admin": {
      createSupabaseAdminClient: async () =>
        operationAdmin((operationType) =>
          operationType === "INVENTORY_STOCKOUT_RESET_EVENT"
            ? localResetRows
            : [],
        ),
    },
  });
  const supplementalReset = {
    eventId: `product-master-sold-out-reset:BAB3-1:${baselineAt}`,
    barcode: "BAB3-1",
    productKind: "SINGLE",
    modelNo: "AAA231",
    occurredAt: baselineAt,
    note: "Product Master VERIFIED SOLD_OUT_RESET 기준점",
  };

  const fromProductMaster = await service.loadInventoryStockControlReport({
    supplementalResetEvents: [supplementalReset],
  });
  assert.equal(fromProductMaster.state, "READY");
  assert.equal(fromProductMaster.rows.length, 1);
  assert.equal(fromProductMaster.rows[0].resetEventId, supplementalReset.eventId);
  assert.equal(fromProductMaster.rows[0].salesCoverageReady, true);
  assert.equal(fromProductMaster.rows[0].exactInventoryQuantity, 0);
  assert.equal(fromProductMaster.rows[0].syncBlocked, false);

  localResetRows = [
    {
      source_event_id: "local-equal-reset",
      input_snapshot: {
        eventId: "local-equal-reset",
        barcode: "BAB3-1",
        productKind: "SINGLE",
        modelNo: "AAA231",
        occurredAt: baselineAt,
        note: "local OPS reset wins tie",
      },
      started_at: baselineAt,
      status: "SUCCEEDED",
    },
  ];
  const localWins = await service.loadInventoryStockControlReport({
    supplementalResetEvents: [supplementalReset],
  });
  assert.equal(localWins.rows[0].resetEventId, "local-equal-reset");
  assert.equal(localWins.rows[0].salesCoverageReady, true);
});
