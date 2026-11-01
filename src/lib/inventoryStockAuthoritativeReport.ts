import {
  loadInventoryStockControlReport,
  type InventoryStockControlReport,
} from "@/lib/inventoryStockControl";
import { overlayInventoryStockControlReportWithResetCorrections } from "@/lib/inventoryStockResetCorrections";
import { overlayInventoryStockControlReportWithManualOnSale } from "@/lib/inventoryManualOnSale";
import { overlayInventoryStockControlReportWithTail } from "@/lib/inventoryStockSalesTail";
import { ensureExactInventoryStockSalesTailCoverage } from "@/lib/inventoryStockSalesTailCoverage";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
import { overlayInventoryStockControlReportWithStocktakeBaselines } from "@/lib/inventoryStocktakeBaselines";
import { loadProductMasterVerifiedZeroResetEvents } from "@/lib/productMasterVerifiedInventoryBaselines";

async function loadCorrectedReport(): Promise<InventoryStockControlReport> {
  const supplementalResetEvents =
    await loadProductMasterVerifiedZeroResetEvents();
  const seeded = await overlayInventoryStockControlReportWithStocktakeBaselines(
    await loadInventoryStockControlReport({ supplementalResetEvents }),
  );
  const tailed = await overlayInventoryStockControlReportWithTail(seeded);
  const corrected =
    await overlayInventoryStockControlReportWithResetCorrections(tailed);
  return overlayInventoryStockControlReportWithStocktakeBaselines(corrected);
}

export async function loadAuthoritativeInventoryStockReport({
  refreshTail = false,
}: {
  refreshTail?: boolean;
} = {}) {
  let report = await loadCorrectedReport();
  let tailSalesRefresh: Awaited<
    ReturnType<typeof ensureExactInventoryStockSalesTailCoverage>
  > | null = null;

  if (refreshTail) {
    tailSalesRefresh = await ensureExactInventoryStockSalesTailCoverage(report);
    if (tailSalesRefresh.refreshed) report = await loadCorrectedReport();
  }

  const normalized =
    await normalizeRetryableShoplingSyncReportWithEvidence(report);
  const withManualOnSale =
    await overlayInventoryStockControlReportWithManualOnSale(normalized);
  return {
    report:
      await normalizeRetryableShoplingSyncReportWithEvidence(withManualOnSale),
    tailSalesRefresh,
  };
}
