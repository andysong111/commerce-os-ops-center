import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingBcodeIndexRows,
  normalizeShoplingBcode,
} from "../src/lib/shopling/shoplingBcodeIndexCore.ts";

test("real A6 failure fixture becomes a stable B-code index without conflating model or quantity", () => {
  const rows = buildShoplingBcodeIndexRows(
    [
      {
        goods_key: "120867",
        ptn_goods_cd: "AAA365",
        sale_status: "B",
        optId: "4416179",
        optPtnOptCd: " bcd8–2 ",
        optStatus: "C",
        optQty: "0",
      },
      {
        goods_key: "120867",
        ptn_goods_cd: "AAA365",
        sale_status: "B",
        optId: "4416179",
        optPtnOptCd: "BCD8-2",
        optStatus: "C",
        optQty: "0",
      },
      { goods_key: "120868", optPtnOptCd: "AAA365" },
    ],
    "account-fingerprint",
    {
      refreshId: "00000000-0000-4000-8000-000000000001",
      observedAt: "2026-11-04T10:00:00.000Z",
    },
  );
  assert.equal(normalizeShoplingBcode(" bcd8–2 "), "BCD8-2");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      barcode: rows[0].barcode,
      goodsKey: rows[0].goods_key,
      optionId: rows[0].option_id,
      model: rows[0].partner_goods_code,
      quantityObserved: rows[0].option_quantity_observed,
    },
    {
      barcode: "BCD8-2",
      goodsKey: "120867",
      optionId: "4416179",
      model: "AAA365",
      quantityObserved: "0",
    },
  );
});

test("HF65 option and product writes omit quantity and require API readback", async () => {
  const [option, product, route] = await Promise.all([
    readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8"),
    readFile("src/lib/shopling/shoplingProductStatus.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/shopling-option-status/route.ts", "utf8"),
  ]);
  const optionWrite = option.slice(
    option.indexOf("function buildModifyXml"),
    option.indexOf("function parseModifyResponse"),
  );
  assert.doesNotMatch(optionWrite, /optQty/);
  assert.match(option, /const delays = \[0, 400, 1_200\]/);
  assert.match(option, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
  assert.match(product, /buildMonthlySaleStatusWriteXml/);
  assert.match(product, /after\.optionQuantity === before\.optionQuantity/);
  assert.match(product, /SHOPLING_PRODUCT_READBACK_QTY_MISMATCH/);
  assert.match(route, /loadIndexedShoplingGoodsKeys/);
  assert.match(route, /SHOPLING_BCODE_INDEX_MISSING/);
  assert.match(route, /receipts/);
});

test("HF65 browser path skips A4 and A6 and owns only A21 after API receipts", async () => {
  const [bridge, background, download, migration] = await Promise.all([
    readFile("public/shopling-stock-state-sync/content-ops-v022.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v087.js", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download-hf65/route.ts", "utf8"),
    readFile("supabase/migrations/20261104193000_shopling_bcode_option_index.sql", "utf8"),
  ]);
  assert.match(bridge, /stockStateApiApplied: true/);
  assert.match(bridge, /goodsKeySource: "SHOPLING_BCODE_API_INDEX"/);
  assert.match(background, /stage: "A21_LIST"/);
  assert.match(background, /browserStagesSkipped: \["A4", "A6"\]/);
  assert.match(background, /commerceOsBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED"/);
  assert.match(download, /const VERSION = "0\.6\.28"/);
  assert.match(download, /skippedBrowserStages: \["A4", "A6"\]/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all.*anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete.*service_role/);
});
