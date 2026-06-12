import {
  buildFreightBarcodeHistoryRecordFromCurrentState,
} from "./freightBarcodeHistory.ts";
import type {
  BuildFreightBarcodeHistoryRecordInput,
} from "./freightBarcodeHistory.ts";
import type {
  FreightBarcodeHistoryRecord,
} from "../types/freightBarcodeRequest.ts";

export type CreateFreightBarcodeHistoryRecordInput = Omit<
  BuildFreightBarcodeHistoryRecordInput,
  "existingRecord" | "id" | "now"
>;

export interface UpdateFreightBarcodeHistoryRecordInput {
  title?: string;
  memo?: string;
}

type FreightBarcodeHistoryStoreState = Map<string, FreightBarcodeHistoryRecord>;

const globalStore = globalThis as typeof globalThis & {
  __commerceOsFreightBarcodeHistory?: FreightBarcodeHistoryStoreState;
};

/**
 * Temporary process-local server history boundary.
 *
 * Records disappear whenever the server process restarts and may differ between
 * server instances. Keep access behind these functions so a persistent database
 * can replace the Map without changing route or UI contracts.
 */
function getStore(): FreightBarcodeHistoryStoreState {
  globalStore.__commerceOsFreightBarcodeHistory ??= new Map();
  return globalStore.__commerceOsFreightBarcodeHistory;
}

function cloneRecord(
  record: FreightBarcodeHistoryRecord,
): FreightBarcodeHistoryRecord {
  const parsedItems = record.parsedItems.map((item) => ({ ...item }));

  return {
    ...record,
    parsedItems,
    items: parsedItems,
    productMasterMatches: record.productMasterMatches.map((match) => ({ ...match })),
  };
}

export function createFreightBarcodeHistoryRecord(
  input: CreateFreightBarcodeHistoryRecordInput,
): FreightBarcodeHistoryRecord {
  const record = buildFreightBarcodeHistoryRecordFromCurrentState(input);
  getStore().set(record.id, cloneRecord(record));
  return cloneRecord(record);
}

export function listFreightBarcodeHistoryRecords(): FreightBarcodeHistoryRecord[] {
  return Array.from(getStore().values(), cloneRecord).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function getFreightBarcodeHistoryRecord(
  id: string,
): FreightBarcodeHistoryRecord | undefined {
  const record = getStore().get(id);
  return record ? cloneRecord(record) : undefined;
}

export function updateFreightBarcodeHistoryRecord(
  id: string,
  input: UpdateFreightBarcodeHistoryRecordInput,
): FreightBarcodeHistoryRecord | undefined {
  const existingRecord = getStore().get(id);
  if (!existingRecord) return undefined;

  const updatedRecord: FreightBarcodeHistoryRecord = {
    ...existingRecord,
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.memo !== undefined ? { memo: input.memo.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  getStore().set(id, cloneRecord(updatedRecord));
  return cloneRecord(updatedRecord);
}

export function deleteFreightBarcodeHistoryRecord(id: string): boolean {
  return getStore().delete(id);
}

export function clearFreightBarcodeHistoryRecordsForTests(): void {
  getStore().clear();
}
