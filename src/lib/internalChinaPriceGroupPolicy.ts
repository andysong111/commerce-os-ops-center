export const INTERNAL_PRICE_GROUP_LABELS = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
] as const;

export type InternalPriceGroup = (typeof INTERNAL_PRICE_GROUP_LABELS)[number];

export const INTERNAL_PRICE_GROUP_KEYS: Record<InternalPriceGroup, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

export const INTERNAL_PRICE_GROUP_SEARCH_PREFIX: Record<InternalPriceGroup, string> = {
  도매1: "DM1_",
  도매2: "DM2_",
  도매3: "DM3_",
  도매4: "DM4_",
  소매1: "SM1_",
  소매2: "SM2_",
};

// 2026-08 validated Commerce OS pricing policy.
// Group target = confirmed cost × units-per-order × 2 × group multiplier, rounded up to 10 KRW.
export const INTERNAL_PRICE_GROUP_MULTIPLIER: Record<InternalPriceGroup, number> = {
  도매1: 1,
  도매2: 1.15,
  도매3: 1.1,
  도매4: 1.3,
  소매1: 1.3,
  소매2: 1.4,
};

export type InternalMallPricePolicy = {
  mallKey: string;
  mallName: string;
  multiplier?: number;
  addKrw?: number;
};

const MALL = {
  AUCTION: { mallKey: "SMALL_00001", mallName: "옥션" },
  GMARKET: { mallKey: "SMALL_00002", mallName: "지마켓" },
  ELEVEN: { mallKey: "SMALL_00003", mallName: "11번가" },
  SMARTSTORE: { mallKey: "SMALL_00004", mallName: "스마트스토어" },
  GS: { mallKey: "SMALL_00005", mallName: "GS SHOP" },
  COUPANG: { mallKey: "SMALL_00012", mallName: "쿠팡" },
  CAFE24: {
    mallKey: "SMALL_00014",
    mallName: "카페24",
    multiplier: 0.97,
  },
  SHINSEGAE: { mallKey: "SMALL_00019", mallName: "신세계몰" },
  DOMAEGGUK: { mallKey: "SMALL_00069", mallName: "도매꾹" },
  WAREHOUSE: {
    mallKey: "SMALL_00071",
    mallName: "도매창고",
    addKrw: 500,
  },
  KAKAO: { mallKey: "SMALL_00101", mallName: "카카오톡 스토어" },
  OWNERCLAN: { mallKey: "SMALL_00107", mallName: "오너클랜" },
  ABLY: { mallKey: "SMALL_00112", mallName: "에이블리", addKrw: 3000 },
  SELPA: { mallKey: "SMALL_00116", mallName: "셀파" },
  LOTTE: { mallKey: "SMALL_00130", mallName: "롯데ON" },
  SELLINGCOCK: { mallKey: "SMALL_00165", mallName: "셀링콕" },
  INTERPARK: { mallKey: "SMALL_00168", mallName: "인터파크" },
  TUBIZON: { mallKey: "SMALL_00179", mallName: "투비즈온" },
  DOMAEATOZ: { mallKey: "SMALL_00180", mallName: "도매아토즈" },
  SELLERUS: { mallKey: "SMALL_00188", mallName: "셀러어스" },
  DOMAESIN: { mallKey: "SMALL_00190", mallName: "도매의신" },
  TOSS: { mallKey: "SMALL_00194", mallName: "토스쇼핑" },
} satisfies Record<string, InternalMallPricePolicy>;

export type InternalPriceFamily = "WHOLESALE" | "RETAIL";
export type InternalPriceFamilyInference = {
  family: InternalPriceFamily;
  fallbackGroup: "도매1" | "소매1";
  source: "MALL_FAMILY" | "PRICE_RATIO";
};

export const INTERNAL_PRICE_GROUP_MALLS: Record<
  InternalPriceGroup,
  readonly InternalMallPricePolicy[]
> = {
  도매1: [
    MALL.CAFE24,
    MALL.DOMAEGGUK,
    MALL.WAREHOUSE,
    MALL.OWNERCLAN,
    MALL.SELPA,
    MALL.SELLINGCOCK,
    MALL.TUBIZON,
    MALL.DOMAEATOZ,
    MALL.SELLERUS,
    MALL.DOMAESIN,
  ],
  도매2: [MALL.DOMAEGGUK, MALL.OWNERCLAN, MALL.SELPA, MALL.SELLINGCOCK],
  도매3: [MALL.DOMAEGGUK, MALL.OWNERCLAN, MALL.SELPA, MALL.SELLINGCOCK],
  도매4: [MALL.DOMAEGGUK],
  소매1: [
    MALL.AUCTION,
    MALL.GMARKET,
    MALL.ELEVEN,
    MALL.SMARTSTORE,
    MALL.GS,
    MALL.COUPANG,
    MALL.SHINSEGAE,
    MALL.KAKAO,
    MALL.ABLY,
    MALL.LOTTE,
    MALL.INTERPARK,
    MALL.TOSS,
  ],
  소매2: [MALL.AUCTION, MALL.GMARKET, MALL.ELEVEN, MALL.COUPANG, MALL.TOSS],
};

const WHOLESALE_MALL_KEYS = new Set(
  (["도매1", "도매2", "도매3", "도매4"] as InternalPriceGroup[])
    .flatMap((group) => INTERNAL_PRICE_GROUP_MALLS[group].map((row) => row.mallKey)),
);
const RETAIL_MALL_KEYS = new Set(
  (["소매1", "소매2"] as InternalPriceGroup[])
    .flatMap((group) => INTERNAL_PRICE_GROUP_MALLS[group].map((row) => row.mallKey)),
);

/**
 * Legacy products may predate DM/SM self-code prefixes. Infer only the broad
 * wholesale/retail family. Channel membership is stronger evidence than price.
 * Price is a last fallback and intentionally leaves the 2.4~2.7 overlap band
 * unresolved because wholesale4 and retail1 can share similar markups.
 */
export function inferLegacyInternalPriceFamily(input: {
  mallKeys?: Iterable<unknown>;
  priceRatios?: Iterable<unknown>;
}): InternalPriceFamilyInference | null {
  const keys = [...new Set([...(input.mallKeys ?? [])].map((value) => String(value ?? "").trim()).filter(Boolean))];
  const wholesale = keys.filter((key) => WHOLESALE_MALL_KEYS.has(key)).length;
  const retail = keys.filter((key) => RETAIL_MALL_KEYS.has(key)).length;
  if (wholesale > 0 && retail === 0) return { family: "WHOLESALE", fallbackGroup: "도매1", source: "MALL_FAMILY" };
  if (retail > 0 && wholesale === 0) return { family: "RETAIL", fallbackGroup: "소매1", source: "MALL_FAMILY" };

  const ratios = [...(input.priceRatios ?? [])].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (ratios.length && ratios.every((value) => value <= 2.4)) {
    return { family: "WHOLESALE", fallbackGroup: "도매1", source: "PRICE_RATIO" };
  }
  if (ratios.length && ratios.every((value) => value >= 2.7)) {
    return { family: "RETAIL", fallbackGroup: "소매1", source: "PRICE_RATIO" };
  }
  return null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function positiveInteger(value: unknown) {
  return Math.max(1, integer(value) || 1);
}

export function roundUp10(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.ceil(parsed / 10) * 10;
}

export function normalizeInternalPriceGroup(value: unknown): InternalPriceGroup | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/번$/, "")
    .trim();
  return (INTERNAL_PRICE_GROUP_LABELS as readonly string[]).includes(normalized)
    ? (normalized as InternalPriceGroup)
    : null;
}

export function internalPriceGroupTarget(input: {
  latestCostKrw: unknown;
  unitsPerOrder?: unknown;
  productGroup: unknown;
}) {
  const productGroup = normalizeInternalPriceGroup(input.productGroup);
  if (!productGroup) return 0;
  const cost = integer(input.latestCostKrw);
  if (cost <= 0) return 0;
  const units = positiveInteger(input.unitsPerOrder);
  const multiplier = INTERNAL_PRICE_GROUP_MULTIPLIER[productGroup];
  return roundUp10(cost * units * 2 * multiplier);
}

export function applyMallPricePolicy(
  groupTargetPrice: unknown,
  policy: InternalMallPricePolicy,
) {
  const base = integer(groupTargetPrice);
  if (base <= 0) return 0;
  const multiplied = base * (policy.multiplier ?? 1);
  return roundUp10(multiplied + (policy.addKrw ?? 0));
}

export function buildInternalMallPriceTargets(input: {
  productGroup: unknown;
  groupTargetPrice: unknown;
}) {
  const productGroup = normalizeInternalPriceGroup(input.productGroup);
  if (!productGroup) return [];
  const base = integer(input.groupTargetPrice);
  if (base <= 0) return [];
  return INTERNAL_PRICE_GROUP_MALLS[productGroup].map((policy) => ({
    mallKey: policy.mallKey,
    mallName: policy.mallName,
    targetPrice: applyMallPricePolicy(base, policy),
    policyMultiplier: policy.multiplier ?? 1,
    policyAddKrw: policy.addKrw ?? 0,
  }));
}

export function groupKeyForLabel(group: InternalPriceGroup) {
  return INTERNAL_PRICE_GROUP_KEYS[group];
}

export function searchPrefixForLabel(group: InternalPriceGroup) {
  return INTERNAL_PRICE_GROUP_SEARCH_PREFIX[group];
}
