import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const [engine, monthly] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventEngine.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesBackfillEngine.ts", "utf8"),
]);

async function loadEngine() {
  const directory = await mkdtemp(
    join(process.cwd(), "tests", ".sales-event-engine-"),
  );
  let source = engine.replace(
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
  source = source.replace(
    /import type \{ ShoplingDateRange \} from "@\/lib\/shopling\/shoplingReadClient";/,
    "",
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

const { aggregateProductMasterShoplingSalesEventChunk } = await loadEngine();

test("event rows use the same base-unit and paid-amount inputs as the monthly canonical ledger", () => {
  assert.match(engine, /Math\.round\(number\(order\.quantity\)\)\) \* identity\.unitsPerOrder/);
  assert.match(engine, /Math\.round\(number\(order\.paidAmount\)\)/);
  assert.match(monthly, /current\.quantity \+= quantity \* identity\.unitsPerOrder/);
  assert.match(monthly, /current\.revenue \+= Math\.max\(0, number\(order\.paidAmount\)\)/);
});

test("cancelled and returned managed lines are retained as explicit tombstones", () => {
  assert.match(engine, /validSale = validSaleStatus\(order\.status\) && quantity > 0/);
  assert.match(engine, /validSale,/);
  assert.match(engine, /tombstoneRows: events\.length - validRows\.length/);
  assert.match(engine, /취소/);
  assert.match(engine, /반품/);
  assert.match(engine, /환불/);
});

test("exact historical option self-management code is evaluated before a later current option identity", () => {
  const optionBarcode = engine.indexOf("const optionBarcode = managedBarcode");
  const optionIdentityReturn = engine.indexOf("if (optionIdentity) return optionIdentity");
  const historicalDirect = engine.indexOf("historicalDirectIdentity(index, optionBarcode, order)");
  assert.ok(optionBarcode >= 0);
  assert.ok(historicalDirect > optionBarcode);
  assert.ok(optionIdentityReturn > historicalDirect);
  assert.match(engine, /historicalByBarcode/);
  assert.match(engine, /ownUnits\.size === 1/);
  assert.match(engine, /ownUnits\.size > 1\) return null/);
});

test("shared product code cannot collapse distinct option self-management codes", () => {
  const planning = {
    generatedAt: "2026-10-26T00:00:00.000Z",
    contentFingerprint: "sha256:test",
    products: [
      {
        skuId: "rabbit-white",
        barcode: "BBA2-1",
        productName: "토끼브로치",
        optionName: "화이트",
        skuActive: true,
        listings: [{ goodsKey: "G-RABBIT", optionId: "OPT-WHITE", unitsPerOrder: 1, active: true }],
      },
      {
        skuId: "rabbit-pink",
        barcode: "BBA3-3",
        productName: "토끼브로치",
        optionName: "핑크",
        skuActive: true,
        listings: [{ goodsKey: "G-RABBIT", optionId: "OPT-PINK", unitsPerOrder: 1, active: true }],
      },
    ],
  };
  const base = {
    mall_ord_dt: "20261025120000",
    ord_status: "배송완료",
    prod_id: "G-RABBIT",
    mall_ord_cnt: "1",
    mall_unit_price: "10000",
    ptn_goods_cd: "BBA2-1",
  };
  const result = aggregateProductMasterShoplingSalesEventChunk(
    [
      { ...base, ord_no: "RABBIT-1", mall_ord_seq: "1", opt_id: "OPT-WHITE", optPtnOptCd: "BBA2-1", mall_opt_cd: "BBA2-1" },
      { ...base, ord_no: "RABBIT-2", mall_ord_seq: "2", opt_id: "OPT-PINK", optPtnOptCd: "BBA3-3", mall_opt_cd: "BBA3-3" },
    ],
    planning,
    { start: "2026-10-25", end: "2026-10-25" },
    { analysisAsOf: "2026-10-26T00:00:00.000Z", syncedAt: "2026-10-26T00:01:00.000Z" },
  );

  assert.equal(result.unmappedRows, 0);
  assert.deepEqual(result.events.map((row) => row.barcode), ["BBA2-1", "BBA3-3"]);
});

test("event collection canonicalizes one Shopling warehouse-location suffix", () => {
  const planning = {
    generatedAt: "2026-10-26T00:00:00.000Z",
    contentFingerprint: "sha256:location-suffix",
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
  };
  const result = aggregateProductMasterShoplingSalesEventChunk(
    [
      {
        ord_no: "WAIST-100",
        mall_ord_seq: "1",
        mall_ord_dt: "20261025120000",
        ord_status: "배송완료",
        opt_id: "STALE",
        prod_id: "OLD-115082",
        mall_prod_key: "OLD-MALL-115082",
        mall_ptn_opt_cd: "BAF1-1e",
        mall_ord_cnt: "100",
        mall_unit_price: "1000",
      },
    ],
    planning,
    { start: "2026-10-25", end: "2026-10-25" },
    { analysisAsOf: "2026-10-26T00:00:00.000Z", syncedAt: "2026-10-26T00:01:00.000Z" },
  );

  assert.equal(result.unmappedRows, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].barcode, "BAF1-1");
  assert.equal(result.events[0].quantity, 100);
});

test("event collection recovers real BBF6 single-unit orders despite current single and 1+1 listings", () => {
  const planning = {
    generatedAt: "2026-10-26T00:00:00.000Z",
    contentFingerprint: "sha256:bbf6-pack-evidence",
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
  };
  const result = aggregateProductMasterShoplingSalesEventChunk(
    [
      {
        ord_no: "3263167",
        mall_ord_seq: "1",
        mall_ord_dt: "20261025120000",
        ord_status: "배송완료",
        opt_id: "27080308",
        prod_id: "118560",
        mall_prod_key: "11029062978",
        ptn_goods_cd: "BBF6-1V",
        t_prod_nm: "도어벨 원목우드미니종 현관종 자석 마그네틱",
        t_opt_valu: "브라운",
        mall_prod_nm: "동네일등 우드도어벨 문방울 문딸랑이 자석 현관문",
        mall_opt_valu: "색상: 브라운",
        mall_ord_cnt: "1",
        mall_unit_price: "6370",
      },
    ],
    planning,
    { start: "2026-10-25", end: "2026-10-25" },
    { analysisAsOf: "2026-10-26T00:00:00.000Z", syncedAt: "2026-10-26T00:01:00.000Z" },
  );
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.events[0].barcode, "BBF6-1");
  assert.equal(result.events[0].quantity, 1);
});


test("Shopling source range is not treated as the order-date truth", () => {
  assert.match(engine, /PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS = 360/);
  assert.match(engine, /insideGlobalAnalysisWindow/);
  assert.match(engine, /options\.analysisAsOf/);
  assert.doesNotMatch(engine, /inDateRange\(orderedAt, range\)/);
  assert.match(engine, /Cross-range duplicates are[\s\S]*externalId/);
});

test("managed B-code scope is preserved and old non-B rows are ignored", () => {
  assert.match(engine, /const MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}\\d\+-\\d\+\$\//);
  assert.match(engine, /if \(!isManagedSalesScope\(index, order, raw\)\)/);
  assert.match(engine, /ignoredRows \+= 1/);
});

test("cross-chunk identity disagreement is surfaced instead of silently overwritten", () => {
  assert.match(engine, /prior\.barcode !== event\.barcode \|\| prior\.occurredAt !== event\.occurredAt/);
  assert.match(engine, /conflicts\.push\(event\.externalId\)/);
  assert.match(engine, /conflictExternalIds/);
});

test("wire contract is pinned to Product Master canonical sales event API", () => {
  assert.match(engine, /commerce-os-sales-events-v1/);
  assert.match(engine, /shopling_orders_event_v1/);
  assert.match(engine, /externalId: order\.id/);
  assert.match(engine, /occurredAt: orderedAt/);
});
