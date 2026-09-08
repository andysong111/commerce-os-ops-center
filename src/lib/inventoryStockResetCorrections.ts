import { createHash } from "node:crypto";
import type { InventoryStockControlReport } from "@/lib/inventoryStockControl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_STOCKOUT_RESET_SUPERSEDE_OPERATION_TYPE =
  "INVENTORY_STOCKOUT_RESET_SUPERSEDE_EVENT";

const READ_LIMIT = 1_000;

type StoredCorrectionRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

type ResetSupersedeEvent = {
  eventId: string;
  supersededResetEventId: string;
  supersededBarcode: string;
  canonicalBarcode: string | null;
  modelNo: string | null;
  occurredAt: string;
  reason: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedBarcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function snapshot(row: StoredCorrectionRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function correctionFrom(row: StoredCorrectionRow): ResetSupersedeEvent | null {
  const source = snapshot(row);
  const eventId = text(source.eventId) || text(row.source_event_id);
  const supersededResetEventId = text(source.supersededResetEventId);
  const supersededBarcode = normalizedBarcode(source.supersededBarcode);
  const canonicalBarcode = normalizedBarcode(source.canonicalBarcode) || null;
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!eventId || !supersededResetEventId || !supersededBarcode || !occurredAt) {
    return null;
  }
  return {
    eventId,
    supersededResetEventId,
    supersededBarcode,
    canonicalBarcode,
    modelNo: text(source.modelNo) || null,
    occurredAt,
    reason: text(source.reason).slice(0, 500),
  };
}

function blockedReport(
  report: InventoryStockControlReport,
  blocker: string,
): InventoryStockControlReport {
  return {
    ...report,
    state: "BLOCKED",
    message:
      "재고 기준점 정정 원장을 확인하지 못해 잘못된 기준점이 다시 실행되는 것을 방지하기 위해 Shopling 실행을 차단했습니다.",
    blockers: [...new Set([...report.blockers, blocker])],
  };
}

export function applyInventoryStockResetCorrections(
  report: InventoryStockControlReport,
  corrections: ResetSupersedeEvent[],
): InventoryStockControlReport {
  if (!corrections.length) return report;

  const latestByResetEventId = new Map<string, ResetSupersedeEvent>();
  for (const correction of corrections) {
    const previous = latestByResetEventId.get(correction.supersededResetEventId);
    if (
      !previous ||
      Date.parse(correction.occurredAt) >= Date.parse(previous.occurredAt)
    ) {
      latestByResetEventId.set(correction.supersededResetEventId, correction);
    }
  }

  const removed = report.rows.filter((row) => {
    const correction = latestByResetEventId.get(row.resetEventId);
    if (!correction) return false;
    return normalizedBarcode(row.barcode) === correction.supersededBarcode;
  });
  if (!removed.length) return report;

  const removedIds = new Set(removed.map((row) => row.resetEventId));
  const rows = report.rows.filter((row) => !removedIds.has(row.resetEventId));
  const applied = removed
    .map((row) => latestByResetEventId.get(row.resetEventId))
    .filter((value): value is ResetSupersedeEvent => Boolean(value))
    .sort((left, right) => left.supersededResetEventId.localeCompare(right.supersededResetEventId));
  const fingerprint = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        baseFingerprint: report.fingerprint,
        supersededResetEventIds: applied.map((row) => row.supersededResetEventId),
        rows: rows.map((row) => [
          row.barcode,
          row.resetEventId,
          row.desiredStatus,
          row.exactInventoryQuantity,
          row.latestSyncOutcome,
        ]),
      }),
    )
    .digest("hex")}`;

  return {
    ...report,
    message: `${report.message} 잘못 입력된 재고 0 기준점 ${removed.length}건은 append-only 정정 원장에 따라 실행 대상에서 제외했습니다.`,
    fingerprint,
    resetCount: rows.length,
    exactCount: rows.filter((row) => row.salesCoverageReady).length,
    soldOutCount: rows.filter((row) => row.desiredStatus === "SOLD_OUT").length,
    onSaleCount: rows.filter((row) => row.desiredStatus === "ON_SALE").length,
    pendingSyncCount: rows.filter((row) => row.syncNeeded && !row.syncBlocked).length,
    uncertainSyncCount: rows.filter(
      (row) => row.latestSyncOutcome === "UNCERTAIN",
    ).length,
    rows,
  };
}

export async function overlayInventoryStockControlReportWithResetCorrections(
  report: InventoryStockControlReport,
): Promise<InventoryStockControlReport> {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return blockedReport(report, "RESET_CORRECTION_LEDGER_ADMIN_NOT_CONFIGURED");
  }
  const response = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", INVENTORY_STOCKOUT_RESET_SUPERSEDE_OPERATION_TYPE)
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (response.error) {
    return blockedReport(
      report,
      `RESET_CORRECTION_LEDGER_READ_FAILED:${response.error.message}`,
    );
  }
  const corrections = (Array.isArray(response.data) ? response.data : [])
    .map((row) => correctionFrom(row as StoredCorrectionRow))
    .filter((value): value is ResetSupersedeEvent => Boolean(value));
  return applyInventoryStockResetCorrections(report, corrections);
}
