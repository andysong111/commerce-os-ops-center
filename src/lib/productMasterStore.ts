import type {
  CreateProductMasterItemInput,
  ProductMasterStorageAdapter,
  UpdateProductMasterItemInput,
} from "./productMasterStorage.ts";
import type { ProductMasterItem } from "../types/productMaster.ts";

type ProductMasterStoreState = Map<string, ProductMasterItem>;

function cloneItem(item: ProductMasterItem): ProductMasterItem {
  return { ...item };
}

export function normalizeProductText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function findItemsByText(
  items: ProductMasterItem[],
  text: string,
): ProductMasterItem[] {
  const normalizedText = normalizeProductText(text);
  if (!normalizedText) return [];

  const exactModelMatches = items.filter((item) => {
    const modelNo = normalizeProductText(item.modelNo);
    const escapedModelNo = modelNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escapedModelNo}([^a-z0-9]|$)`, "i").test(
      normalizedText,
    );
  });
  if (exactModelMatches.length > 0) {
    const optionMatches = exactModelMatches.filter((item) => {
      const optionName = normalizeProductText(item.optionName);
      return optionName.length >= 2 && normalizedText.includes(optionName);
    });
    return optionMatches.length > 0 ? optionMatches : exactModelMatches;
  }

  const optionMatches = items.filter((item) => {
    const optionName = normalizeProductText(item.optionName);
    return optionName.length >= 2 && normalizedText.includes(optionName);
  });
  if (optionMatches.length > 0) return optionMatches;

  return items.filter((item) =>
    [item.modelName, item.displayName]
      .map(normalizeProductText)
      .filter((value) => value.length >= 2)
      .some(
        (value) => normalizedText.includes(value) || value.includes(normalizedText),
      ),
  );
}

/**
 * Temporary process-local implementation of Product Master storage.
 *
 * Data is not persistent and is reset whenever the browser or server process
 * reloads. This implementation exists only behind the replaceable storage
 * adapter boundary; persistent storage will be introduced separately later.
 */
export class InMemoryProductMasterStorage implements ProductMasterStorageAdapter {
  private readonly items: ProductMasterStoreState;

  constructor(items: Iterable<ProductMasterItem> = []) {
    this.items = new Map(
      Array.from(items, (item) => [item.id, cloneItem(item)]),
    );
  }

  create(input: CreateProductMasterItemInput): ProductMasterItem {
    if (this.items.has(input.id)) {
      throw new Error(`Product Master item already exists: ${input.id}`);
    }

    const item = cloneItem(input);
    this.items.set(item.id, item);
    return cloneItem(item);
  }

  list(): ProductMasterItem[] {
    return Array.from(this.items.values(), cloneItem);
  }

  get(id: string): ProductMasterItem | undefined {
    const item = this.items.get(id);
    return item ? cloneItem(item) : undefined;
  }

  update(
    id: string,
    input: UpdateProductMasterItemInput,
  ): ProductMasterItem | undefined {
    const existingItem = this.items.get(id);
    if (!existingItem) return undefined;

    const updatedItem = { ...existingItem, ...input, id };
    this.items.set(id, cloneItem(updatedItem));
    return cloneItem(updatedItem);
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  findByModelNo(modelNo: string): ProductMasterItem | undefined {
    const normalizedModelNo = normalizeProductText(modelNo);
    if (!normalizedModelNo) return undefined;

    const item = this.list().find(
      (candidate) => normalizeProductText(candidate.modelNo) === normalizedModelNo,
    );
    return item ? cloneItem(item) : undefined;
  }

  findByText(text: string): ProductMasterItem[] {
    return findItemsByText(this.list(), text).map(cloneItem);
  }
}

export function createInMemoryProductMasterStorage(
  items: Iterable<ProductMasterItem> = [],
): InMemoryProductMasterStorage {
  return new InMemoryProductMasterStorage(items);
}
