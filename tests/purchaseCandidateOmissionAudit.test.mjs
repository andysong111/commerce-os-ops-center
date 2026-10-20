import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseCandidateOmissionReview } from "../src/lib/purchaseCandidateOmissionAudit.ts";

const planning = (overrides = {}) => ({
  barcode: "BCA5-1",
  modelNo: "AAA001",
  productName: "SIMULATION ONLY",
  skuActive: true,
  inventoryQuantity: 10,
  salesQuantity30: 5,
  salesQuantity90: 20,
  salesQuantity365: 80,
  orderDecision: "발주 보류",
  recommendedOrderQuantity: 0,
  ...overrides,
});

const priority = (overrides = {}) => ({
  barcode: "BCA5-1",
  purchaseStatus: "발주 보류",
  originalPurchaseStatus: "발주 보류",
  recommendedQty: 0,
  openCommitment: 0,
  ...overrides,
});

const metadata = (overrides = {}) => ({
  supplierLink: "https://detail.1688.com/offer/1.html",
  chinaOption: "黑色",
  conflict: false,
  shoplingQuantity: 10,
  shoplingSyncedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const audit = ({
  products = [planning()],
  rows = [priority()],
  inventory = [["BCA5-1", { inventoryQuantity: 10 }]],
  sources = [["BCA5-1", metadata()]],
  sourceMetadataAvailable = true,
} = {}) => buildPurchaseCandidateOmissionReview({
  planningProducts: products,
  priorityRows: rows,
  inventoryByBarcode: new Map(inventory),
  sourceMetadataByBarcode: new Map(sources),
  sourceMetadataAvailable,
});

test("Shopling sold-out evidence cannot be hidden by a positive inventory ledger", () => {
  const rows = audit({
    inventory: [["BCA5-1", { inventoryQuantity: 500 }]],
    sources: [["BCA5-1", metadata({ shoplingQuantity: 0 })]],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "BLOCKING");
  assert.ok(rows[0].reasons.includes("SHOPLING_ZERO_LEDGER_POSITIVE"));
  assert.equal(rows[0].ledgerInventoryQuantity, 500);
  assert.equal(rows[0].shoplingQuantity, 0);
});

test("a Product Master recommendation missing from purchase candidates blocks the draft", () => {
  const rows = audit({
    products: [planning({
      barcode: "BCD8-1",
      orderDecision: "발주 추천",
      recommendedOrderQuantity: 100,
    })],
    rows: [priority({ barcode: "BCD8-1" })],
    inventory: [["BCD8-1", { inventoryQuantity: 0 }]],
    sources: [["BCD8-1", metadata({ supplierLink: "", chinaOption: "" })]],
  });

  assert.equal(rows[0].severity, "BLOCKING");
  assert.ok(rows[0].reasons.includes("RECOMMENDATION_EVIDENCE_BLOCKED"));
  assert.ok(rows[0].reasons.includes("SUPPLIER_LINK_MISSING"));
  assert.ok(rows[0].reasons.includes("CHINA_OPTION_MISSING"));
});

test("recent sales missing from the purchase shadow cannot disappear silently", () => {
  const rows = audit({ rows: [] });

  assert.equal(rows[0].severity, "BLOCKING");
  assert.ok(rows[0].reasons.includes("PURCHASE_SHADOW_ROW_MISSING"));
});

test("missing source preparation stays visible without inventing an order", () => {
  const rows = audit({
    rows: [priority({ purchaseStatus: "발주 추천", recommendedQty: 20 })],
    sources: [["BCA5-1", metadata({ supplierLink: "", chinaOption: "" })]],
  });

  assert.equal(rows[0].severity, "PREPARATION");
  assert.equal(rows[0].recommendedQuantity, 20);
  assert.deepEqual(rows[0].reasons, ["SUPPLIER_LINK_MISSING", "CHINA_OPTION_MISSING"]);
});

test("inactive or never-sold products do not flood omission review", () => {
  const rows = audit({
    products: [
      planning({ skuActive: false }),
      planning({
        barcode: "BCA5-2",
        salesQuantity30: 0,
        salesQuantity90: 0,
        salesQuantity365: 0,
      }),
    ],
    rows: [],
    inventory: [],
    sources: [],
  });

  assert.deepEqual(rows, []);
});

test("a fully accounted recommendation with complete source evidence is omitted from review", () => {
  const rows = audit({
    products: [planning({ orderDecision: "발주 추천", recommendedOrderQuantity: 20 })],
    rows: [priority({ purchaseStatus: "발주 추천", recommendedQty: 20 })],
  });

  assert.deepEqual(rows, []);
});
