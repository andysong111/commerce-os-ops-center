import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".historical-shadow-"),
  );
  let source = await readFile(
    new URL(
      "../src/lib/productMasterShoplingSalesHistoricalShadowEngine.ts",
      import.meta.url,
    ),
    "utf8",
  );
  source = source.replace(
    'from "@/lib/shopling/shoplingNormalize"',
    `from ${JSON.stringify(
      new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url).href,
    )}`,
  );
  source = source.replace(
    'from "@/lib/shopling/shoplingDirectPackEvidence"',
    `from ${JSON.stringify(
      new URL("../src/lib/shopling/shoplingDirectPackEvidence.ts", import.meta.url).href,
    )}`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
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
  buildHistoricalOptionFallbackIndex,
  aggregateProductMasterShoplingSalesHistoricalShadowChunk,
} = await loadEngine();

function planning(overrides = {}) {
  return {
    generatedAt: "2026-08-07T00:00:00.000Z",
    contentFingerprint: "sha256:test",
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재 상품",
        optionName: "현재 옵션",
        skuActive: true,
        listings: [
          {
            goodsKey: "1001",
            optionId: "NEW-1",
            unitsPerOrder: 2,
            active: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function planningWithAmbiguousGoodsKey() {
  return planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재 상품 A",
        optionName: "현재 옵션 A",
        skuActive: true,
        listings: [
          {
            goodsKey: "1001",
            optionId: "NEW-1",
            unitsPerOrder: 2,
            active: true,
          },
        ],
      },
      {
        skuId: "sku-2",
        barcode: "BCC1-1",
        productName: "현재 상품 B",
        optionName: "현재 옵션 B",
        skuActive: true,
        listings: [
          {
            goodsKey: "1001",
            optionId: "NEW-2",
            unitsPerOrder: 1,
            active: true,
          },
        ],
      },
    ],
  });
}

function catalog(overrides = {}) {
  return {
    goodsKey: "1001",
    optionId: "OLD-1",
    barcode: "BAA1-1",
    productName: "과거 상품",
    optionName: "과거 옵션",
    isActive: false,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    ord_no: "ORD-1",
    mall_ord_seq: "1",
    mall_ord_dt: "20260806120000",
    ord_status: "배송완료",
    opt_id: "OLD-1",
    prod_id: "1001",
    mall_ord_cnt: "3",
    mall_unit_price: "1000",
    ...overrides,
  };
}

const range = { start: "2026-08-01", end: "2026-08-07" };

test("exact historical option becomes safe only with one current barcode and one current pack ratio", () => {
  const index = buildHistoricalOptionFallbackIndex(planning(), [catalog()]);
  assert.equal(index.stats.safeOptionCount, 1);
  assert.equal(index.byOptionId.get("OLD-1")?.barcode, "BAA1-1");
  assert.equal(index.byOptionId.get("OLD-1")?.unitsPerOrder, 2);
  assert.deepEqual(index.byOptionId.get("OLD-1")?.goodsKeys, ["1001"]);
  assert.match(index.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("historical option fallback resolves only after current goods identity is ambiguous", () => {
  const ambiguousPlanning = planningWithAmbiguousGoodsKey();
  const fallback = buildHistoricalOptionFallbackIndex(ambiguousPlanning, [catalog()]);
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [order()],
    ambiguousPlanning,
    range,
    fallback,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.fallbackResolvedRows, 1);
  assert.equal(result.fallbackBaseUnits, 6);
  assert.equal(result.fallbackRevenue, 3000);
  assert.equal(result.monthlyRows[0].barcode, "BAA1-1");
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("historical option never overrides a current exact option mapping", () => {
  const fallback = buildHistoricalOptionFallbackIndex(planning(), [
    catalog({ optionId: "NEW-1" }),
  ]);
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [order({ opt_id: "NEW-1" })],
    planning(),
    range,
    fallback,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.fallbackResolvedRows, 0);
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("current shadow aggregation accepts a one-letter location suffix on the option self-code", () => {
  const current = planning({
    products: [
      {
        skuId: "other",
        barcode: "BAA1-1",
        productName: "다른 상품",
        optionName: "단품",
        skuActive: true,
        listings: [{ goodsKey: "OTHER", optionId: "STALE", unitsPerOrder: 2, active: true }],
      },
      {
        skuId: "waist-stretcher",
        barcode: "BAF1-1",
        productName: "허리스트레칭기구",
        optionName: "단품",
        skuActive: true,
        listings: [{ goodsKey: "115082", optionId: "CURRENT", unitsPerOrder: 1, active: true }],
      },
    ],
  });
  const fallback = buildHistoricalOptionFallbackIndex(current, []);
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [
      order({
        ord_no: "WAIST-100",
        opt_id: "STALE",
        prod_id: "OLD-115082",
        mall_prod_key: "OLD-MALL-115082",
        mall_ptn_opt_cd: "BAF1-1e",
        mall_ord_cnt: "100",
      }),
    ],
    current,
    range,
    fallback,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BAF1-1");
  assert.equal(result.monthlyRows[0].quantity, 100);
});

test("current shadow uses order-time product names to disambiguate a location-suffixed single pack", () => {
  const current = planning({
    products: [
      {
        skuId: "doorbell",
        barcode: "BBF6-1",
        productName: "원목 우드도어벨",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "SINGLE", optionId: "SINGLE", unitsPerOrder: 1, active: true },
          { goodsKey: "PAIR", optionId: "PAIR", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [order({ opt_id: "27080308", prod_id: "118560", ptn_goods_cd: "BBF6-1V", t_prod_nm: "도어벨 원목우드미니종 현관종 자석 마그네틱", t_opt_valu: "브라운", mall_ord_cnt: "1" })],
    current,
    range,
    buildHistoricalOptionFallbackIndex(current, []),
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BBF6-1");
  assert.equal(result.monthlyRows[0].quantity, 1);
});

test("goods_key mismatch blocks historical fallback even when optionId matches", () => {
  const fallback = buildHistoricalOptionFallbackIndex(planning(), [catalog()]);
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [order({ prod_id: "DIFFERENT", mall_prod_key: "ALSO-DIFFERENT" })],
    planning(),
    range,
    fallback,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
  assert.equal(result.fallbackResolvedRows, 0);
  assert.equal(result.fallbackRejectedGoodsKeyMismatch, 1);
});

test("conflicting managed code blocks historical fallback after current resolver fails", () => {
  const ambiguousPlanning = planningWithAmbiguousGoodsKey();
  const fallback = buildHistoricalOptionFallbackIndex(ambiguousPlanning, [catalog()]);
  const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
    [order({ ptn_goods_cd: "ZZZ9-9" })],
    ambiguousPlanning,
    range,
    fallback,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
  assert.equal(result.fallbackResolvedRows, 0);
  assert.equal(result.fallbackRejectedDirectCodeConflict, 1);
});

test("ambiguous historical barcode is never added to fallback index", () => {
  const index = buildHistoricalOptionFallbackIndex(planning(), [
    catalog(),
    catalog({ barcode: "BBB1-1" }),
  ]);
  assert.equal(index.stats.safeOptionCount, 0);
  assert.equal(index.stats.ambiguousHistoricalBarcodeCount, 1);
});

test("ambiguous current pack ratio is never added to fallback index", () => {
  const ambiguousPlanning = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재 상품",
        optionName: "현재 옵션",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "NEW-1", unitsPerOrder: 1, active: true },
          { goodsKey: "1002", optionId: "NEW-2", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const index = buildHistoricalOptionFallbackIndex(ambiguousPlanning, [catalog()]);
  assert.equal(index.stats.safeOptionCount, 0);
  assert.equal(index.stats.ambiguousCurrentUnitsCount, 1);
});

test("current SKU without an active listing is not considered safe historical fallback", () => {
  const noListingPlanning = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재 상품",
        optionName: "현재 옵션",
        skuActive: true,
        listings: [],
      },
    ],
  });
  const index = buildHistoricalOptionFallbackIndex(noListingPlanning, [catalog()]);
  assert.equal(index.stats.safeOptionCount, 0);
  assert.equal(index.stats.noCurrentListingCount, 1);
});
