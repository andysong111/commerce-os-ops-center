import type { ProductMasterInventoryCostRow } from "./productMasterInventoryCostReadiness.ts";
import type { InventoryStockEstimateBaselineEvent } from "./inventoryStockEstimateBaselines.ts";
import type { InventoryStocktakeBaselineEvent } from "./inventoryStocktakeBaselines.ts";
import type { InventoryStockBand } from "./inventoryStockBulkInput.ts";

export type ProductMasterInventoryEstimateOverlayRow =
  ProductMasterInventoryCostRow & {
    operatorStockBand?: InventoryStockBand | null;
  };

export type OperatorInventoryEstimateInput = Pick<
  InventoryStockEstimateBaselineEvent,
  "estimatedQuantity" | "stockBand" | "occurredAt"
>;

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyOperatorInventoryEstimate(
  row: ProductMasterInventoryCostRow,
  estimate: OperatorInventoryEstimateInput | undefined,
  latestExactStocktake?: InventoryStocktakeBaselineEvent,
): ProductMasterInventoryEstimateOverlayRow {
  if (!estimate) return row;
  const estimateAt = timestamp(estimate.occurredAt);
  if (!estimateAt) return row;
  // A numeric spot estimate describes a quantity at one point in time, so a
  // later exact stocktake or stock movement makes that number stale. A rough
  // stock band is a persistent operator planning classification
  // (many/normal/low/out), not a counted quantity. Keep the band until the
  // operator changes it; otherwise the UI keeps showing the saved green band
  // while the calculation engine silently ignores it.
  if (
    estimate.estimatedQuantity !== null &&
    timestamp(latestExactStocktake?.occurredAt) >= estimateAt
  ) return row;
  if (
    estimate.estimatedQuantity !== null &&
    timestamp(row.lastMovementAt) > estimateAt
  ) return row;
  return {
    ...row,
    inventoryQuantity:
      estimate.estimatedQuantity === null
        ? row.inventoryQuantity
        : estimate.estimatedQuantity,
    operatorStockBand: estimate.stockBand,
    inventoryVerification: "OPERATOR_ESTIMATE",
    inventoryVerified: false,
    inventoryConfidence: "APPROXIMATE",
    inventoryRequiresReview: false,
    inventoryBaselineKind: "OPERATOR_ESTIMATE",
    initialZeroUnverified: false,
  };
}

/**
 * The stock-band event is persisted before recalculation. Passing the same
 * event into the calculation also makes the current click deterministic when
 * the ledger read replica has not exposed the new row yet.
 */
export function currentOperatorInventoryEstimate(
  persisted: OperatorInventoryEstimateInput | undefined,
  stockBand: InventoryStockBand | undefined,
  occurredAt: string | null | undefined,
): OperatorInventoryEstimateInput | undefined {
  if (!stockBand || !timestamp(occurredAt)) return persisted;
  const normalizedOccurredAt = String(occurredAt);
  return {
    estimatedQuantity: null,
    stockBand,
    occurredAt: normalizedOccurredAt,
  };
}

export function estimatedInventoryForStockBand(
  demandTarget: number,
  stockBand: InventoryStockBand | null | undefined,
) {
  const target = Math.max(0, Math.round(Number(demandTarget) || 0));
  if (stockBand === "HIGH") return target;
  if (stockBand === "NORMAL") return Math.floor(target * 0.5);
  if (stockBand === "LOW") return Math.floor(target * 0.25);
  if (stockBand === "OUT") return 0;
  return null;
}
