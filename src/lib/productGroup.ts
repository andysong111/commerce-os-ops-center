export const PRODUCT_GROUP_DEFINITIONS = [
  { suffix: "a", productGroup: "도매1", productGroupType: "도매" },
  { suffix: "b", productGroup: "도매2", productGroupType: "도매" },
  { suffix: "c", productGroup: "도매3", productGroupType: "도매" },
  { suffix: "d", productGroup: "도매4", productGroupType: "도매" },
  { suffix: "e", productGroup: "소매1", productGroupType: "소매" },
  { suffix: "f", productGroup: "소매2", productGroupType: "소매" },
] as const;

export type ProductGroupType = "도매" | "소매" | "기타" | "확인 필요";
export type ProductGroupStatus = "registered" | "unregistered" | "missing";

export type ProductGroupInference = {
  groupSuffix: string;
  productGroup: string;
  productGroupType: ProductGroupType;
  productGroupStatus: ProductGroupStatus;
};

const PRODUCT_GROUP_BY_SUFFIX: ReadonlyMap<string, (typeof PRODUCT_GROUP_DEFINITIONS)[number]> = new Map(
  PRODUCT_GROUP_DEFINITIONS.map((definition) => [definition.suffix, definition]),
);

export const MISSING_PRODUCT_GROUP: ProductGroupInference = {
  groupSuffix: "",
  productGroup: "상품그룹 확인 필요",
  productGroupType: "확인 필요",
  productGroupStatus: "missing",
};

export function inferProductGroupFromPtnGoodsCd(
  ptnGoodsCd: string,
): ProductGroupInference {
  const trimmed = ptnGoodsCd.trim();
  if (!trimmed) return MISSING_PRODUCT_GROUP;

  const suffix = trimmed.slice(-1).toLowerCase();
  if (!/^[a-z]$/.test(suffix)) return MISSING_PRODUCT_GROUP;

  const registeredGroup = PRODUCT_GROUP_BY_SUFFIX.get(suffix);
  if (registeredGroup) {
    return {
      groupSuffix: registeredGroup.suffix,
      productGroup: registeredGroup.productGroup,
      productGroupType: registeredGroup.productGroupType,
      productGroupStatus: "registered",
    };
  }

  return {
    groupSuffix: suffix,
    productGroup: `미등록 그룹(${suffix})`,
    productGroupType: "확인 필요",
    productGroupStatus: "unregistered",
  };
}
