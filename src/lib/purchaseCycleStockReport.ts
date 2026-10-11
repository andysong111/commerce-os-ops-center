import { loadInventoryStockControlReport } from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { overlayInventoryStockControlReportWithResetCorrections } from "@/lib/inventoryStockResetCorrections";
import { overlayInventoryStockControlReportWithTail, loadLatestInventoryStockSalesTailSnapshots } from "@/lib/inventoryStockSalesTail";
import { ensureExactInventoryStockSalesTailCoverage } from "@/lib/inventoryStockSalesTailCoverage";
import { overlayInventoryStockControlReportWithStocktakeBaselines } from "@/lib/inventoryStocktakeBaselines";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
import { assertPurchaseCycleLocalBaselineAuthorityReadable } from "@/lib/purchaseCycleLocalBaselineAuthority";
import { loadRequiredProductMasterVerifiedZeroResetEvents } from "@/lib/productMasterVerifiedInventoryBaselines";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import {
  PURCHASE_CYCLE_MAX_SALES_EVIDENCE_AGE_MS,
  validatePurchaseCycleStockEvidence,
} from "@/lib/purchaseCycleStockEvidence";
import { ensureProductMasterShoplingSalesEventCoverageRequest } from "@/lib/productMasterShoplingSalesEventSync";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";

type PurchaseCycleStockReadSource =
  | "local-baseline-authority"
  | "product-planning"
  | "canonical-sales"
  | "product-master-zero-reset"
  | "inventory-stock-control"
  | "stocktake-baseline"
  | "sales-tail"
  | "reset-corrections"
  | "stock-sync-resolution"
  | "latest-sales-tail";

class PurchaseCycleStockReadError extends Error {
  constructor(source: PurchaseCycleStockReadSource, cause: unknown) {
    super(`PURCHASE_CYCLE_STOCK_READ_FAILED:${source}`, { cause });
    this.name = "PurchaseCycleStockReadError";
  }
}

async function stockRead<T>(
  source: PurchaseCycleStockReadSource,
  pending: Promise<T>,
) {
  try {
    return await pending;
  } catch (error) {
    throw new PurchaseCycleStockReadError(source, error);
  }
}

async function resolved() {
  // Natural accumulation is safe only when both baseline authorities were read
  // completely. Product Master uses its strict reader, while local OPS reset /
  // stocktake rows are preflighted so a malformed SUCCEEDED row cannot silently
  // disappear and masquerade as "no baseline yet".
  const [, planning, canonical] = await Promise.all([
    stockRead(
      "local-baseline-authority",
      assertPurchaseCycleLocalBaselineAuthorityReadable(),
    ),
    stockRead("product-planning", loadProductPlanningSnapshot()),
    stockRead("canonical-sales", loadStage8CanonicalSalesEventSnapshot()),
  ]);
  const supplementalResetEvents = await stockRead(
    "product-master-zero-reset",
    loadRequiredProductMasterVerifiedZeroResetEvents(
      planning.products ?? [],
    ),
  );
  const inventory = await stockRead(
    "inventory-stock-control",
    loadInventoryStockControlReport({
      supplementalResetEvents,
      planning,
      canonicalSales: canonical,
    }),
  );
  const localSeeded = await stockRead(
    "stocktake-baseline",
    overlayInventoryStockControlReportWithStocktakeBaselines(inventory),
  );
  const tailed = await stockRead(
    "sales-tail",
    overlayInventoryStockControlReportWithTail(localSeeded),
  );
  const corrected = await stockRead(
    "reset-corrections",
    overlayInventoryStockControlReportWithResetCorrections(tailed),
  );
  const reseeded = await stockRead(
    "stocktake-baseline",
    overlayInventoryStockControlReportWithStocktakeBaselines(corrected),
  );
  return {
    report: await stockRead(
      "stock-sync-resolution",
      normalizeRetryableShoplingSyncReportWithEvidence(reseeded),
    ),
    canonical,
  };
}

export async function loadPurchaseCycleStockReport(options: { refreshSales?: boolean } = {}) {
  let { report, canonical } = await resolved();
  // Only explicit calculation/refresh POSTs opt in. The monthly status GET does
  // not append Tail events, queue jobs, alter inventory or send Shopling status.
  if (options.refreshSales === true && report.state === "READY" && report.rows.length) {
    const refresh = await ensureExactInventoryStockSalesTailCoverage(report);
    if (refresh.refreshed) ({ report, canonical } = await resolved());
  }
  const tails = await stockRead(
    "latest-sales-tail",
    loadLatestInventoryStockSalesTailSnapshots(),
  );
  const validated = validatePurchaseCycleStockEvidence(
    report,
    tails,
    canonical.state === "READY_READ_ONLY" ? canonical : undefined,
  );
  if (options.refreshSales === true) {
    const oldestInvalidResetAt = validated.rows
      .filter((row) => !row.salesCoverageReady)
      .map((row) => row.resetAt)
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    if (oldestInvalidResetAt) {
      const canonicalRefresh =
        await ensureProductMasterShoplingSalesEventCoverageRequest(
          oldestInvalidResetAt,
          { maxAgeMs: PURCHASE_CYCLE_MAX_SALES_EVIDENCE_AGE_MS },
        );
      if (
        canonicalRefresh.accepted ||
        canonicalRefresh.alreadyActive
      ) {
        await wakeOpsDispatchTask(
          "product-master-shopling-sales-events",
          0,
        ).catch(() => false);
      }
    }
  }
  return validated;
}
