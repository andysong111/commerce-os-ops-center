import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const directory = await mkdtemp(
    join(process.cwd(), "tests", ".direct-code-evidence-"),
  );
  let source = await readFile(
    new URL(
      "../src/lib/productMasterShoplingSalesDirectCodeEvidenceEngine.ts",
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
  collectProductMasterShoplingSalesDirectCodeEvidenceChunk,
  combineProductMasterShoplingSalesDirectCodeEvidence,
  rawManagedCode,
} = await loadEngine();

const range = { start: "2026-08-01", end: "2026-08-07" };

function order(overrides = {}) {
  return {
    ord_no: "ORD-1",
    mall_ord_seq: "1",
    mall_ord_dt: "20260806120000",
    ord_status: "배송완료",
    opt_id: "OLD-OPT-1",
    prod_id: "117580",
    mall_ord_cnt: "1",
    mall_unit_price: "1000",
    ptn_goods_cd: "BAA1-1",
    ...overrides,
  };
}

function planning(overrides = {}) {
  return {
    generatedAt: "2026-08-07T00:00:00.000Z",
    contentFingerprint: "sha256:test",
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재상품",
        optionName: "현재옵션",
        skuActive: true,
        listings: [
          {
            goodsKey: "CURRENT",
            optionId: "CURRENT-OPT",
            unitsPerOrder: 2,
            active: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("raw managed code uses the same Shopling order fields as the canonical resolver", () => {
  assert.equal(
    rawManagedCode({ optPtnOptCd: "BBA3-3", ptn_goods_cd: "BBA2-1" }),
    "BBA3-3",
  );
  assert.equal(
    rawManagedCode({ mall_opt_cd: "BBA3-3", ptn_goods_cd: "BBA2-1" }),
    "BBA3-3",
  );
  assert.equal(rawManagedCode({ ptn_goods_cd: " baa1-1 " }), "BAA1-1");
  assert.equal(rawManagedCode({ buying_cd: "BBB2-3" }), "BBB2-3");
  assert.equal(rawManagedCode({ mall_opt_cd: "CCC4-5" }), "CCC4-5");
  assert.equal(rawManagedCode({ ptn_goods_cd: "not-managed" }), "");
});

test("collector keeps only valid sale rows with optionId and direct managed code", () => {
  const result = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [
      order(),
      order({ ord_no: "ORD-2", mall_ord_seq: "2" }),
      order({ ord_no: "ORD-3", mall_ord_seq: "3", ord_status: "취소완료" }),
      order({ ord_no: "ORD-4", mall_ord_seq: "4", ptn_goods_cd: "" }),
    ],
    range,
  );
  assert.equal(result.fetchedRows, 4);
  assert.equal(result.validRows, 3);
  assert.equal(result.directEvidenceRows, 2);
  assert.equal(result.options.length, 1);
  assert.deepEqual(result.options[0].barcodes, ["BAA1-1"]);
  assert.deepEqual(result.options[0].productIds, ["117580"]);
  assert.equal(result.options[0].observedRows, 2);
});

test("one optionId, one historical barcode, one product and one current pack ratio becomes safe", () => {
  const chunk = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [order(), order({ ord_no: "ORD-2", mall_ord_seq: "2" })],
    range,
  );
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    [chunk],
    planning(),
    [
      {
        optionId: "OLD-OPT-1",
        productId: "117580",
        managedCode: null,
      },
    ],
  );
  assert.equal(report.safeOptionIdCount, 1);
  assert.equal(report.highConfidenceStoredSampleCandidates, 1);
  assert.equal(report.safeOptions[0].barcode, "BAA1-1");
  assert.equal(report.safeOptions[0].productId, "117580");
  assert.equal(report.safeOptions[0].unitsPerOrder, 2);
});

test("same historical optionId pointing to two managed codes is blocked", () => {
  const chunk = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [
      order(),
      order({ ord_no: "ORD-2", mall_ord_seq: "2", ptn_goods_cd: "BBB1-1" }),
    ],
    range,
  );
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    [chunk],
    planning(),
    [],
  );
  assert.equal(report.safeOptionIdCount, 0);
  assert.equal(
    report.classifications.find(
      (row) => row.classification === "AMBIGUOUS_HISTORICAL_BARCODE",
    )?.count,
    1,
  );
});

test("same optionId observed under two Shopling product IDs is blocked", () => {
  const chunk = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [
      order(),
      order({ ord_no: "ORD-2", mall_ord_seq: "2", prod_id: "OTHER" }),
    ],
    range,
  );
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    [chunk],
    planning(),
    [],
  );
  assert.equal(report.safeOptionIdCount, 0);
  assert.equal(
    report.classifications.find(
      (row) => row.classification === "AMBIGUOUS_HISTORICAL_PRODUCT",
    )?.count,
    1,
  );
});

test("current SKU without an active listing is never safe direct-code evidence", () => {
  const chunk = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [order()],
    range,
  );
  const noListing = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "현재상품",
        optionName: "현재옵션",
        skuActive: true,
        listings: [],
      },
    ],
  });
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    [chunk],
    noListing,
    [],
  );
  assert.equal(report.safeOptionIdCount, 0);
  assert.equal(
    report.classifications.find(
      (row) => row.classification === "NO_ACTIVE_CURRENT_LISTING",
    )?.count,
    1,
  );
});

test("stored unmapped sample must match historical product and cannot conflict on managed code", () => {
  const chunk = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
    [order()],
    range,
  );
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    [chunk],
    planning(),
    [
      { optionId: "OLD-OPT-1", productId: "117580", managedCode: null },
      { optionId: "OLD-OPT-1", productId: "OTHER", managedCode: null },
      { optionId: "OLD-OPT-1", productId: "117580", managedCode: "BBB1-1" },
    ],
  );
  assert.equal(report.highConfidenceStoredSampleCandidates, 1);
  assert.equal(report.conflictingStoredSampleManagedCodes, 1);
});
