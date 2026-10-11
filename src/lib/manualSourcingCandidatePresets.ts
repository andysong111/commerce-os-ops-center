import type { ManualPilotCatalogCandidate } from "./sourcingBudgetPlan";

export type ManualSourcingCandidatePreset = {
  sourceUrl: string;
  productName: string;
  supplierName: string;
  variants: Array<{
    saleOption: string;
    chinaOption: string;
    storageSize: "" | "S" | "L";
    unitPriceCny: number | null;
    moq: number | null;
  }>;
};

function offerUrl(offerId: string) {
  return `https://detail.1688.com/offer/${offerId}.html`;
}

export function canonicalManualSourcingSourceUrl(value: string) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/offer\/(\d{5,})\.html$/u);
    return url.protocol === "https:" && url.hostname === "detail.1688.com" && match
      ? offerUrl(match[1])
      : value.trim();
  } catch {
    return value.trim();
  }
}

const optionIdentity = (value: string) => value
  .normalize("NFKC")
  .replace(/\s+/gu, " ")
  .trim()
  .toLocaleLowerCase("ko-KR");

export function mergeManualSourcingCandidatePresets(
  current: ManualSourcingCandidatePreset[],
  additions: ManualSourcingCandidatePreset[],
) {
  const merged = new Map<string, ManualSourcingCandidatePreset>();
  for (const product of [...current, ...additions]) {
    const sourceUrl = canonicalManualSourcingSourceUrl(product.sourceUrl);
    if (!sourceUrl && !product.productName && !product.variants.length) continue;
    const key = sourceUrl || `name:${optionIdentity(product.productName)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...product,
        sourceUrl,
        variants: product.variants.map((variant) => ({ ...variant })),
      });
      continue;
    }
    const variantByIdentity = new Map(existing.variants.map((variant) => [
      optionIdentity(variant.chinaOption || variant.saleOption),
      variant,
    ]));
    for (const variant of product.variants) {
      const identity = optionIdentity(variant.chinaOption || variant.saleOption);
      if (!variantByIdentity.has(identity)) {
        existing.variants.push({ ...variant });
        variantByIdentity.set(identity, variant);
      }
    }
    existing.productName ||= product.productName;
    existing.supplierName ||= product.supplierName;
  }
  return [...merged.values()];
}

export const OWNER_MANUAL_SOURCING_PRESETS: ManualSourcingCandidatePreset[] = [
  {
    sourceUrl: offerUrl("673212748487"),
    productName: "강아지바운서",
    supplierName: "",
    variants: [{
      saleOption: "단품 그레이",
      chinaOption: "单网灰色 大包装】10个起拍",
      storageSize: "",
      unitPriceCny: null,
      moq: null,
    }],
  },
  {
    sourceUrl: offerUrl("923615736263"),
    productName: "캔압축기",
    supplierName: "",
    variants: [{
      saleOption: "단품 그레이",
      chinaOption: "深空灰压罐器",
      storageSize: "",
      unitPriceCny: null,
      moq: null,
    }],
  },
  {
    sourceUrl: offerUrl("1043324736129"),
    productName: "돌돌이 신발 한켤레 세탁망",
    supplierName: "",
    variants: [{
      saleOption: "단품 그레이",
      chinaOption: "【升级双舱高密绒】白色",
      storageSize: "",
      unitPriceCny: null,
      moq: null,
    }],
  },
  {
    sourceUrl: offerUrl("831359527999"),
    productName: "실리콘 세탁망",
    supplierName: "",
    variants: [
      {
        saleOption: "신발 세탁망 · 색상랜덤",
        chinaOption: "白色-鞋子款",
        storageSize: "",
        unitPriceCny: null,
        moq: null,
      },
      {
        saleOption: "브라 세탁망 · 색상랜덤",
        chinaOption: "粉色-扣子款【赠洗衣球】",
        storageSize: "",
        unitPriceCny: null,
        moq: null,
      },
    ],
  },
  {
    sourceUrl: offerUrl("817041594793"),
    productName: "귀세우기 테이프 60개입",
    supplierName: "",
    variants: [{
      saleOption: "단품",
      chinaOption: "透明 精灵耳贴【硅胶】,60贴袋装",
      storageSize: "",
      unitPriceCny: null,
      moq: null,
    }],
  },
  {
    sourceUrl: offerUrl("668850156055"),
    productName: "지압양말세트",
    supplierName: "",
    variants: [
      {
        saleOption: "남성용1쌍과 지압봉",
        chinaOption: "男袜+按摩棒",
        storageSize: "",
        unitPriceCny: null,
        moq: null,
      },
      {
        saleOption: "여성용1쌍과 지압봉",
        chinaOption: "女袜+按摩棒",
        storageSize: "",
        unitPriceCny: null,
        moq: null,
      },
    ],
  },
];

export function manualPilotCandidatesAsPresets(
  candidates: ManualPilotCatalogCandidate[],
): ManualSourcingCandidatePreset[] {
  const grouped = new Map<string, ManualSourcingCandidatePreset>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.sourceUrl) ?? {
      sourceUrl: candidate.sourceUrl,
      productName: candidate.canonicalNameKo,
      supplierName: "",
      variants: [],
    };
    for (const variant of candidate.variants) {
      current.variants.push({
        saleOption: variant.saleOption || "기준 옵션",
        chinaOption: variant.chinaOption,
        storageSize: variant.defaultStorageSize ?? "",
        unitPriceCny: variant.unitPriceCny,
        moq: candidate.moq,
      });
    }
    grouped.set(candidate.sourceUrl, current);
  }
  return [...grouped.values()];
}
