import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadPurchaseCycleStockReport } from "@/lib/purchaseCycleStockReport";
import { loadPurchaseCycleReentryCommitments } from "@/lib/purchaseCycleReentryCommitments";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { loadPurchaseForecastFeedback } from "@/lib/purchaseRecommendationFinalization";
import { buildPurchaseCycleReentryShadow, reentryShadowMonths, validateReentryTargetMonth, type ReentryShadowReport } from "@/lib/purchaseCycleReentryShadowCore";

// Single-flight only, no completed-result cache: a source timestamp becoming
// stale must not be hidden by a freshly rendered/cached READY response.
const inFlight = new Map<string, Promise<ReentryShadowReport>>();

async function calculate(target: string): Promise<ReentryShadowReport> {
  const readStartedAt = new Date().toISOString();
  const sourceErrors: string[] = [], warnings: string[] = [];
  async function required<T>(key: string, load: () => Promise<T>): Promise<T | null> {
    try { return await load(); } catch (error) {
      const knownCode = error instanceof Error && /^REENTRY_COMMITMENT_[A-Z_]+$/.test(error.message) ? error.message : key;
      sourceErrors.push(knownCode); return null;
    }
  }
  const [planning, audit, stock, ledger, diagnostics, feedback] = await Promise.all([
    required("PLANNING_READ_FAILED", loadProductPlanningSnapshot),
    required("DEMAND_READ_FAILED", loadProductMasterCanonicalSalesAudit),
    // Never opt into Tail writes or enqueue a sales job from this read endpoint.
    required("STOCK_READ_FAILED", () => loadPurchaseCycleStockReport({ refreshSales: false })),
    required("COMMITMENTS_READ_FAILED", loadPurchaseCycleReentryCommitments),
    loadProvisionalInventoryDiagnostics().catch(() => { warnings.push("추정재고 참고 자료를 읽지 못했습니다. 정확재고를 추정값으로 바꾸지 않습니다."); return null; }),
    (async () => {
      try {
        const events = await loadStage8CanonicalSalesEventSnapshot();
        if (events.state !== "READY_READ_ONLY") throw new Error("SALES_NOT_READY");
        return await loadPurchaseForecastFeedback(events.events);
      } catch {
        warnings.push("과거 발주 보정 자료를 읽지 못해 보정 배수 1로 사전 점검합니다. 확정안은 변경하지 않습니다.");
        return null;
      }
    })(),
  ]);
  return buildPurchaseCycleReentryShadow({
    now: new Date().toISOString(), targetCycleMonth: target, readStartedAt,
    planning, audit, stock, ledger, diagnostics, feedback,
    sourceErrors: sourceErrors.sort(), warnings: warnings.sort(),
  });
}
export async function loadPurchaseCycleReentryShadow(targetMonth?: string) {
  const now = new Date().toISOString();
  const target = validateReentryTargetMonth(targetMonth ?? reentryShadowMonths(now).next, now);
  const existing = inFlight.get(target);
  if (existing) return existing;
  const pending = calculate(target);
  inFlight.set(target, pending);
  try { return await pending; }
  finally { if (inFlight.get(target) === pending) inFlight.delete(target); }
}
