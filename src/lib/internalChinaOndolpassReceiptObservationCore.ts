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
  shortageRowCount: number;
  shortageQuantity: number;
  overageRowCount: number;
  overageQuantity: number;
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
  shortageRowCount: number;
  shortageQuantity: number;
  overageRowCount: number;
  overageQuantity: number;
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

function normalizedObservationRow(
  value: unknown,
): OndolpassReceiptObservationRow | null {
  const row = object(value);
  const applicationNo = text(row.applicationNo);
  const rowNo = positiveInteger(row.rowNo);
  const expectedQuantity = positiveInteger(row.expectedQuantity);
  const displayedQuantity = positiveInteger(row.displayedQuantity);
  const rowStatus = status(row.status);
  const orderNoMatches = row.orderNoMatches === true;
  if (
    !/^\d+$/.test(applicationNo) ||
    rowNo <= 0 ||
    expectedQuantity <= 0 ||
    displayedQuantity <= 0 ||
    !rowStatus
  ) {
    return null;
  }
  return {
    applicationNo,
    rowNo,
    sourceItemId: text(row.sourceItemId),
    barcode: text(row.barcode),
    orderNo: text(row.orderNo),
    itemName: text(row.itemName).slice(0, 300),
    expectedQuantity,
    displayedQuantity,
    status: rowStatus,
    quantityMatches: expectedQuantity === displayedQuantity,
    orderNoMatches,
    eligible: orderNoMatches,
    receivedQuantity:
      orderNoMatches && rowStatus === "RECEIVED" ? displayedQuantity : 0,
  };
}

function observationIssues(rows: OndolpassReceiptObservationRow[]) {
  const issues: string[] = [];
  for (const row of rows) {
    const key = sourceKey(row.applicationNo, row.rowNo);
    if (row.status === "RECEIVED" && row.displayedQuantity < row.expectedQuantity) {
      issues.push(
        `RECEIPT_SHORTAGE:${key}:${row.expectedQuantity}:${row.displayedQuantity}`,
      );
    }
    if (row.status === "RECEIVED" && row.displayedQuantity > row.expectedQuantity) {
      issues.push(
        `RECEIPT_OVERAGE:${key}:${row.expectedQuantity}:${row.displayedQuantity}`,
      );
    }
    if (!row.orderNoMatches) issues.push(`ORDER_NO_MISMATCH:${key}`);
    if (row.status === "DISPOSED") issues.push(`DISPOSED:${key}`);
  }
  return [...new Set(issues)].sort();
}

function observationSummary(rows: OndolpassReceiptObservationRow[]) {
  const byBarcodeMap = new Map<string, OndolpassReceiptObservationBarcode>();
  for (const row of rows) {
    const received = row.status === "RECEIVED" && row.eligible;
    const shortageQuantity = received
      ? Math.max(0, row.expectedQuantity - row.displayedQuantity)
      : 0;
    const overageQuantity = received
      ? Math.max(0, row.displayedQuantity - row.expectedQuantity)
      : 0;
    const current = byBarcodeMap.get(row.barcode) ?? {
      barcode: row.barcode,
      expectedQuantity: 0,
      observedReceivedQuantity: 0,
      rowCount: 0,
      receivedRowCount: 0,
      pendingRowCount: 0,
      disposedRowCount: 0,
      shortageRowCount: 0,
      shortageQuantity: 0,
      overageRowCount: 0,
      overageQuantity: 0,
      mismatchCount: 0,
    };
    current.expectedQuantity += row.expectedQuantity;
    current.observedReceivedQuantity += row.receivedQuantity;
    current.rowCount += 1;
    current.receivedRowCount += Number(received);
    current.pendingRowCount += Number(row.status === "PENDING");
    current.disposedRowCount += Number(row.status === "DISPOSED");
    current.shortageRowCount += Number(shortageQuantity > 0);
    current.shortageQuantity += shortageQuantity;
    current.overageRowCount += Number(overageQuantity > 0);
    current.overageQuantity += overageQuantity;
    current.mismatchCount += Number(!row.orderNoMatches);
    byBarcodeMap.set(row.barcode, current);
  }
  const byBarcode = [...byBarcodeMap.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
  const receivedRows = rows.filter(
    (row) => row.status === "RECEIVED" && row.eligible,
  );
  return {
    byBarcode,
    receivedRowCount: receivedRows.length,
    pendingRowCount: rows.filter((row) => row.status === "PENDING").length,
    disposedRowCount: rows.filter((row) => row.status === "DISPOSED").length,
    shortageRowCount: receivedRows.filter(
      (row) => row.displayedQuantity < row.expectedQuantity,
    ).length,
    shortageQuantity: receivedRows.reduce(
      (sum, row) => sum + Math.max(0, row.expectedQuantity - row.displayedQuantity),
      0,
    ),
    overageRowCount: receivedRows.filter(
      (row) => row.displayedQuantity > row.expectedQuantity,
    ).length,
    overageQuantity: receivedRows.reduce(
      (sum, row) => sum + Math.max(0, row.displayedQuantity - row.expectedQuantity),
      0,
    ),
    mismatchCount: rows.filter((row) => !row.orderNoMatches).length,
    expectedQuantity: rows.reduce((sum, row) => sum + row.expectedQuantity, 0),
    displayedQuantity: rows.reduce((sum, row) => sum + row.displayedQuantity, 0),
    observedReceivedQuantity: rows.reduce(
      (sum, row) => sum + row.receivedQuantity,
      0,
    ),
  };
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

  const rows: OndolpassReceiptObservationRow[] = [];
  for (const [key, expected] of expectedByKey) {
    const observed = observedByKey.get(key);
    if (!observed) throw new Error("ONDOLPASS_RECEIPT_ROW_SET_MISMATCH");
    const quantityMatches = expected.quantity === observed.displayedQuantity;
    const orderNoMatches =
      !expected.orderNo ||
      expected.orderNo === observed.orderNo;
    const eligible = orderNoMatches;
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
      if (
        oldRow.status === "RECEIVED" &&
        oldRow.eligible &&
        (currentByKey.get(sourceKey(oldRow.applicationNo, oldRow.rowNo))?.status !==
          "RECEIVED" ||
          !currentByKey.get(sourceKey(oldRow.applicationNo, oldRow.rowNo))
            ?.eligible)
      ) {
        throw new Error("ONDOLPASS_RECEIPT_STATUS_REGRESSION");
      }
    }
  }

  const summary = observationSummary(rows);
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
  return {
    draftId,
    cycleMonth: evidence.cycleMonth,
    historyRecordId: evidence.historyRecordId,
    evidenceHash,
    observedAt,
    snapshotHash: hash(canonicalState),
    rowCount: rows.length,
    ...summary,
    complete:
      summary.receivedRowCount === rows.length &&
      summary.mismatchCount === 0 &&
      summary.disposedRowCount === 0,
    issues: observationIssues(rows),
    rows,
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
  const rows = (snapshot.rows as unknown[]).map(normalizedObservationRow);
  if (rows.some((entry) => !entry)) return null;
  const normalizedRows = rows as OndolpassReceiptObservationRow[];
  const summary = observationSummary(normalizedRows);
  return {
    ...(snapshot as InternalChinaOndolpassReceiptObservation),
    ...summary,
    complete:
      summary.receivedRowCount === normalizedRows.length &&
      summary.mismatchCount === 0 &&
      summary.disposedRowCount === 0,
    issues: observationIssues(normalizedRows),
    rows: normalizedRows,
  };
}
