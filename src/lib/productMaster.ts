import type {
  ProductMaster,
  ProductMasterItem,
  ProductOption,
} from "@/types/productMaster";

export const PRODUCT_MASTERS: ProductMaster[] = [
  {
    modelNo: "aaa270",
    modelName: "말발굽 고리링",
    category: "생활잡화",
    mainImageUrl: "",
    status: "active",
    productNameKo: "말발굽 고리링",
    barcode: "8800000002704",
    originLabel: "MADE IN CHINA",
    labelText: "원산지: 중국",
    hsCode: "7326209000",
    options: [
      {
        optionId: "aaa270-gold",
        optionName: "골드",
        referenceUnitCostCny: 0.35,
      },
      {
        optionId: "aaa270-silver",
        optionName: "실버",
        referenceUnitCostCny: 0.35,
      },
      {
        optionId: "aaa270-black",
        optionName: "블랙",
        referenceUnitCostCny: 0.35,
      },
    ],
  },
  {
    modelNo: "aaa179",
    modelName: "닭물통 니플형",
    category: "생활잡화",
    mainImageUrl: "",
    status: "active",
    productNameKo: "닭물통 니플형",
    barcode: "8800000001790",
    originLabel: "MADE IN CHINA",
    labelText: "원산지: 중국",
    hsCode: "3926909000",
    options: [
      {
        optionId: "aaa179-single",
        optionName: "단품",
        referenceUnitCostCny: 0.61,
      },
    ],
  },
  {
    modelNo: "aaa419",
    modelName: "무타공 스티커 후크",
    category: "생활잡화",
    mainImageUrl: "",
    status: "active",
    productNameKo: "무타공 스티커 후크",
    barcode: "8800000004197",
    originLabel: "MADE IN CHINA",
    labelText: "원산지: 중국",
    options: [
      {
        optionId: "aaa419-liquid-1p",
        optionName: "액자형 1p",
        referenceUnitCostCny: 0.14,
      },
      {
        optionId: "aaa419-bolt-1p",
        optionName: "볼트형 1p",
        referenceUnitCostCny: 0.11,
      },
    ],
  },
];

export function getProductByModelNo(
  modelNo: string,
): ProductMaster | undefined {
  const normalizedModelNo = modelNo.trim().toLowerCase();

  return PRODUCT_MASTERS.find(
    (product) => product.modelNo.toLowerCase() === normalizedModelNo,
  );
}

export function getProductByModelName(
  modelName: string,
): ProductMaster | undefined {
  const normalizedModelName = modelName.trim().toLocaleLowerCase("ko-KR");

  return PRODUCT_MASTERS.find(
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

  const exactModelNo = PRODUCT_MASTERS.find(
    (product) => product.modelNo.toLowerCase() === normalizedQuery,
  );
  if (exactModelNo) return exactModelNo;

  const exactModelName = PRODUCT_MASTERS.find(
    (product) =>
      product.modelName.toLocaleLowerCase("ko-KR") === normalizedQuery,
  );
  if (exactModelName) return exactModelName;

  const partialModelNameMatches = PRODUCT_MASTERS.filter((product) =>
    product.modelName.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
  );

  return partialModelNameMatches.length === 1
    ? partialModelNameMatches[0]
    : undefined;
}

function normalizeProductText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function toProductMasterItem(
  product: ProductMaster,
  option: ProductOption,
): ProductMasterItem {
  return {
    id: option.optionId,
    modelNo: product.modelNo,
    modelName: product.modelName,
    optionName: option.optionName,
    barcode: product.barcode,
    origin: product.originLabel,
    displayName: [product.productNameKo || product.modelName, option.optionName]
      .filter(Boolean)
      .join(" · "),
    memo: option.memo || product.memo,
    productNameKo: product.productNameKo,
    labelText: product.labelText,
    imageUrl: option.optionImageUrl || product.mainImageUrl,
    hsCode: product.hsCode,
  };
}

const PRODUCT_MASTER_ITEMS: ProductMasterItem[] = PRODUCT_MASTERS.flatMap(
  (product) =>
    product.options.length > 0
      ? product.options.map((option) => toProductMasterItem(product, option))
      : [
          toProductMasterItem(product, {
            optionId: `${product.modelNo}-default`,
            optionName: "",
          }),
        ],
);

export function getProductMasterItems(): ProductMasterItem[] {
  return PRODUCT_MASTER_ITEMS.map((item) => ({ ...item }));
}

export function findProductByModelNo(
  modelNo: string,
): ProductMasterItem | undefined {
  const normalizedModelNo = normalizeProductText(modelNo);
  if (!normalizedModelNo) return undefined;

  return PRODUCT_MASTER_ITEMS.find(
    (item) => normalizeProductText(item.modelNo) === normalizedModelNo,
  );
}

export function findProductsByText(text: string): ProductMasterItem[] {
  const normalizedText = normalizeProductText(text);
  if (!normalizedText) return [];

  const exactModelMatches = PRODUCT_MASTER_ITEMS.filter((item) => {
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

  const optionMatches = PRODUCT_MASTER_ITEMS.filter((item) => {
    const optionName = normalizeProductText(item.optionName);
    return optionName.length >= 2 && normalizedText.includes(optionName);
  });
  if (optionMatches.length > 0) return optionMatches;

  return PRODUCT_MASTER_ITEMS.filter((item) =>
    [item.modelName, item.displayName]
      .map(normalizeProductText)
      .filter((value) => value.length >= 2)
      .some(
        (value) => normalizedText.includes(value) || value.includes(normalizedText),
      ),
  );
}
