import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyProductLaunchStockAvailability,
  buildProductLaunchInventoryIndex,
  classifyProductLaunchStockAvailability,
} from "../src/lib/productLaunchStockAvailability.ts";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";

function inventory(rows) {
  return buildProductLaunchInventoryIndex({
    generatedAt: "2026-10-27T00:00:00.000Z",
    contentFingerprint: "stock-fixture-v1",
    rows,
  });
}

function row(barcode, quantity, overrides = {}) {
  return {
    barcode,
    inventoryQuantity: quantity,
    inventoryVerified: true,
    inventoryRequiresReview: false,
    ...overrides,
  };
}

function item() {
  return {
    id: "launch-stock-test",
    modelNumber: "AAA999",
    productName: "재고 안전 테스트",
    shoplingCategory: "생활>잡화",
    selfCodeBase: "PLSTOCKTEST1",
    detailPageAsset: {
      html: "<p>상세</p>",
      mainImageUrl: "https://example.com/main.jpg",
    },
    orderOptions: [
      {
        id: "black",
        optionName: "색상",
        saleOption: "블랙",
        barcode: "BAA1-1",
        optionBarcodeNo: "000000000101",
        baseSalePriceKrw: 10000,
      },
      {
        id: "white",
        optionName: "색상",
        saleOption: "화이트",
        barcode: "BAA1-2",
        optionBarcodeNo: "000000000102",
        baseSalePriceKrw: 11000,
      },
    ],
  };
}

test("verified zero marks only that option sold out and keeps the product selectable", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    inventory([row("BAA1-1", 5), row("BAA1-2", 0)]),
  );
  assert.equal(stock.status, "PARTIAL_SOLD_OUT");
  assert.equal(stock.selectable, true);
  assert.deepEqual(stock.options.map(({ status }) => status), ["ON_SALE", "SOLD_OUT"]);

  const payload = buildProductLaunchShoplingPayload(
    applyProductLaunchStockAvailability(item(), stock),
    {},
    "stock-partial-test",
  );
  assert.equal(payload.stockPolicy.enforced, true);
  assert.deepEqual(
    payload.channels[0].options.map(({ stockStatus }) => stockStatus),
    ["ON_SALE", "SOLD_OUT"],
  );
});

test("all verified zero blocks registration", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    inventory([row("BAA1-1", 0), row("BAA1-2", 0)]),
  );
  assert.equal(stock.status, "SOLD_OUT");
  assert.equal(stock.selectable, false);
  assert.throws(
    () =>
      buildProductLaunchShoplingPayload(
        applyProductLaunchStockAvailability(item(), stock),
        {},
        "stock-all-zero-test",
      ),
    /모든 옵션이 품절/,
  );
});

test("missing or unverified inventory fails closed", () => {
  const missing = classifyProductLaunchStockAvailability(
    item(),
    inventory([row("BAA1-1", 5)]),
  );
  assert.equal(missing.status, "UNKNOWN");
  assert.equal(missing.selectable, false);

  const unverified = classifyProductLaunchStockAvailability(
    item(),
    inventory([
      row("BAA1-1", 5),
      row("BAA1-2", 9, { inventoryVerified: false }),
    ]),
  );
  assert.equal(unverified.status, "UNKNOWN");
});

test("discontinued items are classified as excluded even when stock is positive", () => {
  const discontinued = {
    ...item(),
    discontinuation: { status: "confirmed", reason: "사용자 단종 확정" },
  };
  const stock = classifyProductLaunchStockAvailability(
    discontinued,
    inventory([row("BAA1-1", 5), row("BAA1-2", 7)]),
  );
  assert.equal(stock.status, "EXCLUDED");
  assert.equal(stock.selectable, false);

  const summarized = classifyProductLaunchStockAvailability(
    { ...item(), seoExclusion: { excluded: true, reason: "요약 단종" } },
    inventory([row("BAA1-1", 5), row("BAA1-2", 7)]),
  );
  assert.equal(summarized.status, "EXCLUDED");
});

test("tracker UI exposes sellable filter, red sold-out states, and stock-blocked selection", async () => {
  const [html, app, styles, handoff, enqueue, queue] = await Promise.all([
    readFile("public/product-launch-tracker-app/index.html", "utf8"),
    readFile("public/product-launch-tracker-app/optimized-app.js", "utf8"),
    readFile("public/product-launch-tracker-app/styles.css", "utf8"),
    readFile("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8"),
    readFile("src/app/api/seo-run-jobs/route.ts", "utf8"),
    readFile("src/lib/seoRunShoplingRegistrationQueue.ts", "utf8"),
  ]);
  assert.match(html, /id="stock-filter"/);
  assert.match(html, /value="SELLABLE" selected/);
  assert.match(app, /stockAvailability\?\.selectable === true/);
  assert.match(styles, /stock-partial-sold-out/);
  assert.match(styles, /stock-sold-out/);
  assert.match(handoff, /dataset\.stockSelectable === "false"/);
  assert.match(enqueue, /classifyProductLaunchStockAvailability/);
  assert.match(queue, /loadProductLaunchInventorySnapshot/);
});
