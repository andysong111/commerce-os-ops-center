import {
  buildFreightBarcodeHistoryRecordFromCurrentState,
} from "./freightBarcodeHistory.ts";
import type {
  CreateFreightBarcodeHistoryRecordInput,
  FreightBarcodeHistoryStorageAdapter,
  UpdateFreightBarcodeHistoryRecordInput,
} from "./freightBarcodeHistoryStorage.ts";
import type {
  FreightBarcodeHistoryRecord,
} from "../types/freightBarcodeRequest.ts";

type FreightBarcodeHistoryStoreState = Map<string, FreightBarcodeHistoryRecord>;

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

/**
 * Temporary process-local implementation of Freight Barcode history storage.
 *
 * Data is not persistent. It is lost whenever the server process restarts and
 * may differ between serverless/Vercel runtime instances. This implementation
 * exists only behind the replaceable storage adapter boundary.
 */
export class InMemoryFreightBarcodeHistoryStorage implements FreightBarcodeHistoryStorageAdapter {
  private readonly records: FreightBarcodeHistoryStoreState;

  constructor(records: FreightBarcodeHistoryStoreState = new Map()) {
    this.records = records;
  }

  async create(
    input: CreateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord> {
    const record = buildFreightBarcodeHistoryRecordFromCurrentState(input);
    this.records.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  async list(): Promise<FreightBarcodeHistoryRecord[]> {
    return Array.from(this.records.values(), cloneRecord).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async get(id: string): Promise<FreightBarcodeHistoryRecord | undefined> {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  async update(
    id: string,
    input: UpdateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord | undefined> {
    const existingRecord = this.records.get(id);
    if (!existingRecord) return undefined;

    const updatedRecord: FreightBarcodeHistoryRecord = {
      ...existingRecord,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.memo !== undefined ? { memo: input.memo.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, cloneRecord(updatedRecord));
    return cloneRecord(updatedRecord);
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  clearForTests(): void {
    this.records.clear();
  }
}

export function createInMemoryFreightBarcodeHistoryStorage(): InMemoryFreightBarcodeHistoryStorage {
  return new InMemoryFreightBarcodeHistoryStorage();
}
