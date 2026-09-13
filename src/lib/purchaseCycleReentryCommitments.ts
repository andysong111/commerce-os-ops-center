import { buildChinaOrderLedgerSummary, CHINA_ORDER_EVENT_OPERATION_TYPE, normalizeChinaOrderCommitmentEvent } from "@/lib/chinaOrderLedger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const REENTRY_IDENTITY_RECONCILIATION_OPERATION_TYPE =
  "CHINA_ORDER_IDENTITY_RECONCILIATION_EVENT";

const PAGE_SIZE = 500;
const MAX_ROWS = 5_000;
const OWNER_CONFIRMATION_METHOD = "OWNER_EXPLICIT_CONFIRMATION";
const UNASSIGNED_BARCODE_PATTERN = /^UNASSIGNED-[A-Z0-9._:-]+$/;
const MANAGED_BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
type StoredRow = {
  operation_type?: string;
  source_event_id: string;
  input_snapshot: Record<string, unknown>;
  started_at: string;
};
type IdentityReconciliation = { fromBarcode: string; toBarcode: string };

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, "");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizedStoredEvent(row: StoredRow) {
  const value = row.input_snapshot;
  return normalizeChinaOrderCommitmentEvent({
    ...value,
    sourceSystem: text(value.sourceSystem), sourceLineId: text(value.sourceLineId),
    sourceEventId: text(value.sourceEventId || row.source_event_id), barcode: normalizeBarcode(value.barcode),
    status: value.status as Parameters<typeof normalizeChinaOrderCommitmentEvent>[0]["status"],
    occurredAt: text(value.occurredAt || row.started_at),
  });
}

function hasIdentityReconciliationMarker(value: Record<string, unknown>) {
  const payload = record(value.payload);
  return Boolean(payload && "identityReconciliation" in payload);
}

function parseIdentityReconciliationRow(row: StoredRow, now: number) {
  const value = record(row?.input_snapshot);
  if (!row?.source_event_id || !value) throw new Error("REENTRY_COMMITMENT_ROW_INVALID");
  if (row.operation_type !== REENTRY_IDENTITY_RECONCILIATION_OPERATION_TYPE) {
    throw new Error("REENTRY_COMMITMENT_RECONCILIATION_OPERATION_INVALID");
  }
  const payload = record(value.payload);
  const marker = record(payload?.identityReconciliation);
  if (!payload || !marker) throw new Error("REENTRY_COMMITMENT_RECONCILIATION_INVALID");

  // Identity corrections are deliberately not lifecycle events. Reject any field
  // that could alter committed/open/received/cancelled/manual-added quantities.
  for (const key of ["status", "requestedQuantity", "orderedQuantity", "receivedQuantity", "cancelledQuantity"]) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_FORBIDDEN");
    }
  }
  if (payload.manualAddition !== undefined || payload.addedQuantity !== undefined) {
    throw new Error("REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_FORBIDDEN");
  }

  const sourceSystem = text(value.sourceSystem);
  const sourceLineId = text(value.sourceLineId);
  const sourceEventId = text(value.sourceEventId || row.source_event_id);
  const toBarcode = normalizeBarcode(value.barcode);
  const occurredAt = text(value.occurredAt || row.started_at);
  const occurredAtMs = Date.parse(occurredAt);
  const fromBarcode = normalizeBarcode(marker.fromBarcode);
  const markerToBarcode = normalizeBarcode(marker.toBarcode);
  const confirmedAt = text(marker.confirmedAt);
  const confirmedAtMs = Date.parse(confirmedAt);
  if (!sourceSystem || !sourceLineId || !sourceEventId || !MANAGED_BARCODE_PATTERN.test(toBarcode) ||
      !Number.isFinite(occurredAtMs) || occurredAtMs > now + 30_000 ||
      marker.confirmed !== true || text(marker.confirmationMethod) !== OWNER_CONFIRMATION_METHOD ||
      !UNASSIGNED_BARCODE_PATTERN.test(fromBarcode) || fromBarcode === toBarcode ||
      markerToBarcode !== toBarcode || !Number.isFinite(confirmedAtMs) || confirmedAtMs > now + 30_000) {
    throw new Error("REENTRY_COMMITMENT_RECONCILIATION_INVALID");
  }
  return { sourceSystem, sourceLineId, sourceEventId, fromBarcode, toBarcode };
}

// Historical commitment rows are immutable. Reconciliation records live under a
// separate operation type and are consumed only as identity evidence. They never
// enter the commitment reducer, so they cannot change lifecycle quantities/status.
function applyIdentityReconciliations(rows: StoredRow[], now: number) {
  const mappings = new Map<string, IdentityReconciliation>();
  const reconciliationEventIds = new Set<string>();
  for (const row of rows) {
    const value = record(row?.input_snapshot);
    if (!row?.source_event_id || !value) throw new Error("REENTRY_COMMITMENT_ROW_INVALID");
    const isReconciliation = row.operation_type === REENTRY_IDENTITY_RECONCILIATION_OPERATION_TYPE;
    const hasMarker = hasIdentityReconciliationMarker(value);
    if (!isReconciliation && hasMarker) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_OPERATION_INVALID");
    }
    if (!isReconciliation) continue;
    const correction = parseIdentityReconciliationRow(row, now);
    if (reconciliationEventIds.has(correction.sourceEventId)) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_EVENT_COLLISION");
    }
    reconciliationEventIds.add(correction.sourceEventId);
    const key = `${correction.sourceSystem}\u0000${correction.sourceLineId}`;
    const previous = mappings.get(key);
    if (previous && (previous.fromBarcode !== correction.fromBarcode || previous.toBarcode !== correction.toBarcode)) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_CONFLICT");
    }
    mappings.set(key, { fromBarcode: correction.fromBarcode, toBarcode: correction.toBarcode });
  }

  return rows
    .filter((row) => row.operation_type !== REENTRY_IDENTITY_RECONCILIATION_OPERATION_TYPE)
    .map((row) => {
      const value = row.input_snapshot;
      const key = `${text(value.sourceSystem)}\u0000${text(value.sourceLineId)}`;
      const mapping = mappings.get(key);
      if (!mapping || normalizeBarcode(value.barcode) !== mapping.fromBarcode) return row;
      return { ...row, input_snapshot: { ...value, barcode: mapping.toBarcode } };
    });
}

// Unlike a bounded newest-N lookup, ordering decisions must prove completeness.
// A missing/changed count, partial page or malformed event is not "zero on order".
export function validateReentryCommitmentRows(rows: StoredRow[], now = Date.now()) {
  const reconciledRows = applyIdentityReconciliations(rows, now);
  const seen = new Map<string, string>();
  for (const row of reconciledRows) {
    const value = row?.input_snapshot;
    if (!row?.source_event_id || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("REENTRY_COMMITMENT_ROW_INVALID");
    for (const key of ["requestedQuantity", "orderedQuantity", "receivedQuantity", "cancelledQuantity"]) {
      const amount = value[key];
      if (amount !== null && amount !== undefined && (!Number.isSafeInteger(amount) || Number(amount) < 0)) throw new Error("REENTRY_COMMITMENT_QUANTITY_INVALID");
    }
    let normalized: ReturnType<typeof normalizeChinaOrderCommitmentEvent>;
    try { normalized = normalizedStoredEvent(row); } catch (error) {
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
  const summary = buildChinaOrderLedgerSummary(reconciledRows);
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
      .select("operation_type,source_event_id,input_snapshot,started_at", { count: "exact" })
      .in("operation_type", [CHINA_ORDER_EVENT_OPERATION_TYPE, REENTRY_IDENTITY_RECONCILIATION_OPERATION_TYPE])
      .eq("status", "SUCCEEDED")
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