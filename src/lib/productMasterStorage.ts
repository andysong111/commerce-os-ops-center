import { PRODUCT_MASTER_SAMPLE_ITEMS } from "./productMasterSampleData.ts";
import { InMemoryProductMasterStorage } from "./productMasterStore.ts";
import type { ProductMasterItem } from "../types/productMaster.ts";

export type CreateProductMasterItemInput = ProductMasterItem;
export type UpdateProductMasterItemInput = Partial<
  Omit<ProductMasterItem, "id">
>;

/**
 * Storage contract for flattened Product Master option records.
 *
 * The synchronous contract preserves the existing client-side Product Master
 * and Freight Barcode lookup APIs. A future persistent implementation can sit
 * behind a server/API-backed adapter without changing those consumers.
 */
export interface ProductMasterStorageAdapter {
  create(input: CreateProductMasterItemInput): ProductMasterItem;
  list(): ProductMasterItem[];
  get(id: string): ProductMasterItem | undefined;
  update(
    id: string,
    input: UpdateProductMasterItemInput,
  ): ProductMasterItem | undefined;
  delete(id: string): boolean;
  findByModelNo(modelNo: string): ProductMasterItem | undefined;
  findByText(text: string): ProductMasterItem[];
}

const globalStorage = globalThis as typeof globalThis & {
  __commerceOsProductMasterStorage?: ProductMasterStorageAdapter;
};

function getMemoryStorage(): ProductMasterStorageAdapter {
  globalStorage.__commerceOsProductMasterStorage ??=
    new InMemoryProductMasterStorage(PRODUCT_MASTER_SAMPLE_ITEMS);
  return globalStorage.__commerceOsProductMasterStorage;
}

/**
 * Returns the configured Product Master storage adapter.
 *
 * Memory is currently the only supported mode. Unknown values deliberately
 * fall back to memory so configuration cannot break the existing read-only UI
 * or Freight Barcode enrichment. A persistent mode can be selected here later.
 */
export function getProductMasterStorage(): ProductMasterStorageAdapter {
  const mode = process.env.PRODUCT_MASTER_STORAGE?.trim().toLowerCase();

  switch (mode) {
    case undefined:
    case "":
    case "memory":
    default:
      return getMemoryStorage();
  }
}
