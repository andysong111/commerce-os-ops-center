import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyProductLaunchStockAvailability,
  buildProductLaunchStockStatusIndex,
  classifyProductLaunchStockAvailability,
} from "../src/lib/productLaunchStockAvailability.ts";
import { buildProductLaunchShoplingStockSnapshotFromRows } from "../src/lib/productLaunchShoplingStockState.ts";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";

function stockIndex(rows = []) {
  return buildProductLaunchStockStatusIndex({
    generatedAt: "2026-10-27T00:00:00.000Z",
    contentFingerprint: "shopling-stock-transmission-fixture-v1",
    rows,
  });
}

function event(
  barcode,
  desiredStatus,
  outcome = "SUCCEEDED",
  occurredAt = "2026-10-27T00:00:00.000Z",
) {
  return {
    eventId: `${barcode}-${desiredStatus}-${outcome}-${occurredAt}`,
    barcode,
    desiredStatus,
    outcome,
    occurredAt,
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

test("persisted Shopling transmission snapshots become the launch stock authority", () => {
  const snapshot = buildProductLaunchShoplingStockSnapshotFromRows(
    [
      {
        source_event_id: "shopling-stock-sync:event-1",
        result_snapshot: {
          accepted: true,
          snapshot: {
            eventId: "event-1",
            barcode: "BAA1-2",
            desiredStatus: "SOLD_OUT",
            outcome: "SUCCEEDED",
            occurredAt: "2026-10-27T00:00:00.000Z",
          },
        },
        started_at: "2026-10-27T00:00:00.000Z",
      },
    ],
    "2026-10-27T00:01:00.000Z",
  );
  const stock = classifyProductLaunchStockAvailability(
    item(),
    buildProductLaunchStockStatusIndex(snapshot),
  );
  assert.equal(stock.status, "PARTIAL_SOLD_OUT");
  assert.equal(stock.options[1].status, "SOLD_OUT");
  assert.match(stock.sourceFingerprint, /^sha256:/);
});

test("a malformed persisted transmission blocks the authority instead of defaulting to sale", () => {
  assert.throws(
    () =>
      buildProductLaunchShoplingStockSnapshotFromRows([
        { result_snapshot: { snapshot: { barcode: "BAA1-2" } } },
      ]),
    /PRODUCT_LAUNCH_SHOPLING_STOCK_AUTHORITY_INCOMPLETE/,
  );
});

test("a confirmed sold-out transmission marks only that option sold out", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    stockIndex([event("BAA1-2", "SOLD_OUT")]),
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

test("confirmed sold-out transmissions for every option block registration", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    stockIndex([
      event("BAA1-1", "SOLD_OUT"),
      event("BAA1-2", "SOLD_OUT"),
    ]),
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

test("no sold-out transmission means the option remains sellable", () => {
  const stock = classifyProductLaunchStockAvailability(item(), stockIndex());
  assert.equal(stock.status, "ON_SALE");
  assert.equal(stock.selectable, true);
  assert.deepEqual(stock.options.map(({ status }) => status), ["ON_SALE", "ON_SALE"]);
});

test("a later confirmed on-sale transmission reopens a sold-out option", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    stockIndex([
      event("BAA1-2", "SOLD_OUT", "SUCCEEDED", "2026-10-26T00:00:00.000Z"),
      event("BAA1-2", "ON_SALE", "SUCCEEDED", "2026-10-27T00:00:00.000Z"),
    ]),
  );
  assert.equal(stock.status, "ON_SALE");
  assert.equal(stock.options[1].status, "ON_SALE");
});

test("a failed transmission does not overwrite the last confirmed Shopling state", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    stockIndex([
      event("BAA1-2", "SOLD_OUT", "SUCCEEDED", "2026-10-26T00:00:00.000Z"),
      event("BAA1-2", "ON_SALE", "FAILED", "2026-10-27T00:00:00.000Z"),
    ]),
  );
  assert.equal(stock.status, "PARTIAL_SOLD_OUT");
  assert.equal(stock.options[1].status, "SOLD_OUT");
});

test("an unresolved latest transmission fails closed", () => {
  const stock = classifyProductLaunchStockAvailability(
    item(),
    stockIndex([
      event("BAA1-2", "SOLD_OUT", "SUCCEEDED", "2026-10-26T00:00:00.000Z"),
      event("BAA1-2", "ON_SALE", "UNCERTAIN", "2026-10-27T00:00:00.000Z"),
    ]),
  );
  assert.equal(stock.status, "UNKNOWN");
  assert.equal(stock.selectable, false);
});

test("an option without a B-code remains blocked because it cannot be synchronized", () => {
  const withoutBarcode = item();
  withoutBarcode.orderOptions[1].barcode = "";
  const stock = classifyProductLaunchStockAvailability(
    withoutBarcode,
    stockIndex(),
  );
  assert.equal(stock.status, "UNKNOWN");
  assert.equal(stock.options[1].status, "UNKNOWN");
});

test("discontinued items are classified as excluded even when stock is positive", () => {
  const discontinued = {
    ...item(),
    discontinuation: { status: "confirmed", reason: "사용자 단종 확정" },
  };
  const stock = classifyProductLaunchStockAvailability(
    discontinued,
    stockIndex(),
  );
  assert.equal(stock.status, "EXCLUDED");
  assert.equal(stock.selectable, false);

  const summarized = classifyProductLaunchStockAvailability(
    { ...item(), seoExclusion: { excluded: true, reason: "요약 단종" } },
    stockIndex(),
  );
  assert.equal(summarized.status, "EXCLUDED");
});

test("tracker UI exposes sellable filter, red sold-out states, and stock-blocked selection", async () => {
  const [html, app, styles, handoff, enqueue, queue, upload, sync, optimizedRoute] = await Promise.all([
    readFile("public/product-launch-tracker-app/index.html", "utf8"),
    readFile("public/product-launch-tracker-app/optimized-app.js", "utf8"),
    readFile("public/product-launch-tracker-app/styles.css", "utf8"),
    readFile("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8"),
    readFile("src/app/api/seo-run-jobs/route.ts", "utf8"),
    readFile("src/lib/seoRunShoplingRegistrationQueue.ts", "utf8"),
    readFile("src/app/api/product-launch-tracker/shopling-upload/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
    readFile("src/app/api/product-launch-tracker/optimized/route.ts", "utf8"),
  ]);
  assert.match(html, /id="stock-filter"/);
  assert.match(html, /value="SELLABLE" selected/);
  assert.match(app, /stockAvailability\?\.selectable === true/);
  assert.match(styles, /stock-partial-sold-out/);
  assert.match(styles, /stock-sold-out/);
  assert.match(handoff, /dataset\.stockSelectable === "false"/);
  assert.match(enqueue, /classifyProductLaunchStockAvailability/);
  assert.match(enqueue, /loadProductLaunchShoplingStockSnapshot\(\{ maxAgeMs: 0 \}\)/);
  assert.match(queue, /loadProductLaunchShoplingStockSnapshot/);
  assert.match(queue, /loadProductLaunchShoplingStockSnapshot\(\{ maxAgeMs: 0 \}\)/);
  assert.match(upload, /loadProductLaunchShoplingStockSnapshot\(\{ maxAgeMs: 0 \}\)/);
  assert.match(sync, /invalidateProductLaunchShoplingStockSnapshotCache\(\)/);
  assert.match(optimizedRoute, /const STOCK_AWARE_PAGE_READ_TIMEOUT_MS = 15_000;/);
  assert.match(
    optimizedRoute,
    /queryProductLaunchStockAwareNormalizedPage\([\s\S]*?STOCK_AWARE_PAGE_READ_TIMEOUT_MS/,
  );
});
