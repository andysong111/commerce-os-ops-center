import assert from "node:assert/strict";
import test from "node:test";
import { applyOperatorInventoryEstimate } from "../src/lib/inventoryStockEstimateOverlay.ts";

function inventory(overrides = {}) {
  return {
    skuId: "sku-1", barcode: "BCB2-1", inventoryQuantity: 100,
    inventoryVerification: "VERIFIED", inventoryVerified: true,
    inventoryConfidence: "HIGH", inventoryRequiresReview: false,
    inventoryBaselineKind: "STOCKTAKE", initialZeroUnverified: false,
    movementCount: 1, inboundMovementCount: 1, lastMovementAt: "2026-10-01T00:00:00.000Z",
    receiptCostCount: 1, purchaseCostEvidenceCount: 1,
    latestCostKrw: 100, protectedCostKrw: 100,
    ...overrides,
  };
}

test("operator estimate overrides older inventory but remains provisional", () => {
  const estimate = {
    eventId: "estimate-1", barcode: "BCB2-1", productKind: "OPTION",
    modelNo: null, estimatedQuantity: 23, occurredAt: "2026-10-23T00:00:00.000Z", note: "",
  };
  const result = applyOperatorInventoryEstimate(inventory(), estimate);
  assert.equal(result.inventoryQuantity, 23);
  assert.equal(result.inventoryVerified, false);
  assert.equal(result.inventoryVerification, "OPERATOR_ESTIMATE");
  assert.equal(result.inventoryBaselineKind, "OPERATOR_ESTIMATE");
});

test("newer exact stocktake or movement wins over an older estimate", () => {
  const estimate = {
    eventId: "estimate-1", barcode: "BCB2-1", productKind: "OPTION",
    modelNo: null, estimatedQuantity: 23, occurredAt: "2026-10-20T00:00:00.000Z", note: "",
  };
  const newerMovement = inventory({ lastMovementAt: "2026-10-21T00:00:00.000Z" });
  assert.equal(applyOperatorInventoryEstimate(newerMovement, estimate).inventoryQuantity, 100);
  const exact = { eventId: "exact-1", barcode: "BCB2-1", productKind: "OPTION", modelNo: null, baselineQuantity: 90, occurredAt: "2026-10-22T00:00:00.000Z", note: "" };
  assert.equal(applyOperatorInventoryEstimate(inventory(), estimate, exact).inventoryQuantity, 100);
});
