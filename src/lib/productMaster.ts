import type { ProductMaster, ProductOption } from "@/types/productMaster";

export const PRODUCT_MASTERS: ProductMaster[] = [
  {
    modelNo: "aaa270",
    modelName: "말발굽 고리링",
    category: "생활잡화",
    mainImageUrl: "",
    defaultExchangeRateKrwPerCny: 235,
    status: "active",
    options: [
      {
        optionId: "aaa270-gold",
        optionName: "골드",
        defaultUnitCostCny: 0.35,
      },
      {
        optionId: "aaa270-silver",
        optionName: "실버",
        defaultUnitCostCny: 0.35,
      },
      {
        optionId: "aaa270-black",
        optionName: "블랙",
        defaultUnitCostCny: 0.35,
      },
    ],
  },
  {
    modelNo: "aaa179",
    modelName: "닭물통 니플형",
    category: "생활잡화",
    mainImageUrl: "",
    defaultExchangeRateKrwPerCny: 235,
    status: "active",
    options: [
      {
        optionId: "aaa179-single",
        optionName: "단품",
        defaultUnitCostCny: 0.61,
      },
    ],
  },
  {
    modelNo: "aaa419",
    modelName: "무타공 스티커 후크",
    category: "생활잡화",
    mainImageUrl: "",
    defaultExchangeRateKrwPerCny: 235,
    status: "active",
    options: [
      {
        optionId: "aaa419-liquid-1p",
        optionName: "액자형 1p",
        defaultUnitCostCny: 0.14,
      },
      {
        optionId: "aaa419-bolt-1p",
        optionName: "볼트형 1p",
        defaultUnitCostCny: 0.11,
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

export function getOptionsByModelNo(modelNo: string): ProductOption[] {
  return getProductByModelNo(modelNo)?.options ?? [];
}
