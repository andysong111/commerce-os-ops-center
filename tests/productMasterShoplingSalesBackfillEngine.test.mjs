import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".sales-backfill-"),
  );
  let source = await readFile(
    new URL("../src/lib/productMasterShoplingSalesBackfillEngine.ts", import.meta.url),
    "utf8",
  );
  source = source
    .replace(
      'from "@/lib/shopling/shoplingNormalize"',
      `from ${JSON.stringify(new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url).href)}`,
    )
    .replace(
      /import type \{ ShoplingDateRange \} from "@\/lib\/shopling\/shoplingReadClient";\n/,
      "",
    )
    .replace(
      /import type \{ ProductPlanningSnapshot \} from "@\/lib\/shopling\/shoplingLiveAggregation";\n/,
      "",
    );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(directory, "engine.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const {
  aggregateProductMasterShoplingSalesChunk,
  combineProductMasterShoplingSalesChunks,
} = await loadEngine();

function planning(overrides = {}) {
  return {
    generatedAt: "2026-08-07T00:00:00.000Z",
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      },
    ],
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    ord_no: "ORD-1",
    mall_ord_seq: "1",
    mall_ord_dt: "20260806120000",
    ord_status: "배송완료",
    opt_id: "O1",
    prod_id: "1001",
    mall_ord_cnt: "3",
    mall_unit_price: "1000",
    ...overrides,
  };
}

const range = { start: "2026-08-01", end: "2026-08-07" };

test("monthly backfill converts order quantity through unitsPerOrder", () => {
  const result = aggregateProductMasterShoplingSalesChunk([order()], planning(), range);
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].quantity, 6);
  assert.equal(result.monthlyRows[0].revenue, 3000);
  assert.equal(result.monthlyRows[0].id, "shopling-sales-v1:BAA1-1:2026-08");
});

test("cancelled and refunded orders never enter canonical sales", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ ord_status: "취소완료" }), order({ ord_no: "ORD-2", ord_status: "refund" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.ignoredRows, 2);
  assert.equal(result.monthlyRows.length, 0);
});

test("historical consignment orders outside managed barcode catalog are ignored instead of blocking", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD-CONSIGNMENT", prod_id: "900000", mall_prod_key: "900000" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 1);
  assert.equal(result.monthlyRows.length, 0);
});

test("explicit AAA legacy codes are excluded even when the goods key is now a managed B-code product", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "1001", ptn_goods_cd: "AAA385-2" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 1);
});

test("a unique current managed goods key can recover a no-code historical order", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "1001", mall_prod_key: "OLD-MALL" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BAA1-1");
});

test("ambiguous goods-key-only historical orders are ignored without stronger B-code evidence", () => {
  const ambiguous = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
          { goodsKey: "1001", optionId: "O2", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "1001" })],
    ambiguous,
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 1);
});

test("an ambiguous exact current option stays fail-closed", () => {
  const ambiguous = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품A",
        optionName: "옵션A",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "SAME", unitsPerOrder: 1, active: true },
        ],
      },
      {
        skuId: "sku-2",
        barcode: "BAA1-2",
        productName: "상품B",
        optionName: "옵션B",
        skuActive: true,
        listings: [
          { goodsKey: "1002", optionId: "SAME", unitsPerOrder: 1, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "SAME", prod_id: "UNKNOWN", mall_prod_key: "UNKNOWN" })],
    ambiguous,
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
  assert.equal(result.ignoredRows, 0);
});

test("non-B Product Master codes are never canonical managed inventory", () => {
  const legacyPlanning = planning({
    products: [
      {
        skuId: "legacy",
        barcode: "AAA385-2",
        productName: "과거상품",
        optionName: "과거옵션",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk([order()], legacyPlanning, range);
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 1);
});

test("managed partner code can recover an order when historical option identity is absent", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "OLD", ptn_goods_cd: "BAA1-1" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("ambiguous barcode pack ratios are never guessed from the barcode alone", () => {
  const ambiguous = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
          { goodsKey: "1002", optionId: "O2", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "OLD", ptn_goods_cd: "BAA1-1" })],
    ambiguous,
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
});

test("inactive exact B-code sales use their own deterministic pack ratio", () => {
  const historical = planning({
    products: [
      {
        skuId: "inactive-white",
        barcode: "BBA4-1",
        productName: "과거 관리상품",
        optionName: "화이트",
        skuActive: false,
        listings: [
          { goodsKey: "120097", optionId: "OLD-WHITE", unitsPerOrder: 2, active: false },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "120097", ptn_goods_cd: "BBA4-1", mall_ord_cnt: "3" })],
    historical,
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BBA4-1");
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("inactive exact B-code can use one agreed current goods pack ratio", () => {
  const historical = planning({
    products: [
      {
        skuId: "inactive-white",
        barcode: "BBA4-1",
        productName: "목도리",
        optionName: "화이트",
        skuActive: false,
        listings: [],
      },
      {
        skuId: "gray",
        barcode: "BBA4-3",
        productName: "목도리",
        optionName: "그레이",
        skuActive: true,
        listings: [
          { goodsKey: "120097", optionId: "28162745", unitsPerOrder: 1, active: true },
        ],
      },
      {
        skuId: "pink",
        barcode: "BBA5-3",
        productName: "목도리",
        optionName: "핑크",
        skuActive: true,
        listings: [
          { goodsKey: "120097", optionId: "28162746", unitsPerOrder: 1, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [
      order({
        opt_id: "28162748",
        prod_id: "120097",
        mall_prod_key: "12270335574",
        ptn_goods_cd: "BBA4-1",
        mall_ord_cnt: "1",
      }),
    ],
    historical,
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BBA4-1");
  assert.equal(result.monthlyRows[0].quantity, 1);
});

test("inactive exact B-code stays blocked when compatible pack evidence disagrees", () => {
  const historical = planning({
    products: [
      {
        skuId: "inactive-white",
        barcode: "BBA4-1",
        productName: "목도리",
        optionName: "화이트",
        skuActive: false,
        listings: [],
      },
      {
        skuId: "gray",
        barcode: "BBA4-3",
        productName: "목도리",
        optionName: "그레이",
        skuActive: true,
        listings: [
          { goodsKey: "120097", optionId: "G", unitsPerOrder: 1, active: true },
        ],
      },
      {
        skuId: "pink",
        barcode: "BBA5-3",
        productName: "목도리",
        optionName: "핑크",
        skuActive: true,
        listings: [
          { goodsKey: "120097", optionId: "P", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "120097", ptn_goods_cd: "BBA4-1" })],
    historical,
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
});

test("product-level partner B-code never overrides an exact current option identity", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "O1", prod_id: "1001", ptn_goods_cd: "BBA4-1" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BAA1-1");
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("actual option barcode remains authoritative over a later current option mapping", () => {
  const historical = planning({
    products: [
      {
        skuId: "current",
        barcode: "BAA1-1",
        productName: "현재상품",
        optionName: "현재옵션",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      },
      {
        skuId: "historical",
        barcode: "BBA4-1",
        productName: "과거상품",
        optionName: "과거옵션",
        skuActive: false,
        listings: [
          { goodsKey: "OLD", optionId: "OLD", unitsPerOrder: 1, active: false },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [
      order({
        opt_id: "O1",
        prod_id: "1001",
        opt_barcode: "BBA4-1",
        ptn_goods_cd: "BAA1-1",
        mall_ord_cnt: "3",
      }),
    ],
    historical,
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BBA4-1");
  assert.equal(result.monthlyRows[0].quantity, 3);
});

test("one trailing warehouse-location letter is removed before canonical sales aggregation", () => {
  const catalog = planning({
    products: [
      {
        skuId: "current-other",
        barcode: "BAA1-1",
        productName: "현재 다른 상품",
        optionName: "현재 옵션",
        skuActive: true,
        listings: [
          { goodsKey: "CURRENT", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      },
      {
        skuId: "waist-stretcher",
        barcode: "BAF1-1",
        productName: "허리스트레칭기구",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "115082", optionId: "CURRENT-BAF1", unitsPerOrder: 1, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [
      order({
        ord_no: "WAIST-100",
        opt_id: "O1",
        prod_id: "OLD-115082",
        mall_prod_key: "OLD-MALL-115082",
        mall_ptn_opt_cd: "BAF1-1e",
        mall_ord_cnt: "100",
      }),
    ],
    catalog,
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BAF1-1");
  assert.equal(result.monthlyRows[0].quantity, 100);
});

test("duplicate Product Master ownership of one B-code stays fail-closed", () => {
  const duplicate = planning({
    products: [
      {
        skuId: "one",
        barcode: "BBA4-1",
        productName: "A",
        optionName: "A",
        skuActive: false,
        listings: [{ goodsKey: "120097", optionId: "OLD", unitsPerOrder: 1, active: false }],
      },
      {
        skuId: "two",
        barcode: "BBA4-1",
        productName: "B",
        optionName: "B",
        skuActive: true,
        listings: [{ goodsKey: "120098", optionId: "NEW", unitsPerOrder: 1, active: true }],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "UNKNOWN", prod_id: "120097", ptn_goods_cd: "BBA4-1" })],
    duplicate,
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
});

test("chunk combination merges split ranges into one deterministic month row", () => {
  const first = aggregateProductMasterShoplingSalesChunk(
    [order({ mall_ord_dt: "20260802120000" })],
    planning(),
    { start: "2026-08-01", end: "2026-08-03" },
  );
  const second = aggregateProductMasterShoplingSalesChunk(
    [order({ ord_no: "ORD-2", mall_ord_dt: "20260805120000", mall_ord_cnt: "1" })],
    planning(),
    { start: "2026-08-04", end: "2026-08-07" },
  );
  const result = combineProductMasterShoplingSalesChunks([first, second]);
  assert.equal(result.monthlyRowCount, 1);
  assert.equal(result.rows[0].quantity, 8);
  assert.equal(result.rows[0].revenue, 4000);
});
