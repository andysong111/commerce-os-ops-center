import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadAggregation() {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const directory = await mkdtemp(join(testDirectory, ".shopling-aggregation-"));
  const sourcePath = new URL(
    "../src/lib/shopling/shoplingLiveAggregation.ts",
    import.meta.url,
  );
  let source = await readFile(sourcePath, "utf8");
  source = source
    .replace(
      'from "@/lib/productDecisionEngine"',
      `from ${JSON.stringify(
        new URL("../src/lib/productDecisionEngine/index.ts", import.meta.url).href,
      )}`,
    )
    .replace(
      'from "@/lib/productDecisionEngine/purchaseStrategyPolicy"',
      `from ${JSON.stringify(
        new URL(
          "../src/lib/productDecisionEngine/purchaseStrategyPolicy.ts",
          import.meta.url,
        ).href,
      )}`,
    )
    .replace(
      'from "@/lib/productDecisionEngine/planningMonthlySales"',
      `from ${JSON.stringify(
        new URL(
          "../src/lib/productDecisionEngine/planningMonthlySales.ts",
          import.meta.url,
        ).href,
      )}`,
    )
    .replace(
      'from "@/lib/productDecisionSnapshot"',
      `from ${JSON.stringify(
        new URL("../src/lib/productDecisionSnapshot.ts", import.meta.url).href,
      )}`,
    )
    .replace(
      'from "@/lib/shopling/shoplingNormalize"',
      `from ${JSON.stringify(
        new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url).href,
      )}`,
    )
    .replace(
      'from "@/lib/shopling/shoplingReadClient"',
      `from ${JSON.stringify(
        new URL("../src/lib/shopling/shoplingReadClient.ts", import.meta.url).href,
      )}`,
    );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "shoplingLiveAggregation.ts",
  }).outputText;
  const file = join(directory, "shoplingLiveAggregation.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const aggregation = await loadAggregation();
const {
  aggregateShoplingOrderChunk,
  aggregateShoplingClaimChunk,
  buildProductPlanningIndex,
  buildLiveProductDecisionSnapshot,
  combineShoplingLiveChunks,
  planningCompletedCalendarMonthlySales,
} = aggregation;

const AS_OF = "2026-08-05T15:00:00.000Z";

function completedStrategyMonthly() {
  return [
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
  ].map((month) => ({ month, quantity: 10, revenue: 50_000 }));
}

function planning() {
  return {
    generatedAt: "2026-08-05T14:50:00.000Z",
    products: [
      {
        skuId: "sku-a",
        modelNo: "A",
        barcode: "BAA1-1",
        productName: "세트 상품",
        skuActive: true,
        moq: 1,
        cartonQuantity: 1,
        latestCostKrw: 500,
        inventoryQuantity: 10,
        inventoryConfirmed: true,
        firstSalesMonth: "2024-01",
        purchaseStrategyMonthly: completedStrategyMonthly(),
        listings: [
          {
            optionId: "O1",
            goodsKey: "1001",
            unitsPerOrder: 2,
            active: true,
          },
        ],
      },
      {
        skuId: "sku-b",
        modelNo: "B",
        barcode: "BAA1-2",
        productName: "단품 상품",
        skuActive: true,
        moq: 5,
        cartonQuantity: 4,
        latestCostKrw: 300,
        inventoryQuantity: 0,
        inventoryConfirmed: false,
        firstSalesMonth: "2026-04",
        purchaseStrategyMonthly: completedStrategyMonthly(),
        listings: [
          {
            optionId: "O2",
            goodsKey: "1002",
            unitsPerOrder: 1,
            active: true,
          },
        ],
      },
    ],
  };
}

test("purchase strategy history requires the exact 12 completed Korean calendar months", () => {
  assert.equal(
    planningCompletedCalendarMonthlySales(completedStrategyMonthly(), AS_OF)
      .length,
    12,
  );
  assert.throws(
    () => planningCompletedCalendarMonthlySales(undefined, AS_OF),
    /PURCHASE_STRATEGY_MONTHLY_HISTORY_INCOMPLETE/,
  );
  assert.throws(
    () =>
      planningCompletedCalendarMonthlySales(
        [
          ...completedStrategyMonthly().slice(1),
          { month: "2026-08", quantity: 999, revenue: 9_999_000 },
        ],
        AS_OF,
      ),
    /PURCHASE_STRATEGY_MONTHLY_HISTORY_INCOMPLETE/,
  );
});

test("canonical salesMonthly overrides stale strategy rows and excludes the current month", () => {
  const staleStrategy = completedStrategyMonthly().map((row) => ({
    ...row,
    quantity: 0,
    revenue: 0,
  }));
  const canonicalSales = [
    ...staleStrategy.map((row) =>
      row.month === "2026-07"
        ? { ...row, quantity: 19, revenue: 124_840 }
        : row,
    ),
    { month: "2026-08", quantity: 999, revenue: 9_999_000 },
  ];

  const result = planningCompletedCalendarMonthlySales(
    staleStrategy,
    AS_OF,
    canonicalSales,
  );

  assert.equal(result.length, 12);
  assert.equal(result.find((row) => row.month === "2026-07")?.revenue, 124_840);
  assert.equal(result.some((row) => row.month === "2026-08"), false);
});

test("live purchase snapshot uses canonical completed-month sales instead of stale strategy rows", () => {
  const plan = planning();
  const product = plan.products[0];
  product.purchaseStrategyMonthly = completedStrategyMonthly().map((row) => ({
    ...row,
    quantity: 0,
    revenue: 0,
  }));
  product.salesMonthly = [
    ...completedStrategyMonthly().map((row) =>
      row.month === "2026-07"
        ? { ...row, quantity: 19, revenue: 124_840 }
        : { ...row, quantity: 0, revenue: 0 },
    ),
    { month: "2026-08", quantity: 999, revenue: 9_999_000 },
  ];
  const zeros = Array.from({ length: 12 }, () => 0);
  const snapshot = buildLiveProductDecisionSnapshot(
    "canonical-monthly-regression",
    {
      analysisAsOf: AS_OF,
      recent30Revenue: 20_000,
      products: [{
        planning: product,
        units: [10, 10, 10, ...zeros.slice(3)],
        revenue: [20_000, 20_000, 20_000, ...zeros.slice(3)],
        shippedOrders: zeros,
        weightedClaims: zeros,
        claimQuantity: zeros,
      }],
    },
    new Map(),
  );

  const row = snapshot.products.find((candidate) => candidate.barcode === "BAA1-1");
  assert.ok(row);
  assert.ok(row.entrySignals?.includes("HISTORICAL_REVENUE_THRESHOLD"));
  assert.equal(row.purchaseStrategy?.history.latestQualifiedMonth, "2026-07");
  assert.ok(Number(row.rawRecommendedQty) > 0);
});

test("order aggregation maps option IDs, expands set quantities and counts one shipped order per barcode", () => {
  const chunk = aggregateShoplingOrderChunk(
    [
      {
        ord_no: "A1",
        mall_ord_seq: "1",
        opt_id: "O1",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "3",
        mall_unit_price: "700",
      },
      {
        ord_no: "A1",
        mall_ord_seq: "2",
        opt_id: "O1",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "1",
        mall_unit_price: "700",
      },
      {
        ord_no: "A2",
        mall_ord_seq: "1",
        opt_id: "UNKNOWN",
        mall_ord_dt: "20260805110000",
        ord_status: "배송완료",
        mall_ord_cnt: "1",
        mall_unit_price: "1000",
      },
      {
        ord_no: "A3",
        mall_ord_seq: "1",
        opt_id: "O2",
        mall_ord_dt: "20260805120000",
        ord_status: "취소완료",
        mall_ord_cnt: "999",
        mall_unit_price: "1000",
      },
    ],
    planning(),
    AS_OF,
    { start: "2026-08-05", end: "2026-08-05" },
  );

  assert.equal(chunk.fetchedRows, 4);
  assert.equal(chunk.acceptedRows, 2);
  assert.equal(chunk.unmappedRows, 1);
  assert.equal(chunk.recent30Revenue, 3800);
  assert.equal(chunk.products.length, 1);
  assert.equal(chunk.products[0].units[0], 8);
  assert.equal(chunk.products[0].revenue[0], 2800);
  assert.equal(chunk.products[0].shippedOrders[0], 1);
  assert.equal(chunk.references.length, 1);
});

test("sold-out listings keep historical demand mapping and zero-revenue rows still count units", () => {
  const soldOutPlanning = planning();
  soldOutPlanning.products[0].listings[0].active = false;

  const chunk = aggregateShoplingOrderChunk(
    [
      {
        ord_no: "SOLD-OUT-ORDER",
        mall_ord_seq: "1",
        opt_id: "O1",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "100",
        mall_unit_price: "0",
        mall_pay_amt: "0",
      },
    ],
    soldOutPlanning,
    AS_OF,
    { start: "2026-08-05", end: "2026-08-05" },
  );

  assert.equal(chunk.acceptedRows, 1);
  assert.equal(chunk.unmappedRows, 0);
  assert.equal(chunk.products[0].barcode, "BAA1-1");
  assert.equal(chunk.products[0].units[0], 200);
  assert.equal(chunk.products[0].revenue[0], 0);
});

test("claim aggregation restores barcode from order references and applies set quantity severity", () => {
  const orderChunk = aggregateShoplingOrderChunk(
    [
      {
        ord_no: "A1",
        mall_ord_seq: "1",
        opt_id: "O1",
        prod_id: "1001",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "3",
        mall_unit_price: "700",
      },
    ],
    planning(),
    AS_OF,
    { start: "2026-08-05", end: "2026-08-05" },
  );
  const claimChunk = aggregateShoplingClaimChunk(
    [
      {
        claim_key: "C1",
        ord_no: "A1",
        prod_id: "1001",
        mall_claim_rsn: "상품 파손",
        claim_qty: "2",
        i_dt: "20260805130000",
      },
    ],
    planning(),
    orderChunk.references,
    AS_OF,
    { start: "2026-08-05", end: "2026-08-05" },
  );

  assert.equal(claimChunk.acceptedRows, 1);
  assert.equal(claimChunk.products[0].barcode, "BAA1-1");
  assert.equal(claimChunk.products[0].claimQuantity[0], 4);
  assert.equal(claimChunk.products[0].weightedClaims[0], 4);
});

test("ambiguous option mappings fail closed instead of choosing an arbitrary barcode", () => {
  const ambiguous = planning();
  ambiguous.products[1].listings = [
    { optionId: "O1", goodsKey: "1002", unitsPerOrder: 1, active: true },
  ];
  const index = buildProductPlanningIndex(ambiguous);
  assert.equal(index.byOptionId.has("O1"), false);

  const chunk = aggregateShoplingOrderChunk(
    [
      {
        ord_no: "A1",
        mall_ord_seq: "1",
        opt_id: "O1",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "1",
        mall_unit_price: "700",
      },
    ],
    ambiguous,
    AS_OF,
    { start: "2026-08-05", end: "2026-08-05" },
  );
  assert.equal(chunk.acceptedRows, 0);
  assert.equal(chunk.unmappedRows, 1);
});

test("combined live chunks build a full Ops Center product decision snapshot", () => {
  const orderChunk = aggregateShoplingOrderChunk(
    [
      ...Array.from({ length: 12 }, (_, index) => ({
        ord_no: `A-${index}`,
        mall_ord_seq: "1",
        opt_id: "O1",
        mall_ord_dt: new Date(
          Date.parse(AS_OF) - (index * 30 + 5) * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .replace(/\D/g, "")
          .slice(0, 14),
        ord_status: "배송완료",
        mall_ord_cnt: String(Math.max(5, 80 - index * 4)),
        mall_unit_price: "700",
      })),
      {
        ord_no: "B-1",
        mall_ord_seq: "1",
        opt_id: "O2",
        mall_ord_dt: "20260805100000",
        ord_status: "배송완료",
        mall_ord_cnt: "10",
        mall_unit_price: "1000",
      },
    ],
    planning(),
    AS_OF,
    { start: "2025-08-10", end: "2026-08-05" },
  );
  const aggregate = combineShoplingLiveChunks(
    planning(),
    [orderChunk],
    [],
    AS_OF,
  );
  const result = buildLiveProductDecisionSnapshot(
    "live-run-1",
    aggregate,
    new Map([["BAA1-1", 20]]),
  );

  assert.equal(result.mode, "LIVE");
  assert.equal(result.runId, "live-run-1");
  assert.equal(result.products.length, 2);
  const first = result.products.find((row) => row.barcode === "BAA1-1");
  assert.ok(first);
  assert.equal(first.inventoryKnown, true);
  assert.equal(first.estimatedStock, 10);
  assert.equal(first.openCommitment, 20);
  assert.ok(Number(first.rawRecommendedQty) > 0);
  assert.ok(Number(result.budget) > 0);
  assert.match(result.notice, /실제 주문은 별도 승인 전까지 실행하지 않습니다/);
});
