import type {
  BuildFreightBarcodeHistoryRecordInput,
} from "./freightBarcodeHistory.ts";
import {
  InMemoryFreightBarcodeHistoryStorage,
} from "./freightBarcodeHistoryStore.ts";
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

/**
 * Server-side storage contract for Freight Barcode PDF history.
 *
 * Implementations must return detached records so callers cannot mutate stored
 * state. The asynchronous contract allows a persistent adapter to be added
 * later without changing API route handlers or UI contracts.
 */
export interface FreightBarcodeHistoryStorageAdapter {
  create(
    input: CreateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord>;
  list(): Promise<FreightBarcodeHistoryRecord[]>;
  get(id: string): Promise<FreightBarcodeHistoryRecord | undefined>;
  update(
    id: string,
    input: UpdateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord | undefined>;
  delete(id: string): Promise<boolean>;
}

const globalStorage = globalThis as typeof globalThis & {
  __commerceOsFreightBarcodeHistoryStorage?: FreightBarcodeHistoryStorageAdapter;
};

function getMemoryStorage(): FreightBarcodeHistoryStorageAdapter {
  globalStorage.__commerceOsFreightBarcodeHistoryStorage ??=
    new InMemoryFreightBarcodeHistoryStorage();
  return globalStorage.__commerceOsFreightBarcodeHistoryStorage;
}

/**
 * Returns the configured server-side history storage adapter.
 *
 * Memory is currently the only supported mode. Unknown values deliberately
 * fall back to memory so a deployment configuration mistake does not disable
 * the existing temporary history feature. A persistent adapter can be selected
 * here later without changing route handlers.
 */
export function getFreightBarcodeHistoryStorage(): FreightBarcodeHistoryStorageAdapter {
  const mode = process.env.FREIGHT_BARCODE_HISTORY_STORAGE?.trim().toLowerCase();

  switch (mode) {
    case undefined:
    case "":
    case "memory":
    default:
      return getMemoryStorage();
  }
}
