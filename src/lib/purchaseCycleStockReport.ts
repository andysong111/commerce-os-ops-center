import { loadInventoryStockControlReport } from "@/lib/inventoryStockControl";
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

async function resolved() {
  // Natural accumulation is safe only when both baseline authorities were read
  // completely. Product Master uses its strict reader, while local OPS reset /
  // stocktake rows are preflighted so a malformed SUCCEEDED row cannot silently
  // disappear and masquerade as "no baseline yet".
  const [, supplementalResetEvents] = await Promise.all([
    assertPurchaseCycleLocalBaselineAuthorityReadable(),
    loadRequiredProductMasterVerifiedZeroResetEvents(),
  ]);
  const localSeeded = await overlayInventoryStockControlReportWithStocktakeBaselines(
    await loadInventoryStockControlReport({ supplementalResetEvents }),
  );
  const tailed = await overlayInventoryStockControlReportWithTail(localSeeded);
  const corrected = await overlayInventoryStockControlReportWithResetCorrections(tailed);
  return normalizeRetryableShoplingSyncReportWithEvidence(
    await overlayInventoryStockControlReportWithStocktakeBaselines(corrected),
  );
}

export async function loadPurchaseCycleStockReport(options: { refreshSales?: boolean } = {}) {
  let report = await resolved();
  // Only explicit calculation/refresh POSTs opt in. The monthly status GET does
  // not append Tail events, queue jobs, alter inventory or send Shopling status.
  if (options.refreshSales === true && report.state === "READY" && report.rows.length) {
    const refresh = await ensureExactInventoryStockSalesTailCoverage(report);
    if (refresh.refreshed) report = await resolved();
  }
  const [tails, canonical] = await Promise.all([
    loadLatestInventoryStockSalesTailSnapshots(),
    loadStage8CanonicalSalesEventSnapshot(),
  ]);
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
