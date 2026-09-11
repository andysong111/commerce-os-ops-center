import { loadInventoryStockControlReport } from "@/lib/inventoryStockControl";
import { overlayInventoryStockControlReportWithResetCorrections } from "@/lib/inventoryStockResetCorrections";
import { overlayInventoryStockControlReportWithTail, loadLatestInventoryStockSalesTailSnapshots } from "@/lib/inventoryStockSalesTail";
import { ensureExactInventoryStockSalesTailCoverage } from "@/lib/inventoryStockSalesTailCoverage";
import { overlayInventoryStockControlReportWithStocktakeBaselines } from "@/lib/inventoryStocktakeBaselines";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { validatePurchaseCycleStockEvidence } from "@/lib/purchaseCycleStockEvidence";

async function resolved() {
  const seeded = await overlayInventoryStockControlReportWithStocktakeBaselines(await loadInventoryStockControlReport());
  const tailed = await overlayInventoryStockControlReportWithTail(seeded);
  const corrected = await overlayInventoryStockControlReportWithResetCorrections(tailed);
  return normalizeRetryableShoplingSyncReportWithEvidence(await overlayInventoryStockControlReportWithStocktakeBaselines(corrected));
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
  return validatePurchaseCycleStockEvidence(report, tails, canonical.state === "READY_READ_ONLY" ? canonical : undefined);
}
