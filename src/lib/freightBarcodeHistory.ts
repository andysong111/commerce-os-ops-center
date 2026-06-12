import type {
  FreightApplicationItem,
  FreightBarcodeHistoryRecord,
  FreightBarcodeHistorySource,
  FreightBarcodeProductMasterMatch,
} from "../types/freightBarcodeRequest.ts";

export const FREIGHT_BARCODE_HISTORY_STORAGE_KEY =
  "commerce-os.freightBarcodeRequests.v1";
export const FREIGHT_BARCODE_PDF_VERSION = 1;

export interface FreightBarcodeHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BuildFreightBarcodeHistoryRecordInput {
  applicationNo: string;
  rawText: string;
  items: FreightApplicationItem[];
  title?: string;
  memo?: string;
  source?: FreightBarcodeHistorySource;
  existingRecord?: FreightBarcodeHistoryRecord;
  id?: string;
  now?: string;
}

interface LegacyFreightBarcodeHistoryRecord {
  id: string;
  applicationNo: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  memo?: string;
  rawText: string;
  items: FreightApplicationItem[];
  version: number;
}

function getBrowserStorage(): FreightBarcodeHistoryStorage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isLegacyHistoryRecord(
  value: unknown,
): value is LegacyFreightBarcodeHistoryRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<LegacyFreightBarcodeHistoryRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.applicationNo === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.rawText === "string" &&
    Array.isArray(record.items) &&
    typeof record.version === "number"
  );
}

function isHistoryRecord(value: unknown): value is FreightBarcodeHistoryRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<FreightBarcodeHistoryRecord>;
  return (
    isLegacyHistoryRecord(value) &&
    typeof record.title === "string" &&
    Array.isArray(record.parsedItems) &&
    Array.isArray(record.productMasterMatches) &&
    typeof record.memo === "string" &&
    (record.source === "manual-paste" || record.source === "restored-history") &&
    typeof record.pdfVersion === "number" &&
    typeof record.itemCount === "number" &&
    typeof record.matchedItemCount === "number"
  );
}

function createHistoryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `freight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getFreightBarcodeProductMasterMatches(
  items: FreightApplicationItem[],
): FreightBarcodeProductMasterMatch[] {
  return items.flatMap((item) => {
    if (!item.matchedModelNo) return [];

    return [{
      itemId: item.id,
      ...(item.matchedModelNo ? { matchedModelNo: item.matchedModelNo } : {}),
      ...(item.matchedModelName ? { matchedModelName: item.matchedModelName } : {}),
      ...(item.matchedProductNameKo
        ? { matchedProductNameKo: item.matchedProductNameKo }
        : {}),
      ...(item.matchedBarcode ? { matchedBarcode: item.matchedBarcode } : {}),
      ...(item.matchedOriginLabel
        ? { matchedOriginLabel: item.matchedOriginLabel }
        : {}),
      ...(item.matchedLabelText
        ? { matchedLabelText: item.matchedLabelText }
        : {}),
      ...(item.matchedImageUrl
        ? { matchedImageUrl: item.matchedImageUrl }
        : {}),
    }];
  });
}

function normalizeHistoryRecord(
  record: LegacyFreightBarcodeHistoryRecord | FreightBarcodeHistoryRecord,
): FreightBarcodeHistoryRecord {
  const parsedItems = isHistoryRecord(record) ? record.parsedItems : record.items;
  const items = parsedItems.map((item) => ({ ...item }));
  const productMasterMatches = isHistoryRecord(record)
    ? record.productMasterMatches.map((match) => ({ ...match }))
    : getFreightBarcodeProductMasterMatches(items);
  const pdfVersion = isHistoryRecord(record) ? record.pdfVersion : record.version;

  return {
    id: record.id,
    applicationNo: record.applicationNo,
    title: record.title?.trim() ?? "",
    rawText: record.rawText,
    parsedItems: items,
    productMasterMatches,
    memo: record.memo?.trim() ?? "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: isHistoryRecord(record) ? record.source : "manual-paste",
    pdfVersion,
    itemCount: items.length,
    matchedItemCount: productMasterMatches.length,
    items,
    version: pdfVersion,
  };
}

export function listFreightBarcodeHistory(
  storage: FreightBarcodeHistoryStorage | undefined = getBrowserStorage(),
): FreightBarcodeHistoryRecord[] {
  if (!storage) return [];

  try {
    const storedValue = storage.getItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY);
    if (!storedValue) return [];

    const parsedValue: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .filter(isLegacyHistoryRecord)
      .map(normalizeHistoryRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function saveFreightBarcodeHistory(
  record: FreightBarcodeHistoryRecord,
  storage: FreightBarcodeHistoryStorage | undefined = getBrowserStorage(),
): FreightBarcodeHistoryRecord {
  if (!storage) return record;

  const records = listFreightBarcodeHistory(storage).filter(
    (savedRecord) => savedRecord.id !== record.id,
  );
  records.push(normalizeHistoryRecord(record));
  records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  storage.setItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY, JSON.stringify(records));

  return record;
}

export function loadFreightBarcodeHistory(
  id: string,
  storage: FreightBarcodeHistoryStorage | undefined = getBrowserStorage(),
): FreightBarcodeHistoryRecord | undefined {
  return listFreightBarcodeHistory(storage).find((record) => record.id === id);
}

export function deleteFreightBarcodeHistory(
  id: string,
  storage: FreightBarcodeHistoryStorage | undefined = getBrowserStorage(),
): void {
  if (!storage) return;

  const records = listFreightBarcodeHistory(storage).filter(
    (record) => record.id !== id,
  );

  if (records.length === 0) {
    storage.removeItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY);
    return;
  }

  storage.setItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY, JSON.stringify(records));
}

export function buildFreightBarcodeHistoryRecordFromCurrentState({
  applicationNo,
  rawText,
  items,
  title,
  memo,
  source = "manual-paste",
  existingRecord,
  id,
  now = new Date().toISOString(),
}: BuildFreightBarcodeHistoryRecordInput): FreightBarcodeHistoryRecord {
  const parsedItems = items.map((item) => ({ ...item }));
  const productMasterMatches = getFreightBarcodeProductMasterMatches(parsedItems);

  return {
    id: existingRecord?.id ?? id ?? createHistoryId(),
    applicationNo,
    title: title?.trim() ?? "",
    rawText,
    parsedItems,
    productMasterMatches,
    memo: memo?.trim() ?? "",
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    source,
    pdfVersion: FREIGHT_BARCODE_PDF_VERSION,
    itemCount: parsedItems.length,
    matchedItemCount: productMasterMatches.length,
    items: parsedItems,
    version: FREIGHT_BARCODE_PDF_VERSION,
  };
}
