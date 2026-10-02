import assert from "node:assert/strict";
import test from "node:test";
import { createShoplingUnshippedReview } from "../local-agent/src/shopling-unshipped-review.mjs";

function dependencies(overrides = {}) {
  return {
    captureManifest: async () => ({
      capturedAt: "2026-09-30T03:31:00.000Z",
      orderCount: 1,
      selectedStatus: "A04",
      filters: { startDate: "20260930", endDate: "20260930" },
      privacy: { recipientNameStored: false, phoneStored: false, addressStored: false },
      orders: [{
        shoplingOrderNo: "3493809",
        invoiceNo: "587625375225",
        shoplingProductCode: "116501",
        quantity: 1,
        productName: "product",
      }],
    }),
    readIdentitySources: async () => ({
      orderRows: [{ ord_no: "3493809", prod_id: "116501", opt_id: "282" }],
      productRows: [{ goods_key: "116501", optId: "282", optPtnOptCd: "BAF3-2" }],
    }),
    createObservation: async (path, metadata) => ({
      imageId: path,
      fileName: path,
      trackingCandidates: ["587625375225"],
      ...metadata,
    }),
    ...overrides,
  };
}

test("end-to-end leftover label review remains dry-run with exact actions", async () => {
  const result = await createShoplingUnshippedReview({
    localConfig: {},
    apiConfig: {},
    imagePaths: ["leftover.jpg"],
    reason: "STOCKOUT",
  }, dependencies());
  assert.equal(result.bCodeResolution.ready, true);
  assert.deepEqual(
    result.reconciliation.proposedActions.invoiceDeletionCandidates[0].shoplingOrderNos,
    ["3493809"],
  );
  assert.deepEqual(
    result.reconciliation.proposedActions.stockoutCandidates.map((row) => row.bCode),
    ["BAF3-2"],
  );
  assert.deepEqual(result.executionGate, {
    readyForOperatorReview: true,
    externalWritesAllowed: false,
    invoiceDeletionEnabled: false,
    stockoutMutationEnabled: false,
  });
  assert.equal(result.actionPlan.invoiceDeletionSteps[0].channel, "SHOPLING_B12_UI");
  assert.equal(result.actionPlan.gates.marketplaceInvoiceTransmissionEnabled, false);
});

test("unresolved B-code blocks stockout but keeps the invoice candidate visible", async () => {
  const result = await createShoplingUnshippedReview({
    localConfig: {},
    apiConfig: {},
    imagePaths: ["leftover.jpg"],
    reason: "STOCKOUT",
  }, dependencies({
    readIdentitySources: async () => ({
      orderRows: [{ ord_no: "3493809", prod_id: "116501", opt_id: "282" }],
      productRows: [],
    }),
  }));
  assert.equal(result.bCodeResolution.ready, false);
  assert.equal(result.reconciliation.proposedActions.invoiceDeletionCandidates.length, 1);
  assert.equal(result.reconciliation.proposedActions.stockoutCandidates.length, 0);
  assert.ok(result.reconciliation.blockedActions.some((row) => row.code === "STOCKOUT_BCODE_UNRESOLVED"));
});

test("review rejects an empty photo set before reading Shopling", async () => {
  let captured = false;
  await assert.rejects(() => createShoplingUnshippedReview({
    localConfig: {},
    apiConfig: {},
    imagePaths: [],
  }, dependencies({ captureManifest: async () => { captured = true; } })), { code: "LABEL_IMAGES_REQUIRED" });
  assert.equal(captured, false);
});
