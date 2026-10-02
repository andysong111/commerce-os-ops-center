import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const CHINA_ORDER_EVENT_OPERATION_TYPE =
  "CHINA_ORDER_COMMITMENT_EVENT";

const ACTIVE_STATUSES = new Set([
  "RESERVED",
  "EXPORTED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
]);
const STATUS_RANK: Record<string, number> = {
  RESERVED: 1,
  EXPORTED: 2,
  ORDERED: 3,
  PARTIALLY_RECEIVED: 4,
  RECEIVED: 5,
};
const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ChinaOrderCommitmentStatus =
  | "RESERVED"
  | "EXPORTED"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED"
  | "FAILED";

export type ChinaOrderCommitmentEventInput = {
  sourceSystem: string;
  sourceLineId: string;
  sourceRunId?: string | null;
  sourceEventId: string;
  barcode: string;
  status: ChinaOrderCommitmentStatus;
  requestedQuantity?: number;
  orderedQuantity?: number;
  receivedQuantity?: number;
  cancelledQuantity?: number;
  occurredAt?: string;
  note?: string;
  payload?: unknown;
};

export type NormalizedChinaOrderCommitmentEvent = {
  sourceSystem: string;
  sourceLineId: string;
  sourceRunId: string | null;
  sourceEventId: string;
  barcode: string;
  status: ChinaOrderCommitmentStatus;
  requestedQuantity: number | null;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  cancelledQuantity: number | null;
  occurredAt: string;
  note: string;
  payload: unknown;
};

export type ChinaOrderCommitmentSnapshot = {
  id: string;
  sourceSystem: string;
  sourceLineId: string;
  sourceRunId: string | null;
  barcode: string;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  cancelledQuantity: number;
  committedQuantity: number;
  openQuantity: number;
  manualAddedQuantity: number;
  recommendationOpenQuantity: number;
  status: ChinaOrderCommitmentStatus;
  reservedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  note: string;
  eventCount: number;
  staleEventCount: number;
  latestPayload: unknown;
};

export type ChinaOrderLedgerSummary = {
  commitments: ChinaOrderCommitmentSnapshot[];
  totalCommitments: number;
  activeCommitments: number;
  totalRequestedQuantity: number;
  totalOrderedQuantity: number;
  totalReceivedQuantity: number;
  totalCancelledQuantity: number;
  totalOpenQuantity: number;
  duplicateEventCount: number;
  invalidEventCount: number;
};

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function optionalQuantity(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("CHINA_ORDER_QUANTITY_INVALID");
  }
  return Math.round(parsed);
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function manualAddedQuantityFromEvent(event: NormalizedChinaOrderCommitmentEvent) {
  const payload = payloadObject(event.payload);
  if (payload.manualAddition !== true) return 0;
  const parsed = Number(payload.addedQuantity);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function validStatus(value: unknown): value is ChinaOrderCommitmentStatus {
  return [
    "RESERVED",
    "EXPORTED",
    "ORDERED",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "CANCELLED",
    "FAILED",
  ].includes(String(value));
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeChinaOrderCommitmentEvent(
  input: ChinaOrderCommitmentEventInput,
  now = new Date(),
): NormalizedChinaOrderCommitmentEvent {
  const sourceSystem = text(input.sourceSystem);
  const sourceLineId = text(input.sourceLineId);
  const sourceEventId = text(input.sourceEventId);
  const barcode = normalizeBarcode(input.barcode);
  if (!sourceSystem || !sourceLineId || !sourceEventId) {
    throw new Error("CHINA_ORDER_EVENT_IDENTITY_REQUIRED");
  }
  if (!BARCODE_PATTERN.test(barcode)) {
    throw new Error(`CHINA_ORDER_BARCODE_INVALID:${barcode}`);
  }
  if (!validStatus(input.status)) {
    throw new Error("CHINA_ORDER_STATUS_INVALID");
  }
  const occurredAt = input.occurredAt
    ? validIso(input.occurredAt)
    : now.toISOString();
  if (!occurredAt) throw new Error("CHINA_ORDER_OCCURRED_AT_INVALID");

  return {
    sourceSystem,
    sourceLineId,
    sourceRunId: text(input.sourceRunId) || null,
    sourceEventId,
    barcode,
    status: input.status,
    requestedQuantity: optionalQuantity(input.requestedQuantity),
    orderedQuantity: optionalQuantity(input.orderedQuantity),
    receivedQuantity: optionalQuantity(input.receivedQuantity),
    cancelledQuantity: optionalQuantity(input.cancelledQuantity),
    occurredAt,
    note: text(input.note).slice(0, 500),
    payload: input.payload ?? null,
  };
}

function commitmentId(event: NormalizedChinaOrderCommitmentEvent) {
  return `commitment:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`;
}

function chooseStatus(
  current: ChinaOrderCommitmentStatus,
  next: ChinaOrderCommitmentStatus,
) {
  if (current === "RECEIVED") return "RECEIVED" as const;
  if (next === "CANCELLED" || next === "FAILED") return next;
  if (current === "CANCELLED" || current === "FAILED") return next;
  return (STATUS_RANK[next] ?? 0) >= (STATUS_RANK[current] ?? 0)
    ? next
    : current;
}

function openQuantity(
  status: ChinaOrderCommitmentStatus,
  committed: number,
  received: number,
  cancelled: number,
) {
  if (!ACTIVE_STATUSES.has(status)) return 0;
  return Math.max(0, committed - received - cancelled);
}

export function reduceChinaOrderCommitmentEvents(
  values: NormalizedChinaOrderCommitmentEvent[],
): ChinaOrderCommitmentSnapshot {
  if (!values.length) throw new Error("CHINA_ORDER_EVENTS_REQUIRED");
  const events = [...values].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.sourceEventId.localeCompare(right.sourceEventId),
  );
  const first = events[0];
  let status: ChinaOrderCommitmentStatus = "RESERVED";
  let requestedQuantity = 0;
  let orderedQuantity = 0;
  let receivedQuantity = 0;
  let cancelledQuantity = 0;
  let manualAddedQuantity = 0;
  let sourceRunId = first.sourceRunId;
  let reservedAt: string | null = null;
  let orderedAt: string | null = null;
  let receivedAt: string | null = null;
  let cancelledAt: string | null = null;
  let updatedAt = first.occurredAt;
  let note = "";
  let latestPayload: unknown = payloadObject(first.payload);
  let eventCount = 0;
  let staleEventCount = 0;

  for (const event of events) {
    if (
      event.sourceSystem !== first.sourceSystem ||
      event.sourceLineId !== first.sourceLineId ||
      event.barcode !== first.barcode
    ) {
      throw new Error("CHINA_ORDER_EVENT_IDENTITY_CONFLICT");
    }
    eventCount += 1;
    if (Date.parse(event.occurredAt) < Date.parse(updatedAt)) {
      staleEventCount += 1;
      continue;
    }

    manualAddedQuantity += manualAddedQuantityFromEvent(event);
    sourceRunId = event.sourceRunId ?? sourceRunId;
    requestedQuantity = Math.max(
      requestedQuantity,
      event.requestedQuantity ?? requestedQuantity,
    );
    orderedQuantity = Math.max(
      orderedQuantity,
      event.orderedQuantity ?? orderedQuantity,
    );
    const committedQuantity = Math.max(requestedQuantity, orderedQuantity);

    if (event.receivedQuantity !== null) {
      receivedQuantity = Math.max(receivedQuantity, event.receivedQuantity);
    }
    if (event.cancelledQuantity !== null) {
      cancelledQuantity = Math.max(cancelledQuantity, event.cancelledQuantity);
    }
    if (event.status === "RECEIVED" && event.receivedQuantity === null) {
      receivedQuantity = Math.max(
        receivedQuantity,
        committedQuantity - cancelledQuantity,
      );
    }
    if (
      (event.status === "CANCELLED" || event.status === "FAILED") &&
      event.cancelledQuantity === null
    ) {
      cancelledQuantity = Math.max(
        cancelledQuantity,
        committedQuantity - receivedQuantity,
      );
    }

    receivedQuantity = Math.min(committedQuantity, receivedQuantity);
    cancelledQuantity = Math.min(
      Math.max(0, committedQuantity - receivedQuantity),
      cancelledQuantity,
    );
    status = chooseStatus(status, event.status);
    reservedAt ??= event.occurredAt;
    if (orderedQuantity > 0 || event.status === "ORDERED") {
      orderedAt ??= event.occurredAt;
    }
    if (receivedQuantity > 0) receivedAt = event.occurredAt;
    if (cancelledQuantity > 0 || ["CANCELLED", "FAILED"].includes(status)) {
      cancelledAt = event.occurredAt;
    }
    updatedAt = event.occurredAt;
    note = event.note || note;
    latestPayload = {
      ...payloadObject(latestPayload),
      ...payloadObject(event.payload),
    };
  }

  const committedQuantity = Math.max(requestedQuantity, orderedQuantity);
  const totalOpenQuantity = openQuantity(
    status,
    committedQuantity,
    receivedQuantity,
    cancelledQuantity,
  );
  const recommendationOpenQuantity = Math.max(
    0,
    totalOpenQuantity - manualAddedQuantity,
  );
  return {
    id: commitmentId(first),
    sourceSystem: first.sourceSystem,
    sourceLineId: first.sourceLineId,
    sourceRunId,
    barcode: first.barcode,
    requestedQuantity,
    orderedQuantity,
    receivedQuantity,
    cancelledQuantity,
    committedQuantity,
    openQuantity: totalOpenQuantity,
    manualAddedQuantity,
    recommendationOpenQuantity,
    status,
    reservedAt,
    orderedAt,
    receivedAt,
    cancelledAt,
    updatedAt,
    note,
    eventCount,
    staleEventCount,
    latestPayload,
  };
}

function eventFromOperation(row: StoredOperationRow) {
  const snapshot =
    row.input_snapshot &&
    typeof row.input_snapshot === "object" &&
    !Array.isArray(row.input_snapshot)
      ? (row.input_snapshot as Record<string, unknown>)
      : null;
  if (!snapshot) return null;
  try {
    return normalizeChinaOrderCommitmentEvent({
      sourceSystem: text(snapshot.sourceSystem),
      sourceLineId: text(snapshot.sourceLineId),
      sourceRunId: text(snapshot.sourceRunId) || null,
      sourceEventId:
        text(snapshot.sourceEventId) || text(row.source_event_id),
      barcode: text(snapshot.barcode),
      status: snapshot.status as ChinaOrderCommitmentStatus,
      requestedQuantity: snapshot.requestedQuantity as number | undefined,
      orderedQuantity: snapshot.orderedQuantity as number | undefined,
      receivedQuantity: snapshot.receivedQuantity as number | undefined,
      cancelledQuantity: snapshot.cancelledQuantity as number | undefined,
      occurredAt:
        text(snapshot.occurredAt) || text(row.started_at) || undefined,
      note: text(snapshot.note),
      payload: snapshot.payload,
    });
  } catch {
    return null;
  }
}

export function buildChinaOrderLedgerSummary(
  rows: StoredOperationRow[],
): ChinaOrderLedgerSummary {
  const seenEvents = new Set<string>();
  const groups = new Map<string, NormalizedChinaOrderCommitmentEvent[]>();
  let duplicateEventCount = 0;
  let invalidEventCount = 0;

  for (const row of rows) {
    const event = eventFromOperation(row);
    if (!event) {
      invalidEventCount += 1;
      continue;
    }
    if (seenEvents.has(event.sourceEventId)) {
      duplicateEventCount += 1;
      continue;
    }
    seenEvents.add(event.sourceEventId);
    const key = `${event.sourceSystem}\u0000${event.sourceLineId}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const commitments = [...groups.values()]
    .map(reduceChinaOrderCommitmentEvents)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.barcode.localeCompare(right.barcode),
    );

  return {
    commitments,
    totalCommitments: commitments.length,
    activeCommitments: commitments.filter((row) => row.openQuantity > 0).length,
    totalRequestedQuantity: commitments.reduce(
      (total, row) => total + row.requestedQuantity,
      0,
    ),
    totalOrderedQuantity: commitments.reduce(
      (total, row) => total + row.orderedQuantity,
      0,
    ),
    totalReceivedQuantity: commitments.reduce(
      (total, row) => total + row.receivedQuantity,
      0,
    ),
    totalCancelledQuantity: commitments.reduce(
      (total, row) => total + row.cancelledQuantity,
      0,
    ),
    totalOpenQuantity: commitments.reduce(
      (total, row) => total + row.openQuantity,
      0,
    ),
    duplicateEventCount,
    invalidEventCount,
  };
}

export async function loadChinaOrderLedger() {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      ...buildChinaOrderLedgerSummary([]),
      error: "Ops Center 운영 원장 연결이 설정되지 않았습니다.",
    };
  }
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,started_at")
    .eq("operation_type", CHINA_ORDER_EVENT_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(5000);
  if (result.error) {
    return {
      ...buildChinaOrderLedgerSummary([]),
      error: result.error.message,
    };
  }
  return {
    ...buildChinaOrderLedgerSummary(
      (Array.isArray(result.data) ? result.data : []).filter(
        (row): row is StoredOperationRow => Boolean(row && typeof row === "object"),
      ),
    ),
    error: null,
  };
}

export function safeReplacementDraftCommitments(
  commitments: ChinaOrderCommitmentSnapshot[],
  draftId: string,
) {
  const rows = commitments.filter(
    (row) =>
      row.sourceSystem === "fast-purchase-mvp" &&
      row.sourceRunId === draftId &&
      row.openQuantity > 0,
  );
  if (!rows.length) {
    throw new Error("PURCHASE_REPLACEMENT_DRAFT_NOT_ACTIVE");
  }
  const unsafe = rows.find(
    (row) =>
      row.status !== "RESERVED" ||
      row.orderedQuantity > 0 ||
      row.receivedQuantity > 0,
  );
  if (unsafe) {
    throw new Error(
      `PURCHASE_REPLACEMENT_DRAFT_ALREADY_PROGRESSING:${unsafe.barcode}`,
    );
  }

  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(
      row.barcode,
      (result.get(row.barcode) ?? 0) + row.recommendationOpenQuantity,
    );
  }
  return result;
}

export function recommendationCommitmentsByBarcode(
  commitments: ChinaOrderCommitmentSnapshot[],
  exclusions: ReadonlyMap<string, number> = new Map(),
) {
  const result = new Map<string, number>();
  for (const row of commitments) {
    if (row.recommendationOpenQuantity <= 0) continue;
    result.set(
      row.barcode,
      (result.get(row.barcode) ?? 0) + row.recommendationOpenQuantity,
    );
  }
  for (const [barcode, excludedQuantity] of exclusions) {
    const remaining = Math.max(
      0,
      (result.get(barcode) ?? 0) - Math.max(0, excludedQuantity),
    );
    if (remaining > 0) result.set(barcode, remaining);
    else result.delete(barcode);
  }
  return result;
}

export async function openChinaOrderCommitmentsByBarcode() {
  const ledger = await loadChinaOrderLedger();
  return {
    commitments: recommendationCommitmentsByBarcode(ledger.commitments),
    error: ledger.error,
  };
}

function seoulCalendarMonth(value: string) {
  return new Date(Date.parse(value) + SEOUL_OFFSET_MS).toISOString().slice(0, 7);
}

export function chinaOrderCommitmentCycleMonth(
  row: Pick<
    ChinaOrderCommitmentSnapshot,
    "latestPayload" | "reservedAt" | "updatedAt"
  >,
) {
  const explicitCycleMonth = text(payloadObject(row.latestPayload).cycleMonth);
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(explicitCycleMonth)
    ? explicitCycleMonth
    : seoulCalendarMonth(row.reservedAt || row.updatedAt);
}

export type ChinaOrderReceiptCoverage = {
  quantity: number;
  latestReceivedAt: string | null;
};

export function completedChinaOrderReceiptsByBarcodeForMonth(
  commitments: ChinaOrderCommitmentSnapshot[],
  orderMonth: string,
) {
  const result = new Map<string, ChinaOrderReceiptCoverage>();
  for (const row of commitments) {
    if (
      row.status !== "RECEIVED" ||
      row.receivedQuantity <= 0 ||
      chinaOrderCommitmentCycleMonth(row) !== orderMonth
    ) {
      continue;
    }
    const current = result.get(row.barcode) ?? {
      quantity: 0,
      latestReceivedAt: null,
    };
    result.set(row.barcode, {
      quantity: current.quantity + row.receivedQuantity,
      latestReceivedAt:
        !current.latestReceivedAt ||
        (row.receivedAt &&
          Date.parse(row.receivedAt) > Date.parse(current.latestReceivedAt))
          ? row.receivedAt
          : current.latestReceivedAt,
    });
  }
  return result;
}

export async function completedChinaOrderReceiptsByBarcode(orderMonth: string) {
  const ledger = await loadChinaOrderLedger();
  return {
    receipts: completedChinaOrderReceiptsByBarcodeForMonth(
      ledger.commitments,
      orderMonth,
    ),
    error: ledger.error,
  };
}
