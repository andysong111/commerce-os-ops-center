import type {
  ProductMaster,
  ProductMasterItem,
  ProductOption,
} from "@/types/productMaster";

export const PRODUCT_MASTER_SAMPLE_PRODUCTS: ProductMaster[] = [
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
    productNameCn: product.productNameCn,
    labelText: product.labelText,
    imageUrl: option.optionImageUrl || product.mainImageUrl,
    hsCode: product.hsCode,
    category: product.category,
    status: product.status,
    mainImageUrl: product.mainImageUrl,
    productMemo: product.memo,
    productReferenceUnitCostCny: product.referenceUnitCostCny,
    optionImageUrl: option.optionImageUrl,
    referenceUnitCostCny: option.referenceUnitCostCny,
  };
}

export const PRODUCT_MASTER_SAMPLE_ITEMS: ProductMasterItem[] =
  PRODUCT_MASTER_SAMPLE_PRODUCTS.flatMap((product) =>
    product.options.length > 0
      ? product.options.map((option) => toProductMasterItem(product, option))
      : [
          toProductMasterItem(product, {
            optionId: `${product.modelNo}-default`,
            optionName: "",
          }),
        ],
  );
