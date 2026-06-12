import { getProductMasterStorage } from "./productMasterStorage.ts";
import { normalizeProductText } from "./productMasterStore.ts";
import type {
  ProductMaster,
  ProductMasterItem,
  ProductOption,
  ProductStatus,
} from "../types/productMaster.ts";

function cloneProduct(product: ProductMaster): ProductMaster {
  return {
    ...product,
    options: product.options.map((option) => ({ ...option })),
  };
}

function toProductMasterOption(item: ProductMasterItem): ProductOption {
  return {
    optionId: item.id,
    optionName: item.optionName,
    optionImageUrl: item.optionImageUrl,
    referenceUnitCostCny: item.referenceUnitCostCny,
    memo: item.memo === item.productMemo ? undefined : item.memo,
  };
}

function groupProductMasterItems(items: ProductMasterItem[]): ProductMaster[] {
  const products = new Map<string, ProductMaster>();

  for (const item of items) {
    const existingProduct = products.get(item.modelNo);
    if (existingProduct) {
      existingProduct.options.push(toProductMasterOption(item));
      continue;
    }

    products.set(item.modelNo, {
      modelNo: item.modelNo,
      modelName: item.modelName,
      category: item.category ?? "",
      mainImageUrl: item.mainImageUrl ?? item.imageUrl,
      status: item.status ?? ("active" satisfies ProductStatus),
      memo: item.productMemo,
      options: [toProductMasterOption(item)],
      referenceUnitCostCny: item.productReferenceUnitCostCny,
      productNameKo: item.productNameKo,
      productNameCn: item.productNameCn,
      barcode: item.barcode,
      originLabel: item.origin,
      labelText: item.labelText,
      hsCode: item.hsCode,
    });
  }

  return Array.from(products.values(), cloneProduct);
}

export function getProductMasters(): ProductMaster[] {
  return groupProductMasterItems(getProductMasterStorage().list());
}

/**
 * Backward-compatible snapshot for callers that imported the original sample
 * constant. New data access should use the lookup functions in this module.
 */
export const PRODUCT_MASTERS: ProductMaster[] = getProductMasters();

export function getProductByModelNo(
  modelNo: string,
): ProductMaster | undefined {
  const normalizedModelNo = modelNo.trim().toLowerCase();

  return getProductMasters().find(
    (product) => product.modelNo.toLowerCase() === normalizedModelNo,
  );
}

export function getProductByModelName(
  modelName: string,
): ProductMaster | undefined {
  const normalizedModelName = modelName.trim().toLocaleLowerCase("ko-KR");

  return getProductMasters().find(
    (product) =>
      product.modelName.toLocaleLowerCase("ko-KR") === normalizedModelName,
  );
}

export function getOptionsByModelNo(modelNo: string): ProductOption[] {
  return getProductByModelNo(modelNo)?.options ?? [];
}

export function findProductByModelNoOrModelName(
  query: string,
): ProductMaster | undefined {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) return undefined;

  const products = getProductMasters();
  const exactModelNo = products.find(
    (product) => product.modelNo.toLowerCase() === normalizedQuery,
  );
  if (exactModelNo) return exactModelNo;

  const exactModelName = products.find(
    (product) =>
      product.modelName.toLocaleLowerCase("ko-KR") === normalizedQuery,
  );
  if (exactModelName) return exactModelName;

  const partialModelNameMatches = products.filter((product) =>
    product.modelName.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
  );

  return partialModelNameMatches.length === 1
    ? partialModelNameMatches[0]
    : undefined;
}

export function getProductMasterItems(): ProductMasterItem[] {
  return getProductMasterStorage().list();
}

export function findProductByModelNo(
  modelNo: string,
): ProductMasterItem | undefined {
  return getProductMasterStorage().findByModelNo(modelNo);
}

export function findProductsByText(text: string): ProductMasterItem[] {
  return getProductMasterStorage().findByText(text);
}

export { normalizeProductText };
