import { createHash } from "node:crypto";
import { normalizeFreightImageUpstreamUrl } from "./freightImageProxy.ts";
import type { FreightBarcodeHistoryRecord } from "../types/freightBarcodeRequest.ts";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const CYCLE_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const EVIDENCE_HASH = /^sha256:[a-f0-9]{64}$/;

export type InternalChinaFreightBarcodeCompletion = {
  draftId: string;
  cycleMonth: string;
  historyRecordId: string;
  applicationNo: string;
  itemCount: number;
  matchedItemCount: number;
  recordUpdatedAt: string;
  evidenceHash: string;
  completedAt: string;
};

export type InternalChinaFreightBarcodeReceiptEvidence =
  InternalChinaFreightBarcodeCompletion & {
    lines: Array<{
      sourceItemId: string;
      applicationNo: string;
      rowNo: number;
      orderNo: string;
      barcode: string;
      quantity: number;
      modelNo: string;
      modelName: string;
      saleOption: string;
      imageUrl: string;
    }>;
  };

export type InternalChinaFreightBarcodePurchaseContext = {
  cycleMonth: string;
  orderCount: number;
  lineCount: number;
  assignedLineCount: number;
};

export type InternalChinaFreightBarcodeCompletionRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

export type CompleteInternalChinaFreightBarcodeDependencies = {
  loadPurchaseContext: (
    draftId: string,
    cycleMonth: string,
  ) => Promise<InternalChinaFreightBarcodePurchaseContext | null>;
  loadHistoryRecord: (
    historyRecordId: string,
  ) => Promise<FreightBarcodeHistoryRecord | undefined>;
  loadCompletion: (
    draftId: string,
  ) => Promise<InternalChinaFreightBarcodeCompletion | null>;
  storeCompletion: (
    completion: InternalChinaFreightBarcodeCompletion,
  ) => Promise<void>;
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

function firstFreightImageUrl(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeFreightImageUpstreamUrl(value);
    if (normalized) return normalized;
  }
  return "";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
    .join(",")}}`;
}

export function freightBarcodeHistoryEvidenceHash(
  record: FreightBarcodeHistoryRecord,
) {
  const canonicalEvidence = {
    id: record.id,
    applicationNo: record.applicationNo,
    title: record.title,
    rawText: record.rawText,
    parsedItems: record.parsedItems,
    productMasterMatches: record.productMasterMatches,
    memo: record.memo,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: record.source,
    pdfVersion: record.pdfVersion,
    itemCount: record.itemCount,
    matchedItemCount: record.matchedItemCount,
  };
  return `sha256:${createHash("sha256")
    .update(stableJson(canonicalEvidence), "utf8")
    .digest("hex")}`;
}

export function buildInternalChinaFreightBarcodeReceiptEvidence(
  completion: InternalChinaFreightBarcodeCompletion,
  record: FreightBarcodeHistoryRecord | undefined,
): InternalChinaFreightBarcodeReceiptEvidence {
  if (
    !record ||
    record.id !== completion.historyRecordId ||
    record.itemCount !== completion.itemCount ||
    record.matchedItemCount !== completion.matchedItemCount ||
    iso(record.updatedAt) !== completion.recordUpdatedAt ||
    freightBarcodeHistoryEvidenceHash(record) !== completion.evidenceHash ||
    record.parsedItems.length !== completion.itemCount ||
    record.productMasterMatches.length !== completion.itemCount
  ) {
    throw new Error("CHINA_RECEIPT_BARCODE_COMPLETION_EVIDENCE_INVALID");
  }

  const itemById = new Map<string, (typeof record.parsedItems)[number]>();
  for (const item of record.parsedItems) {
    const itemId = text(item.id);
    const quantity = positiveInteger(item.quantity);
    if (!itemId || itemById.has(itemId) || quantity <= 0) {
      throw new Error("CHINA_RECEIPT_BARCODE_COMPLETION_EVIDENCE_INVALID");
    }
    itemById.set(itemId, item);
  }

  const seenItemIds = new Set<string>();
  const seenSourceRows = new Set<string>();
  const lines = record.productMasterMatches.map((match) => {
    const itemId = text(match.itemId);
    const barcode = text(match.matchedBarcode)
      .toUpperCase()
      .replace(/\s+/g, "");
    const item = itemById.get(itemId);
    const quantity = positiveInteger(item?.quantity);
    const applicationNo = text(item?.applicationNo);
    const rowNo = positiveInteger(item?.rowNo);
    const sourceRowKey = `${applicationNo}:${rowNo}`;
    if (
      seenItemIds.has(itemId) ||
      !/^\d+$/.test(applicationNo) ||
      rowNo <= 0 ||
      seenSourceRows.has(sourceRowKey) ||
      !/^[A-Z]{3}\d+-\d+$/.test(barcode) ||
      quantity <= 0
    ) {
      throw new Error("CHINA_RECEIPT_BARCODE_COMPLETION_EVIDENCE_INVALID");
    }
    seenItemIds.add(itemId);
    seenSourceRows.add(sourceRowKey);
    return {
      sourceItemId: itemId,
      applicationNo,
      rowNo,
      orderNo: text(item?.orderNo),
      barcode,
      quantity,
      modelNo: text(match.matchedModelNo) || text(item?.modelNo),
      modelName:
        text(match.matchedModelName) ||
        text(match.matchedProductNameKo) ||
        text(item?.modelName) ||
        text(item?.itemName),
      saleOption: text(item?.optionName) || text(item?.optionText),
      imageUrl: firstFreightImageUrl(
        match.matchedImageUrl,
        item?.matchedImageUrl,
        item?.selectedImageCandidateUrl,
        item?.pastedImageUrl,
        item?.imageUrl,
      ),
    };
  });
  if (seenItemIds.size !== itemById.size) {
    throw new Error("CHINA_RECEIPT_BARCODE_COMPLETION_EVIDENCE_INVALID");
  }
  return { ...completion, lines };
}

export function buildInternalChinaFreightBarcodeCompletion(input: {
  draftId: unknown;
  cycleMonth: unknown;
  historyRecordId: unknown;
  purchase: InternalChinaFreightBarcodePurchaseContext | null;
  historyRecord: FreightBarcodeHistoryRecord | undefined;
  completedAt?: unknown;
}): InternalChinaFreightBarcodeCompletion {
  const draftId = text(input.draftId);
  const cycleMonth = text(input.cycleMonth);
  const historyRecordId = text(input.historyRecordId);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_DRAFT_INVALID");
  }
  if (!CYCLE_MONTH.test(cycleMonth)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_CYCLE_MONTH_INVALID");
  }
  if (!historyRecordId || historyRecordId.length > 200) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_REQUIRED");
  }

  const purchase = input.purchase;
  if (!purchase) throw new Error("FREIGHT_BARCODE_COMPLETION_PURCHASE_NOT_FOUND");
  if (purchase.cycleMonth !== cycleMonth) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_CYCLE_MONTH_CONFLICT");
  }
  if (purchase.orderCount <= 0 || purchase.lineCount <= 0) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_ORDER_REQUIRED");
  }
  if (purchase.assignedLineCount <= 0) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_ASSIGNED_ORDER_REQUIRED");
  }

  const record = input.historyRecord;
  if (!record || record.id !== historyRecordId) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_NOT_FOUND");
  }
  if (
    record.itemCount <= 0 ||
    record.parsedItems.length !== record.itemCount
  ) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_EMPTY");
  }
  if (
    record.matchedItemCount !== record.itemCount ||
    record.productMasterMatches.length !== record.itemCount
  ) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_MATCH_INCOMPLETE");
  }
  const applicationNo = text(record.applicationNo);
  if (!applicationNo) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_APPLICATION_REQUIRED");
  }

  const completedAt = iso(input.completedAt ?? new Date().toISOString());
  const recordUpdatedAt = iso(record.updatedAt);
  if (!completedAt || !recordUpdatedAt) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_TIMESTAMP_INVALID");
  }

  return {
    draftId,
    cycleMonth,
    historyRecordId,
    applicationNo,
    itemCount: record.itemCount,
    matchedItemCount: record.matchedItemCount,
    recordUpdatedAt,
    evidenceHash: freightBarcodeHistoryEvidenceHash(record),
    completedAt,
  };
}

function sameCompletion(
  left: InternalChinaFreightBarcodeCompletion,
  right: InternalChinaFreightBarcodeCompletion,
) {
  return (
    left.draftId === right.draftId &&
    left.cycleMonth === right.cycleMonth &&
    left.historyRecordId === right.historyRecordId &&
    left.evidenceHash === right.evidenceHash
  );
}

export async function completeInternalChinaFreightBarcodeWithDependencies(
  input: {
    draftId?: unknown;
    cycleMonth?: unknown;
    historyRecordId?: unknown;
  },
  dependencies: CompleteInternalChinaFreightBarcodeDependencies,
) {
  const draftId = text(input.draftId);
  const cycleMonth = text(input.cycleMonth);
  const historyRecordId = text(input.historyRecordId);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_DRAFT_INVALID");
  }
  if (!CYCLE_MONTH.test(cycleMonth)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_CYCLE_MONTH_INVALID");
  }
  if (!historyRecordId || historyRecordId.length > 200) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_HISTORY_REQUIRED");
  }

  const [purchase, historyRecord, existing] = await Promise.all([
    dependencies.loadPurchaseContext(draftId, cycleMonth),
    dependencies.loadHistoryRecord(historyRecordId),
    dependencies.loadCompletion(draftId),
  ]);
  const requested = buildInternalChinaFreightBarcodeCompletion({
    draftId,
    cycleMonth,
    historyRecordId,
    purchase,
    historyRecord,
  });
  if (existing) {
    if (!sameCompletion(existing, requested)) {
      throw new Error("FREIGHT_BARCODE_COMPLETION_ALREADY_COMPLETED");
    }
    return { completion: existing, alreadyCompleted: true };
  }

  await dependencies.storeCompletion(requested);
  const stored = await dependencies.loadCompletion(draftId);
  if (!stored) throw new Error("FREIGHT_BARCODE_COMPLETION_STORE_READBACK_FAILED");
  if (!sameCompletion(stored, requested)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_ALREADY_COMPLETED");
  }
  return { completion: stored, alreadyCompleted: false };
}

export function parseStoredInternalChinaFreightBarcodeCompletion(
  draftIdInput: unknown,
  row: InternalChinaFreightBarcodeCompletionRow | undefined,
): InternalChinaFreightBarcodeCompletion | null {
  const draftId = text(draftIdInput);
  if (!DRAFT_ID.test(draftId)) return null;
  const snapshot = object(row?.result_snapshot);
  const cycleMonth = text(snapshot.cycleMonth);
  const historyRecordId = text(snapshot.historyRecordId);
  const applicationNo = text(snapshot.applicationNo);
  const itemCount = positiveInteger(snapshot.itemCount);
  const matchedItemCount = positiveInteger(snapshot.matchedItemCount);
  const recordUpdatedAt = iso(snapshot.recordUpdatedAt);
  const evidenceHash = text(snapshot.evidenceHash);
  const completedAt =
    iso(snapshot.completedAt) || iso(row?.updated_at) || iso(row?.started_at);
  if (
    text(snapshot.draftId) !== draftId ||
    !CYCLE_MONTH.test(cycleMonth) ||
    !historyRecordId ||
    !applicationNo ||
    itemCount <= 0 ||
    matchedItemCount !== itemCount ||
    !recordUpdatedAt ||
    !EVIDENCE_HASH.test(evidenceHash) ||
    !completedAt
  ) {
    return null;
  }
  return {
    draftId,
    cycleMonth,
    historyRecordId,
    applicationNo,
    itemCount,
    matchedItemCount,
    recordUpdatedAt,
    evidenceHash,
    completedAt,
  };
}
