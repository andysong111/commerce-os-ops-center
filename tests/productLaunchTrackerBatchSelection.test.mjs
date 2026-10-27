import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  availableProductLaunchPriorityBatches,
  isProductLaunchSeoBulkSelectable,
  MAX_SEO_BULK_SELECTION,
  selectProductLaunchSeoBulkItems,
} from "../public/product-launch-tracker-app/lib/seo-bulk-selection.mjs";
import { isProductLaunchSeoBulkReady } from "../src/lib/productLaunchStockAwarePage.ts";

function readyItem(overrides = {}) {
  return {
    id: "item-1",
    seoExclusion: { excluded: false },
    stockAvailability: { status: "ON_SALE", selectable: true },
    receiptPending: false,
    readiness: { ready: true },
    ...overrides,
  };
}

test("quick filters expose only existing priority work batches in business order", () => {
  assert.deepEqual(
    availableProductLaunchPriorityBatches([
      "기타",
      "신규소싱확정",
      "제작 예정 상품들",
    ]),
    ["제작 예정 상품들", "신규소싱확정"],
  );
});

test("SEO bulk selection allows ready sellable products and caps one run at 50", () => {
  const candidates = Array.from({ length: 70 }, (_, index) =>
    readyItem({ id: `ready-${index + 1}` }),
  );
  candidates.splice(3, 0, readyItem({ id: "sold-out", stockAvailability: { selectable: false } }));
  candidates.splice(5, 0, readyItem({ id: "receipt-pending", receiptPending: true }));
  candidates.splice(7, 0, readyItem({ id: "materials-missing", readiness: { ready: false } }));
  candidates.splice(9, 0, readyItem({ id: "discontinued", seoExclusion: { excluded: true } }));

  const selected = selectProductLaunchSeoBulkItems(candidates);
  assert.equal(MAX_SEO_BULK_SELECTION, 50);
  assert.equal(selected.length, 50);
  assert.ok(selected.every(isProductLaunchSeoBulkSelectable));
  assert.ok(selected.every((item) => !item.id.includes("sold-out")));
});

test("partially sold-out products remain eligible only when their sellable options are enforced", () => {
  const partial = readyItem({
    stockAvailability: { status: "PARTIAL_SOLD_OUT", selectable: true },
  });
  assert.equal(isProductLaunchSeoBulkSelectable(partial), true);
  assert.equal(isProductLaunchSeoBulkReady(partial), true);
  assert.equal(
    isProductLaunchSeoBulkReady(
      readyItem({ stockAvailability: { status: "UNKNOWN", selectable: false } }),
    ),
    false,
  );
});

test("tracker wires ready-only server filtering to a selection-only button", async () => {
  const [html, app, route, normalizedStore, stockAwarePage] = await Promise.all([
    readFile("public/product-launch-tracker-app/index.html", "utf8"),
    readFile("public/product-launch-tracker-app/optimized-app.js", "utf8"),
    readFile("src/app/api/product-launch-tracker/optimized/route.ts", "utf8"),
    readFile("src/lib/productLaunchTrackerNormalizedStore.ts", "utf8"),
    readFile("src/lib/productLaunchStockAwarePage.ts", "utf8"),
  ]);

  assert.match(html, /id="batch-quick-filters"/);
  assert.match(html, /id="seo-ready-only-filter"/);
  assert.match(html, /id="select-filtered-seo-ready"/);
  assert.match(app, /seoReadyOnly: String\(state\.filters\.seoReadyOnly\)/);
  assert.match(app, /state\.pageSize = MAX_SEO_BULK_SELECTION/);
  assert.match(app, /selectProductLaunchSeoBulkItems\(state\.items\)/);
  const selectionFunction = app.split("async function selectFilteredSeoReadyItems")[1]
    ?.split("async function applyBulkStatus")[0] ?? "";
  assert.ok(selectionFunction);
  assert.doesNotMatch(selectionFunction, /window\.open|localStorage\.setItem|openBulkCloud/);
  assert.match(route, /searchParams\.get\("seoReadyOnly"\)/);
  assert.match(normalizedStore, /summary_payload->readiness/);
  assert.match(normalizedStore, /summary_payload->receiptPending/);
  assert.match(stockAwarePage, /!seoReadyOnly \|\| isProductLaunchSeoBulkReady\(item\)/);
  assert.match(stockAwarePage, /const showUnknown = !seoReadyOnly/);
});
