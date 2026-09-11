import { createHash } from "node:crypto";
import type { InventoryStockControlReport } from "./inventoryStockControl";

export type PurchaseCycleCoverage = { coverageStartAt: string | null; coverageEndAt: string | null };
export type PurchaseCycleTailCoverage = PurchaseCycleCoverage & { barcode: string; resetAt: string; resetEventId: string };
const MAX_AGE_MS = 10 * 60_000;
function covers(coverage: PurchaseCycleCoverage | undefined, baseline: string, now: number) {
  const start = Date.parse(coverage?.coverageStartAt ?? "");
  const end = Date.parse(coverage?.coverageEndAt ?? "");
  const at = Date.parse(baseline);
  return Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(at) &&
    at <= now && start <= at && end >= at && end <= now + 30_000 && now - end <= MAX_AGE_MS;
}
// A newly rendered report is not evidence that its sales source is current.
export function validatePurchaseCycleStockEvidence(
  report: InventoryStockControlReport,
  tails: Map<string, PurchaseCycleTailCoverage>,
  canonical: PurchaseCycleCoverage | undefined,
  now = Date.now(),
): InventoryStockControlReport {
  const counts = new Map<string, number>();
  for (const row of report.rows) counts.set(row.barcode, (counts.get(row.barcode) ?? 0) + 1);
  const rows = report.rows.map((row) => {
    const tail = tails.get(row.resetEventId);
    const tailReady = tail?.barcode === row.barcode && tail.resetEventId === row.resetEventId &&
      Date.parse(tail.resetAt) === Date.parse(row.resetAt) && covers(tail, row.resetAt, now);
    const valid = report.state === "READY" && counts.get(row.barcode) === 1 &&
      Number.isSafeInteger(row.exactInventoryQuantity) && row.exactInventoryQuantity >= 0 &&
      row.salesCoverageReady === true && (tailReady || covers(canonical, row.resetAt, now));
    return valid ? row : { ...row, salesCoverageReady: false, syncBlocked: true,
      syncBlockReason: "최신 재고 기준점 이후 판매범위를 확인하지 못해 발주·판매상태 판단을 보류합니다." };
  });
  const invalid = rows.filter((row) => !row.salesCoverageReady);
  const blockers = [...report.blockers, ...invalid.map((row) => `PURCHASE_STOCK_EVIDENCE_REQUIRED:${row.barcode}`)];
  if (report.state !== "READY" && !blockers.length) blockers.push("PURCHASE_STOCK_REPORT_BLOCKED");
  return {
    ...report,
    state: report.state === "READY" && invalid.length === 0 ? "READY" : "BLOCKED",
    message: invalid.length ? "최신 판매범위 또는 재고 기준점이 확인되지 않아 발주 계산을 보류했습니다." : report.message,
    rows, exactCount: rows.filter((row) => row.salesCoverageReady).length,
    soldOutCount: rows.filter((row) => row.salesCoverageReady && row.desiredStatus === "SOLD_OUT").length,
    onSaleCount: rows.filter((row) => row.salesCoverageReady && row.desiredStatus === "ON_SALE").length,
    pendingSyncCount: rows.filter((row) => row.salesCoverageReady && row.syncNeeded && !row.syncBlocked).length,
    blockers: [...new Set(blockers)],
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify({ source: report.fingerprint, rows: rows.map((row) => [row.barcode, row.resetEventId, row.exactInventoryQuantity, row.salesCoverageReady]) })).digest("hex")}`,
  };
}
