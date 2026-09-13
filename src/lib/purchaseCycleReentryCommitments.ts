import { buildChinaOrderLedgerSummary, CHINA_ORDER_EVENT_OPERATION_TYPE, normalizeChinaOrderCommitmentEvent } from "@/lib/chinaOrderLedger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 500;
const MAX_ROWS = 5_000;
type StoredRow = { source_event_id: string; input_snapshot: Record<string, unknown>; started_at: string };

// Unlike a bounded newest-N lookup, ordering decisions must prove completeness.
// A missing/changed count, partial page or malformed event is not "zero on order".
export function validateReentryCommitmentRows(rows: StoredRow[], now = Date.now()) {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = row?.input_snapshot;
    if (!row?.source_event_id || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("REENTRY_COMMITMENT_ROW_INVALID");
    for (const key of ["requestedQuantity", "orderedQuantity", "receivedQuantity", "cancelledQuantity"]) {
      const amount = value[key];
      if (amount !== null && amount !== undefined && (!Number.isSafeInteger(amount) || Number(amount) < 0)) throw new Error("REENTRY_COMMITMENT_QUANTITY_INVALID");
    }
    let normalized: ReturnType<typeof normalizeChinaOrderCommitmentEvent>;
    try { normalized = normalizeChinaOrderCommitmentEvent({
      ...value,
      sourceSystem: String(value.sourceSystem ?? ""), sourceLineId: String(value.sourceLineId ?? ""),
      sourceEventId: String(value.sourceEventId || row.source_event_id), barcode: String(value.barcode ?? ""),
      status: value.status as Parameters<typeof normalizeChinaOrderCommitmentEvent>[0]["status"],
      occurredAt: String(value.occurredAt || row.started_at),
    }); } catch (error) {
      // A real unassigned order is a business identity hold, not a transient
      // network failure. Never omit it or turn its open quantity into zero.
      const cause = error instanceof Error ? error.message : "";
      if (cause.startsWith("CHINA_ORDER_BARCODE_INVALID:")) throw new Error("REENTRY_COMMITMENT_BARCODE_UNRESOLVED");
      if (cause === "CHINA_ORDER_EVENT_IDENTITY_REQUIRED") throw new Error("REENTRY_COMMITMENT_IDENTITY_REQUIRED");
      if (cause === "CHINA_ORDER_STATUS_INVALID") throw new Error("REENTRY_COMMITMENT_STATUS_INVALID");
      if (cause === "CHINA_ORDER_OCCURRED_AT_INVALID") throw new Error("REENTRY_COMMITMENT_TIME_INVALID");
      throw new Error("REENTRY_COMMITMENT_EVENT_INVALID");
    }
    if (Date.parse(normalized.occurredAt) > now + 30_000) throw new Error("REENTRY_COMMITMENT_FUTURE_EVENT");
    const signature = JSON.stringify(normalized);
    const previous = seen.get(normalized.sourceEventId);
    if (previous && previous !== signature) throw new Error("REENTRY_COMMITMENT_EVENT_COLLISION");
    seen.set(normalized.sourceEventId, signature);
  }
  const summary = buildChinaOrderLedgerSummary(rows);
  if (summary.invalidEventCount > 0) throw new Error("REENTRY_COMMITMENT_INVALID_EVENTS");
  return summary;
}

export async function loadPurchaseCycleReentryCommitments() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("REENTRY_COMMITMENT_STORAGE_UNAVAILABLE");
  const rows: StoredRow[] = [];
  const pageIds = new Set<string>();
  let expected: number | null = null;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await admin.from("commerce_operation_runs")
      .select("source_event_id,input_snapshot,started_at", { count: "exact" })
      .eq("operation_type", CHINA_ORDER_EVENT_OPERATION_TYPE).eq("status", "SUCCEEDED")
      .order("source_event_id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || Number(result.count) < 0) throw new Error("REENTRY_COMMITMENT_READ_UNVERIFIED");
    if (Number(result.count) > MAX_ROWS) throw new Error("REENTRY_COMMITMENT_READ_LIMIT");
    expected ??= Number(result.count);
    if (result.count !== expected) throw new Error("REENTRY_COMMITMENT_CHANGED_DURING_READ");
    const page = result.data as StoredRow[];
    if (page.length !== Math.min(PAGE_SIZE, expected - offset)) throw new Error("REENTRY_COMMITMENT_PARTIAL_PAGE");
    for (const row of page) {
      if (!row?.source_event_id || pageIds.has(row.source_event_id)) throw new Error("REENTRY_COMMITMENT_PAGE_DRIFT");
      pageIds.add(row.source_event_id);
    }
    rows.push(...page);
    if (rows.length === expected) return validateReentryCommitmentRows(rows);
  }
  throw new Error("REENTRY_COMMITMENT_READ_LIMIT");
}
