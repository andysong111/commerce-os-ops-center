import assert from "node:assert/strict";
import test from "node:test";
import {
  captureShoplingShipmentManifest,
  normalizeShipmentManifestCapture,
  selectShoplingB12Target,
  SHOPLING_SHIPMENT_MANIFEST_EXPRESSION,
} from "../local-agent/src/shopling-shipment-manifest.mjs";

const config = {
  chromeDebugBaseUrl: "http://127.0.0.1:9222",
  shoplingOrigins: ["https://a.shopling.co.kr/"],
};

test("B12 manifest probe reads only shipment identity columns", () => {
  assert.match(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /cells\[11\]/);
  assert.match(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /cells\[12\]/);
  assert.match(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /cells\[13\]/);
  assert.match(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /cells\[14\]/);
  assert.doesNotMatch(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /cells\[(?:7|8|9)\]/);
  assert.doesNotMatch(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /\.click\s*\(/);
  assert.doesNotMatch(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /\.submit\s*\(/);
  assert.doesNotMatch(SHOPLING_SHIPMENT_MANIFEST_EXPRESSION, /fetch\s*\(/);
});

test("B12 target selection requires one exact courier page", () => {
  const target = selectShoplingB12Target([
    { type: "page", url: "https://a.shopling.co.kr/order/dlvy_list.phtml" },
    { type: "page", url: "https://a.shopling.co.kr/order/order_list.phtml" },
  ], config.shoplingOrigins);
  assert.equal(target.url.endsWith("dlvy_list.phtml"), true);
  assert.throws(() => selectShoplingB12Target([], config.shoplingOrigins), { code: "SHOPLING_B12_TARGET_COUNT_INVALID" });
});

test("captured manifest excludes personal delivery fields and keeps A04 rows", () => {
  const sensitiveRecipient = "PRIVATE_RECIPIENT_123";
  const manifest = normalizeShipmentManifestCapture({
    url: "https://a.shopling.co.kr/order/dlvy_list.phtml",
    capturedAt: "2026-09-30T03:31:00.000Z",
    resultCount: 2,
    filters: { courierStatus: "002", primarySort: "sort_tp_ptn_opt_cd" },
    rows: [
      {
        sourceRowNumber: 1,
        selected: true,
        shoplingOrderNo: "3493809",
        orderStatus: "A04",
        invoiceText: "CJ대한통운 5876-2537-5225",
        shoplingProductCode: "116501",
        productText: "sample product (single)",
        quantity: 2,
        recipientName: sensitiveRecipient,
      },
      {
        sourceRowNumber: 2,
        selected: false,
        shoplingOrderNo: "3492903",
        orderStatus: "A05",
        invoiceText: "CJ대한통운 587625369835",
        shoplingProductCode: "119923",
        productText: "completed product",
        quantity: 1,
      },
    ],
  }, { status: "A04" });
  assert.equal(manifest.orderCount, 1);
  assert.equal(manifest.orders[0].invoiceNo, "587625375225");
  assert.equal(manifest.orders[0].bCode, "");
  assert.deepEqual(manifest.privacy, {
    recipientNameStored: false,
    phoneStored: false,
    addressStored: false,
  });
  assert.equal(JSON.stringify(manifest).includes(sensitiveRecipient), false);
});

test("manifest extracts one tracking number when the invoice cell also contains print time", () => {
  const manifest = normalizeShipmentManifestCapture({
    url: "https://a.shopling.co.kr/order/dlvy_list.phtml",
    capturedAt: "2026-09-30T03:31:00.000Z",
    resultCount: 1,
    filters: {},
    rows: [{
      sourceRowNumber: 1,
      selected: true,
      shoplingOrderNo: "3493809",
      orderStatus: "A04",
      invoiceText: "CJ대한통운 5876-2537-5225 출력 2026.09.30 12:31",
      shoplingProductCode: "116501",
      productText: "sample product",
      quantity: 1,
    }],
  }, { status: "A04" });
  assert.equal(manifest.orderCount, 1);
  assert.equal(manifest.orders[0].invoiceNo, "587625375225");
});

test("manifest rejects an invoice cell containing multiple tracking numbers", () => {
  const manifest = normalizeShipmentManifestCapture({
    url: "https://a.shopling.co.kr/order/dlvy_list.phtml",
    capturedAt: "2026-09-30T03:31:00.000Z",
    resultCount: 1,
    filters: {},
    rows: [{
      sourceRowNumber: 1,
      selected: true,
      shoplingOrderNo: "3493809",
      orderStatus: "A04",
      invoiceText: "587625375225 587625375310",
      shoplingProductCode: "116501",
      productText: "sample product",
      quantity: 1,
    }],
  }, { status: "A04" });
  assert.equal(manifest.orderCount, 0);
  assert.equal(manifest.rejectedRows[0].code, "SHIPMENT_ROW_INVOICE_AMBIGUOUS");
});

test("live capture wrapper remains read-only and normalizes the result", async () => {
  let evaluatedExpression = "";
  const manifest = await captureShoplingShipmentManifest(config, { status: "A04" }, {
    listChromeTargets: async () => ({
      available: true,
      targets: [{
        type: "page",
        url: "https://a.shopling.co.kr/order/dlvy_list.phtml",
        webSocketDebuggerUrl: "ws://fixture",
      }],
    }),
    withCdpTarget: async (_target, handler) => handler({
      send: async (method, params) => {
        assert.equal(method, "Runtime.evaluate");
        evaluatedExpression = params.expression;
        return {
          result: {
            value: {
              url: "https://a.shopling.co.kr/order/dlvy_list.phtml",
              capturedAt: "2026-09-30T03:31:00.000Z",
              resultCount: 1,
              filters: {},
              rows: [{
                sourceRowNumber: 1,
                selected: true,
                shoplingOrderNo: "3493809",
                orderStatus: "A04",
                invoiceText: "587625375225",
                shoplingProductCode: "116501",
                productText: "sample",
                quantity: 1,
              }],
            },
          },
        };
      },
    }),
  });
  assert.equal(manifest.orderCount, 1);
  assert.equal(evaluatedExpression, SHOPLING_SHIPMENT_MANIFEST_EXPRESSION);
});

test("stockout reconciliation blocks until a missing B-code is resolved", async () => {
  const { reconcileUnshippedLabels } = await import("../local-agent/src/shopling-unshipped-reconciliation.mjs");
  const result = reconcileUnshippedLabels({
    manifestRows: [{ shoplingOrderNo: "3493809", invoiceNo: "587625375225", quantity: 1 }],
    observations: [{ trackingCandidates: ["587625375225"], reason: "STOCKOUT" }],
  });
  assert.equal(result.proposedActions.invoiceDeletionCandidates.length, 1);
  assert.equal(result.proposedActions.stockoutCandidates.length, 0);
  assert.ok(result.blockedActions.some((item) => item.code === "STOCKOUT_BCODE_UNRESOLVED"));
});
