import type {
  FreightApplicationItem,
  FreightBarcodeHistoryRecord,
} from "../types/freightBarcodeRequest.ts";

export const FREIGHT_BARCODE_HISTORY_STORAGE_KEY =
  "commerce-os.freightBarcodeRequests.v1";

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
  existingRecord?: FreightBarcodeHistoryRecord;
  id?: string;
  now?: string;
}

function getBrowserStorage(): FreightBarcodeHistoryStorage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isHistoryRecord(value: unknown): value is FreightBarcodeHistoryRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<FreightBarcodeHistoryRecord>;
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

function createHistoryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `freight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      .filter(isHistoryRecord)
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
  records.push(record);
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
  existingRecord,
  id,
  now = new Date().toISOString(),
}: BuildFreightBarcodeHistoryRecordInput): FreightBarcodeHistoryRecord {
  return {
    id: existingRecord?.id ?? id ?? createHistoryId(),
    applicationNo,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(memo?.trim() ? { memo: memo.trim() } : {}),
    rawText,
    items: items.map((item) => ({ ...item })),
    version: 1,
  };
}
