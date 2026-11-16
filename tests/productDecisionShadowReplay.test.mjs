import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductDecisionSourceFromD1,
  replayProductDecisionFromD1,
} from "../src/lib/productDecisionEngine/d1SourceAdapter.ts";
import {
  compareProductDecisionReplay,
  replayAndCompareProductDecisionD1,
} from "../src/lib/productDecisionEngine/shadowComparison.ts";
import {
  VERIFIED_PRODUCT_DECISION_SHADOW,
  validateVerifiedProductDecisionShadow,
} from "../src/lib/productDecisionEngine/verifiedShadow.ts";

const AS_OF = "2026-08-04T09:45:20.591Z";

function baseTables() {
  return {
    app_settings: [
      { key: "purchase_cost_multiplier", value: "1.5" },
      { key: "minimum_product_order_amount", value: "5000" },
    ],
    canonical_products: [
      {
        barcode: "BAA1-1",
        canonical_name: "상승 상품",
        unit_cost: 500,
      },
      {
        barcode: "BAA1-2",
        canonical_name: "저표본 상품",
        unit_cost: 1000,
      },
      {
        barcode: "2028303393559",
        canonical_name: "관리 제외 숫자 바코드",
        unit_cost: 100,
      },
    ],
    decision_runs: [
      {
        id: "run-shadow-test",
        generated_at: AS_OF,
        budget: 100_000,
      },
    ],
    order_lines: [
      ...rollingOrders("BAA1-1", [120, 80, 60, 50, 40, 30], 1000),
      ...rollingOrders("BAA1-2", [4, 3], 2000),
      {
        order_no: "numeric-sale",
        barcode: "2028303393559",
        ordered_at: daysBefore(3),
        status: "발송완료",
        quantity: 1,
        paid_amount: 10_000,
        unit_price: 10_000,
        adjustment_amount: 0,
      },
      {
        order_no: "cancelled-sale",
        barcode: "BAA1-1",
        ordered_at: daysBefore(2),
        status: "취소완료",
        quantity: 999,
        paid_amount: 999_000,
        unit_price: 1000,
        adjustment_amount: 0,
      },
    ],
    claims: [
      {
        barcode: "BAA1-1",
        claimed_at: daysBefore(10),
        quantity: 1,
        severity_weight: 1,
      },
    ],
    product_planning_profiles: [
      { barcode: "BAA1-1", moq: 5, carton_quantity: 4 },
    ],
    inventory_positions: [
      {
        barcode: "BAA1-1",
        available_quantity: 30,
        reserved_quantity: 5,
        incoming_quantity: 20,
        confirmed: 1,
      },
    ],
    purchase_commitments: [
      {
        barcode: "BAA1-1",
        requested_quantity: 30,
        ordered_quantity: 0,
        received_quantity: 0,
        cancelled_quantity: 0,
        status: "RESERVED",
      },
    ],
    decision_items: [],
    decision_evidence: [],
  };
}

function rollingOrders(barcode, quantities, unitPrice) {
  return quantities.flatMap((quantity, index) => {
    if (!quantity) return [];
    return [
      {
        order_no: `${barcode}-${index}`,
        barcode,
        ordered_at: daysBefore(index * 30 + 5),
        status: "발송완료",
        quantity,
        paid_amount: quantity * unitPrice,
        unit_price: unitPrice,
        adjustment_amount: 0,
      },
    ];
  });
}

function daysBefore(days) {
  return new Date(Date.parse(AS_OF) - days * 24 * 60 * 60 * 1000).toISOString();
}

function attachExpectedRun(tables, replay) {
  tables.decision_runs[0].budget = replay.plan.productOrderBudget;
  tables.decision_items = replay.plan.products.map((row) => ({
    run_id: replay.source.runId,
    barcode: row.input.barcode,
    decision_status: row.finalGroup,
    recommended_quantity_gross: row.finalQuantity,
    expected_cost: row.expectedCost,
  }));
  tables.decision_evidence = replay.plan.products.map((row) => ({
    run_id: replay.source.runId,
    barcode: row.input.barcode,
    calculation_json: JSON.stringify({
      rollingUnits: row.input.monthlyUnits,
      rollingRevenue: row.input.monthlyRevenue,
      order: row.sales,
    }),
  }));
  return tables;
}

test("portable D1 adapter builds only managed barcodes and uses all normal sales for the budget", () => {
  const source = buildProductDecisionSourceFromD1(baseTables());
  assert.equal(source.products.length, 2);
  assert.deepEqual(
    source.products.map((row) => row.barcode),
    ["BAA1-1", "BAA1-2"],
  );
  assert.equal(source.purchaseCostMultiplier, 1.5);
  assert.equal(source.paymentFeeMultiplier, 1.05);
  assert.equal(source.minimumOrderAmount, 5000);
  assert.equal(source.recent30DayRevenue, 138_000);

  const first = source.products[0];
  assert.equal(first.inventoryKnown, true);
  assert.equal(first.availableQuantity, 30);
  assert.equal(first.reservedQuantity, 5);
  assert.equal(first.incomingQuantity, 20);
  assert.equal(first.ledgerCommitment, 30);
  assert.equal(first.moq, 5);
  assert.equal(first.cartonQuantity, 4);
});

test("shadow comparison is exact when raw source and stored run share one cutoff", () => {
  const tables = baseTables();
  const replay = replayProductDecisionFromD1(tables);
  attachExpectedRun(tables, replay);
  const report = compareProductDecisionReplay(tables, replay);

  assert.equal(report.productCount, 2);
  assert.equal(report.exactFinalCount, 2);
  assert.equal(report.finalMismatchCount, 0);
  assert.equal(report.sourceInputDriftCount, 0);
  assert.equal(report.salesCalculationMismatchCount, 0);
  assert.equal(report.unexplainedMismatchCount, 0);
});

test("shadow comparison separates later source changes from unexplained engine differences", () => {
  const tables = baseTables();
  const expectedReplay = replayProductDecisionFromD1(tables);
  attachExpectedRun(tables, expectedReplay);

  tables.order_lines.push({
    order_no: "late-synced-old-order",
    barcode: "BAA1-1",
    ordered_at: daysBefore(1),
    status: "발송완료",
    quantity: 20,
    paid_amount: 20_000,
    unit_price: 1000,
    adjustment_amount: 0,
  });
  const result = replayAndCompareProductDecisionD1(tables);

  assert.equal(result.report.sourceInputDriftCount, 1);
  assert.ok(result.report.salesCalculationMismatchCount >= 1);
  assert.equal(result.report.unexplainedMismatchCount, 0);
  assert.ok(
    result.report.products.some(
      (row) => row.mismatchReason === "SOURCE_INPUT_DRIFT" || row.finalMatch,
    ),
  );
});

test("known production replay summary is locked without committing raw production rows", () => {
  const products = Array.from(
    { length: VERIFIED_PRODUCT_DECISION_SHADOW.productCount },
    (_, index) => ({
      barcode: `BTEST-${index}`,
      sourceInputDrift: false,
      salesCalculationMatch: true,
      expectedGroup: "발주 보류",
      replayGroup: "발주 보류",
      expectedQuantity: 0,
      replayQuantity: 0,
      expectedCost: 0,
      replayCost: 0,
      finalMatch: true,
      mismatchReason: null,
    }),
  );
  assert.doesNotThrow(() =>
    validateVerifiedProductDecisionShadow({
      ...VERIFIED_PRODUCT_DECISION_SHADOW,
      products,
    }),
  );
  assert.throws(
    () =>
      validateVerifiedProductDecisionShadow({
        ...VERIFIED_PRODUCT_DECISION_SHADOW,
        exactFinalCount: 310,
        products,
      }),
    /그림자 재계산 결과와 다릅니다/,
  );
});

test("migration page stores only the verified summary and never sends raw D1 tables to the server", async () => {
  const importer = await readFile(
    "src/app/product-decision-agent/migration/ProductDecisionSnapshotImporter.tsx",
    "utf8",
  );
  const route = await readFile(
    "src/app/api/product-decision-agent/migration/import/route.ts",
    "utf8",
  );
  assert.match(importer, /replayAndCompareProductDecisionD1/);
  assert.match(importer, /validateVerifiedProductDecisionShadow/);
  assert.match(importer, /shadowReport: shadow\.report/);
  assert.doesNotMatch(importer, /body: JSON\.stringify\(\{[\s\S]*parsedTables/);
  assert.match(route, /PRODUCT_DECISION_SHADOW_REPLAY/);
  assert.match(route, /product-decision-shadow:/);
  assert.match(route, /resolution=ignore-duplicates/);
  assert.doesNotMatch(route, /order_lines|claims|canonical_products/);
});
