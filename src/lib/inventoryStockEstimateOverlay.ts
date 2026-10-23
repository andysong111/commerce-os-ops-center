import type { ProductMasterInventoryCostRow } from "./productMasterInventoryCostReadiness.ts";
import type { InventoryStockEstimateBaselineEvent } from "./inventoryStockEstimateBaselines.ts";
import type { InventoryStocktakeBaselineEvent } from "./inventoryStocktakeBaselines.ts";

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyOperatorInventoryEstimate(
  row: ProductMasterInventoryCostRow,
  estimate: InventoryStockEstimateBaselineEvent | undefined,
  latestExactStocktake?: InventoryStocktakeBaselineEvent,
) {
  if (!estimate) return row;
  const estimateAt = timestamp(estimate.occurredAt);
  if (!estimateAt) return row;
  if (timestamp(latestExactStocktake?.occurredAt) >= estimateAt) return row;
  if (timestamp(row.lastMovementAt) > estimateAt) return row;
  return {
    ...row,
    inventoryQuantity: estimate.estimatedQuantity,
    inventoryVerification: "OPERATOR_ESTIMATE",
    inventoryVerified: false,
    inventoryConfidence: "APPROXIMATE",
    inventoryRequiresReview: false,
    inventoryBaselineKind: "OPERATOR_ESTIMATE",
    initialZeroUnverified: false,
  };
}
