import { buildChinaOrderLedgerSummary, CHINA_ORDER_EVENT_OPERATION_TYPE, normalizeChinaOrderCommitmentEvent } from "@/lib/chinaOrderLedger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 500;
const MAX_ROWS = 5_000;
const OWNER_CONFIRMATION_METHOD = "OWNER_EXPLICIT_CONFIRMATION";
const UNASSIGNED_BARCODE_PATTERN = /^UNASSIGNED-[A-Z0-9._:-]+$/;
type StoredRow = { source_event_id: string; input_snapshot: Record<string, unknown>; started_at: string };
type IdentityReconciliation = { fromBarcode: string; toBarcode: string };
type ReconciliationEvidence = {
  sourceEventId: string;
  sourceSystem: string;
  sourceLineId: string;
  fromBarcode: string;
  toBarcode: string;
  normalized: ReturnType<typeof normalizeChinaOrderCommitmentEvent>;
};

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

function markerFromRow(row: StoredRow) {
  const value = record(row?.input_snapshot);
  if (!row?.source_event_id || !value) throw new Error("REENTRY_COMMITMENT_ROW_INVALID");
  const payload = record(value.payload);
  if (!payload || !("identityReconciliation" in payload)) return null;
  const marker = record(payload.identityReconciliation);
  if (!marker) throw new Error("REENTRY_COMMITMENT_RECONCILIATION_INVALID");
  return { value, payload, marker };
}

// Historical order rows remain immutable. A correction is appended as a later,
// valid commitment event on the same source line. It may provide identity evidence
// only: its lifecycle snapshot must exactly mirror the already-recorded lifecycle,
// so it cannot change ordered/open/received/cancelled/manual-added quantities.
function applyIdentityReconciliations(rows: StoredRow[], now: number) {
  const mappings = new Map<string, IdentityReconciliation>();
  const evidence: ReconciliationEvidence[] = [];
  const markerIds = new Set<string>();

  for (const row of rows) {
    const found = markerFromRow(row);
    if (!found) continue;
    let correction: ReturnType<typeof normalizeChinaOrderCommitmentEvent>;
    try { correction = normalizedStoredEvent(row); }
    catch { throw new Error("REENTRY_COMMITMENT_RECONCILIATION_INVALID"); }

    if (found.payload.manualAddition !== undefined || found.payload.addedQuantity !== undefined) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_FORBIDDEN");
    }
    const fromBarcode = normalizeBarcode(found.marker.fromBarcode);
    const toBarcode = normalizeBarcode(found.marker.toBarcode);
    const confirmedAt = text(found.marker.confirmedAt);
    const confirmedAtMs = Date.parse(confirmedAt);
    if (found.marker.confirmed !== true || text(found.marker.confirmationMethod) !== OWNER_CONFIRMATION_METHOD ||
        !UNASSIGNED_BARCODE_PATTERN.test(fromBarcode) || fromBarcode === toBarcode ||
        toBarcode !== normalizeBarcode(correction.barcode) || !Number.isFinite(confirmedAtMs) ||
        confirmedAtMs > now + 30_000 || Date.parse(correction.occurredAt) > now + 30_000) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_INVALID");
    }

    const key = `${correction.sourceSystem}\u0000${correction.sourceLineId}`;
    const previous = mappings.get(key);
    if (previous && (previous.fromBarcode !== fromBarcode || previous.toBarcode !== toBarcode)) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_CONFLICT");
    }
    mappings.set(key, { fromBarcode, toBarcode });
    markerIds.add(row.source_event_id);
    evidence.push({
      sourceEventId: correction.sourceEventId,
      sourceSystem: correction.sourceSystem,
      sourceLineId: correction.sourceLineId,
      fromBarcode,
      toBarcode,
      normalized: correction,
    });
  }
  if (!mappings.size) return rows;

  const reconciledRows = rows.map((row) => {
    if (markerIds.has(row.source_event_id)) return row;
    const value = row.input_snapshot;
    const key = `${text(value.sourceSystem)}\u0000${text(value.sourceLineId)}`;
    const mapping = mappings.get(key);
    if (!mapping || normalizeBarcode(value.barcode) !== mapping.fromBarcode) return row;
    return { ...row, input_snapshot: { ...value, barcode: mapping.toBarcode } };
  });

  for (const correction of evidence) {
    const rawSourceMatches = rows.filter((row) => {
      if (markerIds.has(row.source_event_id)) return false;
      const value = row.input_snapshot;
      return text(value.sourceSystem) === correction.sourceSystem &&
        text(value.sourceLineId) === correction.sourceLineId &&
        normalizeBarcode(value.barcode) === correction.fromBarcode;
    });
    if (!rawSourceMatches.length) throw new Error("REENTRY_COMMITMENT_RECONCILIATION_SOURCE_MISSING");

    const baseRows = reconciledRows.filter((row) => {
      if (markerIds.has(row.source_event_id)) return false;
      const value = row.input_snapshot;
      return text(value.sourceSystem) === correction.sourceSystem && text(value.sourceLineId) === correction.sourceLineId;
    });
    const base = buildChinaOrderLedgerSummary(baseRows);
    if (base.invalidEventCount > 0 || base.commitments.length !== 1) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_BASE_INVALID");
    }
    const latestBaseOccurredAt = Math.max(...baseRows.map((row) => Date.parse(text(row.input_snapshot.occurredAt || row.started_at))));
    const markerOccurredAt = Date.parse(correction.normalized.occurredAt);
    if (!Number.isFinite(latestBaseOccurredAt) || !Number.isFinite(markerOccurredAt) || markerOccurredAt <= latestBaseOccurredAt) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_STALE");
    }
    const lifecycle = base.commitments[0];
    const event = correction.normalized;
    if (lifecycle.barcode !== correction.toBarcode || event.status !== lifecycle.status ||
        event.requestedQuantity !== lifecycle.requestedQuantity ||
        event.orderedQuantity !== lifecycle.orderedQuantity ||
        event.receivedQuantity !== lifecycle.receivedQuantity ||
        event.cancelledQuantity !== lifecycle.cancelledQuantity ||
        (event.sourceRunId !== null && event.sourceRunId !== lifecycle.sourceRunId)) {
      throw new Error("REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_MISMATCH");
    }
  }
  return reconciledRows;
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