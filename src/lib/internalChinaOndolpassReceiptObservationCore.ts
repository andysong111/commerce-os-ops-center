import { createHash } from "node:crypto";
import type { InternalChinaFreightBarcodeReceiptEvidence } from "./internalChinaFreightBarcodeCompletionCore.ts";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const EVIDENCE_HASH = /^sha256:[a-f0-9]{64}$/;
const SNAPSHOT_HASH = /^sha256:[a-f0-9]{64}$/;

export type OndolpassReceiptRowStatus =
  | "RECEIVED"
  | "PENDING"
  | "DISPOSED";

export type OndolpassReceiptObservationInput = {
  draftId?: unknown;
  evidenceHash?: unknown;
  observedAt?: unknown;
  applications?: unknown;
};

export type OndolpassReceiptObservationRow = {
  applicationNo: string;
  rowNo: number;
  sourceItemId: string;
  barcode: string;
  orderNo: string;
  itemName: string;
  expectedQuantity: number;
  displayedQuantity: number;
  status: OndolpassReceiptRowStatus;
  quantityMatches: boolean;
  orderNoMatches: boolean;
  eligible: boolean;
  receivedQuantity: number;
};

export type OndolpassReceiptObservationBarcode = {
  barcode: string;
  expectedQuantity: number;
  observedReceivedQuantity: number;
  rowCount: number;
  receivedRowCount: number;
  pendingRowCount: number;
  disposedRowCount: number;
  mismatchCount: number;
};

export type InternalChinaOndolpassReceiptObservation = {
  draftId: string;
  cycleMonth: string;
  historyRecordId: string;
  evidenceHash: string;
  observedAt: string;
  snapshotHash: string;
  rowCount: number;
  receivedRowCount: number;
  pendingRowCount: number;
  disposedRowCount: number;
  mismatchCount: number;
  expectedQuantity: number;
  displayedQuantity: number;
  observedReceivedQuantity: number;
  complete: boolean;
  issues: string[];
  rows: OndolpassReceiptObservationRow[];
  byBarcode: OndolpassReceiptObservationBarcode[];
};

export type InternalChinaOndolpassReceiptObservationRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
    .join(",")}}`;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(stableJson(value), "utf8")
    .digest("hex")}`;
}

export function buildOndolpassReceiptSourceEventId(
  observation: InternalChinaOndolpassReceiptObservation,
  previous: InternalChinaOndolpassReceiptObservation | null,
) {
  // A corrected quantity can later return to an earlier value. Deduplicate
  // retries of this transition without reusing that earlier stored event.
  const eventHash = previous
    ? hash({
        snapshotHash: observation.snapshotHash,
        previousSnapshotHash: previous.snapshotHash,
        previousObservedAt: previous.observedAt,
      })
    : observation.snapshotHash;
  return `ondolpass-receipt:${observation.draftId}:${eventHash.slice("sha256:".length)}`;
}

function sourceKey(applicationNo: string, rowNo: number) {
  return `${applicationNo}:${rowNo}`;
}

function status(value: unknown): OndolpassReceiptRowStatus | "" {
  const normalized = text(value).toUpperCase();
  return normalized === "RECEIVED" ||
    normalized === "PENDING" ||
    normalized === "DISPOSED"
    ? normalized
    : "";
}

export function buildInternalChinaOndolpassReceiptObservation(
  input: OndolpassReceiptObservationInput,
  evidence: InternalChinaFreightBarcodeReceiptEvidence,
  previous: InternalChinaOndolpassReceiptObservation | null = null,
): InternalChinaOndolpassReceiptObservation {
  const draftId = text(input.draftId);
  const evidenceHash = text(input.evidenceHash);
  const observedAt = iso(input.observedAt);
  if (!DRAFT_ID.test(draftId) || draftId !== evidence.draftId) {
    throw new Error("ONDOLPASS_RECEIPT_DRAFT_INVALID");
  }
  if (!EVIDENCE_HASH.test(evidenceHash) || evidenceHash !== evidence.evidenceHash) {
    throw new Error("ONDOLPASS_RECEIPT_EVIDENCE_CONFLICT");
  }
  if (!observedAt) throw new Error("ONDOLPASS_RECEIPT_OBSERVED_AT_INVALID");
  if (!Array.isArray(input.applications) || input.applications.length <= 0) {
    throw new Error("ONDOLPASS_RECEIPT_APPLICATIONS_REQUIRED");
  }

  const expectedByKey = new Map(
    evidence.lines.map((line) => [
      sourceKey(line.applicationNo, line.rowNo),
      line,
    ] as const),
  );
  if (expectedByKey.size !== evidence.lines.length) {
    throw new Error("ONDOLPASS_RECEIPT_EVIDENCE_SOURCE_IDENTITY_INVALID");
  }

  const observedByKey = new Map<
    string,
    {
      applicationNo: string;
      applicationState: string;
      rowNo: number;
      displayedQuantity: number;
      status: OndolpassReceiptRowStatus;
      orderNo: string;
      itemName: string;
    }
  >();
  const seenApplications = new Set<string>();
  for (const applicationValue of input.applications) {
    const application = object(applicationValue);
    const applicationNo = text(application.applicationNo);
    const applicationState = text(application.state).slice(0, 80);
    const rows = application.rows;
    if (!/^\d+$/.test(applicationNo) || seenApplications.has(applicationNo)) {
      throw new Error("ONDOLPASS_RECEIPT_APPLICATION_IDENTITY_INVALID");
    }
    if (!Array.isArray(rows) || rows.length <= 0) {
      throw new Error("ONDOLPASS_RECEIPT_ROWS_REQUIRED");
    }
    seenApplications.add(applicationNo);
    for (const rowValue of rows) {
      const row = object(rowValue);
      const rowNo = positiveInteger(row.rowNo);
      const displayedQuantity = positiveInteger(row.quantity);
      const rowStatus = status(row.status);
      const key = sourceKey(applicationNo, rowNo);
      if (
        rowNo <= 0 ||
        displayedQuantity <= 0 ||
        !rowStatus ||
        observedByKey.has(key)
      ) {
        throw new Error("ONDOLPASS_RECEIPT_ROW_INVALID");
      }
      observedByKey.set(key, {
        applicationNo,
        applicationState,
        rowNo,
        displayedQuantity,
        status: rowStatus,
        orderNo: text(row.orderNo),
        itemName: text(row.itemName).slice(0, 300),
      });
    }
  }
  if (observedByKey.size !== expectedByKey.size) {
    throw new Error("ONDOLPASS_RECEIPT_ROW_SET_MISMATCH");
  }
  for (const key of observedByKey.keys()) {
    if (!expectedByKey.has(key)) {
      throw new Error("ONDOLPASS_RECEIPT_ROW_SET_MISMATCH");
    }
  }

  const issues: string[] = [];
  const rows: OndolpassReceiptObservationRow[] = [];
  for (const [key, expected] of expectedByKey) {
    const observed = observedByKey.get(key);
    if (!observed) throw new Error("ONDOLPASS_RECEIPT_ROW_SET_MISMATCH");
    const quantityMatches = expected.quantity === observed.displayedQuantity;
    const quantityWithinExpected =
      observed.displayedQuantity > 0 &&
      observed.displayedQuantity <= expected.quantity;
    const orderNoMatches =
      !expected.orderNo ||
      expected.orderNo === observed.orderNo;
    if (!quantityWithinExpected) {
      issues.push(
        `QUANTITY_MISMATCH:${key}:${expected.quantity}:${observed.displayedQuantity}`,
      );
    }
    if (!orderNoMatches) {
      issues.push(`ORDER_NO_MISMATCH:${key}`);
    }
    if (observed.status === "DISPOSED") issues.push(`DISPOSED:${key}`);
    const eligible = quantityWithinExpected && orderNoMatches;
    rows.push({
      applicationNo: observed.applicationNo,
      rowNo: observed.rowNo,
      sourceItemId: expected.sourceItemId,
      barcode: expected.barcode,
      orderNo: observed.orderNo,
      itemName: observed.itemName,
      expectedQuantity: expected.quantity,
      displayedQuantity: observed.displayedQuantity,
      status: observed.status,
      quantityMatches,
      orderNoMatches,
      eligible,
      receivedQuantity:
        eligible && observed.status === "RECEIVED"
          ? observed.displayedQuantity
          : 0,
    });
  }
  rows.sort(
    (left, right) =>
      left.applicationNo.localeCompare(right.applicationNo) ||
      left.rowNo - right.rowNo,
  );

  if (previous) {
    if (
      previous.draftId !== draftId ||
      previous.evidenceHash !== evidenceHash
    ) {
      throw new Error("ONDOLPASS_RECEIPT_PREVIOUS_EVIDENCE_CONFLICT");
    }
    const currentByKey = new Map(
      rows.map((row) => [sourceKey(row.applicationNo, row.rowNo), row] as const),
    );
    for (const oldRow of previous.rows) {
      if (oldRow.status !== "RECEIVED" || !oldRow.eligible) continue;
      const current = currentByKey.get(
        sourceKey(oldRow.applicationNo, oldRow.rowNo),
      );
      if (
        !current ||
        !current.eligible ||
        current.orderNo !== oldRow.orderNo ||
        current.status === "DISPOSED" ||
        (current.status === "PENDING" &&
          current.displayedQuantity !== oldRow.receivedQuantity)
      ) {
        throw new Error("ONDOLPASS_RECEIPT_STATUS_REGRESSION");
      }
      if (current.status === "PENDING") {
        // 표식만 사라지고 동일 행의 수량·주문번호가 유지되면
        // 이전에 확인한 입고수량을 유지한다.
        current.status = "RECEIVED";
        current.receivedQuantity = oldRow.receivedQuantity;
      }
    }
  }

  const byBarcodeMap = new Map<string, OndolpassReceiptObservationBarcode>();
  for (const row of rows) {
    const current = byBarcodeMap.get(row.barcode) ?? {
      barcode: row.barcode,
      expectedQuantity: 0,
      observedReceivedQuantity: 0,
      rowCount: 0,
      receivedRowCount: 0,
      pendingRowCount: 0,
      disposedRowCount: 0,
      mismatchCount: 0,
    };
    current.expectedQuantity += row.expectedQuantity;
    current.observedReceivedQuantity += row.receivedQuantity;
    current.rowCount += 1;
    current.receivedRowCount += Number(row.status === "RECEIVED" && row.eligible);
    current.pendingRowCount += Number(row.status === "PENDING");
    current.disposedRowCount += Number(row.status === "DISPOSED");
    current.mismatchCount += Number(!row.eligible);
    byBarcodeMap.set(row.barcode, current);
  }
  const byBarcode = [...byBarcodeMap.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
  const receivedRowCount = rows.filter(
    (row) => row.status === "RECEIVED" && row.eligible,
  ).length;
  const pendingRowCount = rows.filter((row) => row.status === "PENDING").length;
  const disposedRowCount = rows.filter((row) => row.status === "DISPOSED").length;
  const mismatchCount = rows.filter((row) => !row.eligible).length;
  const canonicalState = {
    draftId,
    evidenceHash,
    rows: rows.map((row) => ({
      applicationNo: row.applicationNo,
      rowNo: row.rowNo,
      displayedQuantity: row.displayedQuantity,
      status: row.status,
      orderNo: row.orderNo,
    })),
  };
  const snapshotHash = hash(canonicalState);
  if (
    previous &&
    snapshotHash !== previous.snapshotHash &&
    Date.parse(observedAt) <= Date.parse(previous.observedAt)
  ) {
    throw new Error("ONDOLPASS_RECEIPT_OBSERVATION_STALE");
  }
  return {
    draftId,
    cycleMonth: evidence.cycleMonth,
    historyRecordId: evidence.historyRecordId,
    evidenceHash,
    observedAt,
    snapshotHash,
    rowCount: rows.length,
    receivedRowCount,
    pendingRowCount,
    disposedRowCount,
    mismatchCount,
    expectedQuantity: rows.reduce(
      (sum, row) => sum + row.expectedQuantity,
      0,
    ),
    displayedQuantity: rows.reduce(
      (sum, row) => sum + row.displayedQuantity,
      0,
    ),
    observedReceivedQuantity: rows.reduce(
      (sum, row) => sum + row.receivedQuantity,
      0,
    ),
    complete:
      receivedRowCount === rows.length &&
      mismatchCount === 0 &&
      disposedRowCount === 0,
    issues: [...new Set(issues)].sort(),
    rows,
    byBarcode,
  };
}

export function parseStoredInternalChinaOndolpassReceiptObservation(
  draftIdInput: unknown,
  row: InternalChinaOndolpassReceiptObservationRow | undefined,
): InternalChinaOndolpassReceiptObservation | null {
  const draftId = text(draftIdInput);
  const snapshot = object(row?.result_snapshot);
  if (
    !DRAFT_ID.test(draftId) ||
    text(snapshot.draftId) !== draftId ||
    !EVIDENCE_HASH.test(text(snapshot.evidenceHash)) ||
    !SNAPSHOT_HASH.test(text(snapshot.snapshotHash)) ||
    !iso(snapshot.observedAt) ||
    !Array.isArray(snapshot.rows) ||
    !Array.isArray(snapshot.byBarcode) ||
    !Array.isArray(snapshot.issues)
  ) {
    return null;
  }
  return snapshot as InternalChinaOndolpassReceiptObservation;
}
