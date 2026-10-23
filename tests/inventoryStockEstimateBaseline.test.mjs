import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperatorInventoryEstimate,
  estimatedInventoryForStockBand,
} from "../src/lib/inventoryStockEstimateOverlay.ts";
import { calculateNetRequirement } from "../src/lib/productDecisionEngine/netRequirement.ts";

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
    modelNo: null, estimatedQuantity: 23, stockBand: null, occurredAt: "2026-10-23T00:00:00.000Z", note: "",
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
    modelNo: null, estimatedQuantity: 23, stockBand: null, occurredAt: "2026-10-20T00:00:00.000Z", note: "",
  };
  const newerMovement = inventory({ lastMovementAt: "2026-10-21T00:00:00.000Z" });
  assert.equal(applyOperatorInventoryEstimate(newerMovement, estimate).inventoryQuantity, 100);
  const exact = { eventId: "exact-1", barcode: "BCB2-1", productKind: "OPTION", modelNo: null, baselineQuantity: 90, occurredAt: "2026-10-22T00:00:00.000Z", note: "" };
  assert.equal(applyOperatorInventoryEstimate(inventory(), estimate, exact).inventoryQuantity, 100);
});

test("재고 네 단계는 상품별 수요목표 비율로만 환산한다", () => {
  assert.equal(estimatedInventoryForStockBand(100, "HIGH"), 100);
  assert.equal(estimatedInventoryForStockBand(100, "NORMAL"), 50);
  assert.equal(estimatedInventoryForStockBand(100, "LOW"), 25);
  assert.equal(estimatedInventoryForStockBand(100, "OUT"), 0);
  assert.equal(estimatedInventoryForStockBand(100, null), null);
});

test("상태 입력은 기존 재고를 정확값처럼 덮지 않고 상태를 보존한다", () => {
  const estimate = {
    eventId: "estimate-band-1", barcode: "BCB2-1", productKind: "OPTION",
    modelNo: null, estimatedQuantity: null, stockBand: "LOW", occurredAt: "2026-10-23T00:00:00.000Z", note: "",
  };
  const result = applyOperatorInventoryEstimate(inventory(), estimate);
  assert.equal(result.inventoryQuantity, 100);
  assert.equal(result.operatorStockBand, "LOW");
  assert.equal(result.inventoryBaselineKind, "OPERATOR_ESTIMATE");
});

test("같은 100개 목표에서 상태별 발주량이 0·50·75·100개로 계산된다", () => {
  const recommended = (stockBand) => calculateNetRequirement({
    demandTarget: 100,
    originalGroup: "발주 추천",
    inventoryKnown: true,
    availableQuantity: estimatedInventoryForStockBand(100, stockBand),
    moq: 1,
    cartonQuantity: 1,
  }).recommendedQuantity;
  assert.equal(recommended("HIGH"), 0);
  assert.equal(recommended("NORMAL"), 50);
  assert.equal(recommended("LOW"), 75);
  assert.equal(recommended("OUT"), 100);
});
