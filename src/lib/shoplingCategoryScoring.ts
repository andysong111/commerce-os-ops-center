export type ShoplingCategoryEntryLike = {
  depth: number;
  path: string;
  names: string[];
  codes: string[];
};

export type ProductCategoryInput = {
  itemId: string;
  modelNumber: string;
  productName: string;
  optionLabels: string[];
  currentCategory: string;
  chinaProductLinks: string[];
};

export type CategoryCandidate = {
  path: string;
  score: number;
  intentMatched?: boolean;
  evidence?: string[];
  matchKind?: "intent" | "market" | "core" | "context";
};

export type ShoplingCategorySearchProfile = {
  itemId?: string;
  coreProductTerms: string[];
  contextTerms: string[];
  ignoredAttributes: string[];
  catalogCategoryTerms?: string[];
  productFormTerms?: string[];
  incompatibleCategoryTerms?: string[];
  blockedCategoryTerms?: string[];
  marketCategoryPaths?: string[];
  marketEvidenceSummary?: string;
  marketEvidenceConfidence?: number;
  sourceDomains?: string[];
  groundingStatus?: "web" | "model_fallback";
};

export type ShoplingCategoryIntent = {
  key: string;
  coreTerm: string;
  relatedTerms: string[];
  blockedTerms: string[];
  rationale: string;
};

const MAX_PRODUCTS = 25;
const MAX_CANDIDATES = 18;
const AUTO_APPLY_CONFIDENCE = 90;

const GENERIC_CATEGORY_TERMS = new Set(
  [
    "기타",
    "상품",
    "제품",
    "용품",
    "소품",
    "액세서리",
    "생활",
    "건강",
    "패션",
    "쇼핑",
  ].map((value) => value.toLocaleLowerCase("ko-KR")),
);

const NON_BLOCKABLE_CATEGORY_TERMS = GENERIC_CATEGORY_TERMS;

const PRODUCT_MATERIAL_TERMS = new Set(
  [
    "실리콘",
    "스텐",
    "스테인리스",
    "철제",
    "메탈",
    "아연",
    "가죽",
    "우드",
    "극세사",
    "니트",
    "벨벳",
    "스펀지",
    "플라스틱",
  ].map((value) => value.toLocaleLowerCase("ko-KR")),
);

const INTENT_RULES: readonly ShoplingCategoryIntent[] = [
  {
    key: "thimble",
    coreTerm: "골무",
    relatedTerms: [
      "골무",
      "바느질",
      "재봉",
      "수예",
      "봉제",
      "재봉용품",
      "수예용품",
      "바느질용품",
      "손가락보호",
      "손가락 보호",
      "손가락보호대",
      "보호대",
      "공예",
    ],
    blockedTerms: [
      "타이즈",
      "스타킹",
      "내의",
      "레깅스",
      "양말",
      "속옷",
      "수영복",
      "의류",
      "축구",
      "야구",
      "골프",
      "헬멧",
      "투구",
    ],
    rationale:
      "결합 모델명에 다른 단어가 붙어 있어도 제품 핵심명사 '골무'를 우선하고 수예·재봉·손가락 보호 계열만 후보로 사용합니다.",
  },
] as const;

const PRODUCT_TOKEN_STOPWORDS = new Set(
  [
    "단품",
    "세트",
    "랜덤",
    "색상랜덤",
    "옵션",
    "상품",
    "제품",
    "신형",
    "일반",
    "기본",
    "대형",
    "중형",
    "소형",
    "사이즈",
    "색상",
    "컬러",
    "개입",
    "개세트",
    "포함",
    "케이스포함",
    "블랙",
    "화이트",
    "그레이",
    "회색",
    "실버",
    "골드",
    "레드",
    "블루",
    "핑크",
    "그린",
    "옐로우",
    "퍼플",
    "보라",
    "브라운",
    "베이지",
    "오렌지",
    "주황",
    "네이비",
    "아이보리",
    "투명",
    "반투명",
    "무지",
    "실리콘",
    "스텐",
    "스테인리스",
    "철제",
    "메탈",
    "아연",
    "가죽",
    "우드",
    "극세사",
    "니트",
    "벨벳",
    "스펀지",
    "플라스틱",
  ].map((value) => value.toLocaleLowerCase("ko-KR")),
);

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function tokens(value: unknown) {
  return (
    text(value)
      .toLocaleLowerCase("ko-KR")
      .match(/[0-9a-z가-힣]{2,}/g) ?? []
  );
}

function bigrams(value: unknown) {
  const source = compact(value);
  const result = new Set<string>();
  for (let index = 0; index < source.length - 1; index += 1) {
    result.add(source.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function canAutoApplyShoplingCategory(options: {
  confidence: number;
  currentCategory: string;
  matchKind: CategoryCandidate["matchKind"] | "none";
}) {
  return (
    !text(options.currentCategory) &&
    options.confidence >= AUTO_APPLY_CONFIDENCE &&
    options.matchKind !== "market" &&
    options.matchKind !== "context" &&
    options.matchKind !== "none"
  );
}

export function calibrateShoplingCategoryConfidence(options: {
  confidence: number;
  matchKind: CategoryCandidate["matchKind"] | "none";
  profile?: ShoplingCategorySearchProfile | null;
}) {
  let confidence = Math.max(
    0,
    Math.min(100, Math.round(Number(options.confidence) || 0)),
  );
  if (options.matchKind === "context") confidence = Math.min(confidence, 64);
  if (options.matchKind === "market") {
    const evidenceConfidence = Math.max(
      0,
      Math.min(
        100,
        Math.round(Number(options.profile?.marketEvidenceConfidence) || 0),
      ),
    );
    confidence = Math.min(confidence, evidenceConfidence || 55);
  }
  if (options.profile?.groundingStatus !== "web") {
    confidence = Math.min(confidence, 79);
  }
  return confidence;
}

export function normalizeShoplingCategorySearchProfiles(
  value: unknown,
  inputs: readonly Pick<ProductCategoryInput, "itemId">[],
): ShoplingCategorySearchProfile[] {
  if (!Array.isArray(value)) {
    throw new Error("OpenAI 모델명 분석 결과 형식이 올바르지 않습니다.");
  }
  const expectedIds = new Set(inputs.map((input) => input.itemId));
  const byId = new Map<string, ShoplingCategorySearchProfile>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const itemId = text(row.itemId);
    if (!expectedIds.has(itemId) || byId.has(itemId)) continue;
    byId.set(itemId, {
      itemId,
      coreProductTerms: normalizeProfileTerms(row.coreProductTerms, 6),
      contextTerms: normalizeProfileTerms(row.contextTerms, 6),
      ignoredAttributes: normalizeProfileTerms(row.ignoredAttributes, 10),
      ...(Array.isArray(row.catalogCategoryTerms)
        ? {
            catalogCategoryTerms: normalizeProfileTerms(
              row.catalogCategoryTerms,
              10,
            ),
          }
        : {}),
      ...(Array.isArray(row.productFormTerms)
        ? {
            productFormTerms: normalizeProfileTerms(row.productFormTerms, 8),
          }
        : {}),
      ...(Array.isArray(row.incompatibleCategoryTerms)
        ? {
            incompatibleCategoryTerms: normalizeBlockedCategoryTerms(
              row.incompatibleCategoryTerms,
            ),
          }
        : {}),
      ...(Array.isArray(row.blockedCategoryTerms)
        ? {
            blockedCategoryTerms: normalizeBlockedCategoryTerms(
              row.blockedCategoryTerms,
            ),
          }
        : {}),
      ...(Array.isArray(row.marketCategoryPaths)
        ? {
            marketCategoryPaths: normalizeProfilePaths(
              row.marketCategoryPaths,
              4,
            ),
          }
        : {}),
      ...(typeof row.marketEvidenceSummary === "string"
        ? {
            marketEvidenceSummary: text(row.marketEvidenceSummary).slice(
              0,
              240,
            ),
          }
        : {}),
      ...(Number.isFinite(Number(row.marketEvidenceConfidence))
        ? {
            marketEvidenceConfidence: Math.max(
              0,
              Math.min(100, Math.round(Number(row.marketEvidenceConfidence))),
            ),
          }
        : {}),
      ...(Array.isArray(row.sourceDomains)
        ? { sourceDomains: normalizeSourceDomains(row.sourceDomains) }
        : {}),
      ...(row.groundingStatus === "web" ||
      row.groundingStatus === "model_fallback"
        ? { groundingStatus: row.groundingStatus }
        : {}),
    });
  }
  const ordered = inputs.map((input) => byId.get(input.itemId));
  if (ordered.some((profile) => !profile)) {
    throw new Error("일부 상품의 모델명 핵심명사 분석 결과가 누락되었습니다.");
  }
  return ordered as ShoplingCategorySearchProfile[];
}

function normalizeProfileTerms(value: unknown, limit: number) {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = text(raw).slice(0, 40);
    const key = compact(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeProfilePaths(value: unknown, limit: number) {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = text(raw).slice(0, 240);
    const key = compact(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeBlockedCategoryTerms(value: unknown) {
  return normalizeProfileTerms(value, 12).filter((term) => {
    const normalized = compact(term);
    return normalized.length >= 2 && !NON_BLOCKABLE_CATEGORY_TERMS.has(normalized);
  });
}

function normalizeSourceDomains(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = text(raw)
      .toLocaleLowerCase("en-US")
      .replace(/^www\./, "")
      .slice(0, 120);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 8) break;
  }
  return result;
}

export function inferShoplingCategoryIntent(
  input: Pick<ProductCategoryInput, "productName" | "optionLabels">,
): ShoplingCategoryIntent | null {
  const source = compact([input.productName, ...input.optionLabels].join(" "));
  if (!source) return null;
  return (
    INTENT_RULES.find((rule) => source.includes(compact(rule.coreTerm))) ?? null
  );
}

export function inferShoplingCoreProductTerms(
  input: Pick<ProductCategoryInput, "productName" | "optionLabels">,
  categories: ShoplingCategoryEntryLike[],
  profile?: ShoplingCategorySearchProfile | null,
): string[] {
  const modelTokens = tokens(input.productName).filter(isMeaningfulProductToken);
  const optionTokens = input.optionLabels
    .flatMap((value) => tokens(value))
    .filter(isMeaningfulProductToken);
  const pathCompacts = categories.map((entry) => ({
    path: compact(entry.path),
    leaf: compact(entry.path.split(">").at(-1)),
  }));
  const ignored = new Set(
    (profile?.ignoredAttributes ?? []).map(compact).filter(Boolean),
  );
  const isAllowed = (value: string) => {
    const normalized = compact(value);
    return normalized && !ignored.has(normalized) && isMeaningfulProductToken(value);
  };
  const isAllowedProfileTerm = (value: string) => {
    const normalized = compact(value);
    return (
      normalized.length >= 2 &&
      !ignored.has(normalized) &&
      !isNonProductVariant(normalized) &&
      (isMeaningfulProductToken(value) || PRODUCT_MATERIAL_TERMS.has(normalized))
    );
  };

  const unique: string[] = [];
  const addSupported = (
    value: string,
    fromProfile = false,
    maxTerms = 1,
  ) => {
    if (!(fromProfile ? isAllowedProfileTerm(value) : isAllowed(value))) {
      return false;
    }
    const candidates = supportedCatalogTerms(
      value,
      pathCompacts,
      fromProfile && PRODUCT_MATERIAL_TERMS.has(compact(value)),
      false,
      fromProfile,
    ).slice(0, Math.max(1, maxTerms));
    if (!candidates.length) return false;
    for (const candidate of candidates) {
      if (!unique.includes(candidate.term)) unique.push(candidate.term);
      if (unique.length >= 8) break;
    }
    return true;
  };

  // AI expands the model name into retail taxonomy synonyms. Keep several
  // catalog-supported anchors from each semantic phrase instead of only the
  // final suffix. This preserves taxonomy words such as 조류/두피/세안/수예
  // even when the same phrase also contains generic nouns like 안경/브러시/도구.
  for (const value of profile?.coreProductTerms ?? []) {
    addSupported(value, true, 3);
    if (unique.length >= 8) break;
  }

  // Korean product compounds normally end with the head noun. Inspect the
  // model name from right to left after attributes have been removed, and use
  // one catalog-supported head noun instead of accumulating modifiers.
  let modelTermFound = false;
  for (let index = modelTokens.length - 1; index >= 0; index -= 1) {
    if (addSupported(modelTokens[index])) {
      modelTermFound = true;
      break;
    }
  }
  if (!modelTermFound) {
    for (let index = optionTokens.length - 1; index >= 0; index -= 1) {
      if (addSupported(optionTokens[index])) break;
    }
  }
  return unique.slice(0, 8);
}

function inferShoplingContextTerms(
  input: Pick<ProductCategoryInput, "productName" | "optionLabels">,
  categories: ShoplingCategoryEntryLike[],
  profile: ShoplingCategorySearchProfile | null | undefined,
  coreTerms: string[],
) {
  const pathCompacts = categories.map((entry) => ({
    path: compact(entry.path),
    leaf: compact(entry.path.split(">").at(-1)),
  }));
  const ignored = new Set(
    (profile?.ignoredAttributes ?? []).map(compact).filter(Boolean),
  );
  const sources = [
    ...(profile?.contextTerms ?? []),
    ...tokens(input.productName),
    ...input.optionLabels.flatMap((value) => tokens(value)),
  ].filter((value) => {
    const normalized = compact(value);
    return normalized && !ignored.has(normalized) && isMeaningfulProductToken(value);
  });
  const ranked = sources
    .flatMap((value) =>
      supportedCatalogTerms(
        value,
        pathCompacts,
        false,
        false,
        true,
      ).slice(0, 3),
    )
    .filter((candidate) => !coreTerms.includes(candidate.term))
    .sort(
      (left, right) =>
        right.term.length - left.term.length ||
        right.leafCount - left.leafCount ||
        left.pathCount - right.pathCount ||
        left.term.localeCompare(right.term, "ko-KR"),
    );
  return [...new Set(ranked.map((candidate) => candidate.term))].slice(0, 8);
}

export function inferShoplingMarketCategoryTerms(
  categories: ShoplingCategoryEntryLike[],
  profile?: ShoplingCategorySearchProfile | null,
) {
  const pathCompacts = categories.map((entry) => ({
    path: compact(entry.path),
    leaf: compact(entry.path.split(">").at(-1)),
  }));
  const sources = [
    ...(profile?.catalogCategoryTerms ?? []),
    ...(profile?.marketCategoryPaths ?? []).flatMap((path) =>
      path.split(/[>›]/g).map(text).filter(Boolean),
    ),
  ];
  const unique: string[] = [];
  for (const value of sources) {
    const candidates = supportedCatalogTerms(
      value,
      pathCompacts,
      false,
      true,
      true,
    ).slice(0, 4);
    for (const candidate of candidates) {
      if (unique.includes(candidate.term)) continue;
      unique.push(candidate.term);
      if (unique.length >= 10) break;
    }
    if (unique.length >= 10) break;
  }
  return unique;
}

function profileBlockedCategoryTerms(
  profile: ShoplingCategorySearchProfile | null | undefined,
) {
  const positiveTerms = [
    ...(profile?.coreProductTerms ?? []),
    ...(profile?.contextTerms ?? []),
    ...(profile?.catalogCategoryTerms ?? []),
    ...(profile?.productFormTerms ?? []),
    ...(profile?.marketCategoryPaths ?? []).flatMap((path) =>
      path.split(/[>›]/g),
    ),
  ]
    .map(compact)
    .filter(Boolean);
  return [
    ...(profile?.blockedCategoryTerms ?? []),
    ...(profile?.incompatibleCategoryTerms ?? []),
  ]
    .map((term) => ({ term, key: compact(term) }))
    .filter(
      ({ key }) =>
        key &&
        !NON_BLOCKABLE_CATEGORY_TERMS.has(key) &&
        !positiveTerms.some(
          (positive) => positive.includes(key) || key.includes(positive),
        ),
    );
}

function supportedCatalogTerms(
  value: string,
  pathCompacts: Array<{ path: string; leaf: string }>,
  allowMaterialTerm = false,
  rejectGenericSuffix = false,
  includeSemanticAnchors = false,
) {
  const searchTerms = includeSemanticAnchors
    ? semanticCatalogSearchTerms(value, allowMaterialTerm)
    : suffixTerms(value, allowMaterialTerm);
  return searchTerms
    .filter(
      (term) => !rejectGenericSuffix || !GENERIC_CATEGORY_TERMS.has(term),
    )
    .map((term) => {
      let pathCount = 0;
      let leafCount = 0;
      for (const category of pathCompacts) {
        if (!category.path.includes(term)) continue;
        pathCount += 1;
        if (category.leaf.includes(term)) leafCount += 1;
      }
      return { term, pathCount, leafCount };
    })
    .filter((candidate) => candidate.pathCount > 0)
    .sort(
      (left, right) =>
        right.term.length - left.term.length ||
        right.leafCount - left.leafCount ||
        left.pathCount - right.pathCount ||
        left.term.localeCompare(right.term, "ko-KR"),
    );
}

function isMeaningfulProductToken(value: string) {
  const normalized = compact(value);
  if (normalized.length < 2) return false;
  if (PRODUCT_TOKEN_STOPWORDS.has(normalized)) return false;
  return !isNonProductVariant(normalized);
}

function isNonProductVariant(normalized: string) {
  if (normalized.endsWith("포함")) return true;
  if (normalized.endsWith("사이즈")) return true;
  if (/^[smlx]{1,4}$/.test(normalized)) return true;
  if (/^[a-z](?:형|타입|사이즈)?$/i.test(normalized)) return true;
  if (/^\d+(?:p|pcs?|개)?세트$/i.test(normalized)) return true;
  if (/^\d+(?:g|kg|ml|l|cm|mm|m|호|단|구|색|종|개|쌍|p|pcs?)?$/.test(normalized)) return true;
  if (/^[a-z]{0,3}\d+[a-z0-9-]*$/.test(normalized)) return true;
  return false;
}

function semanticCatalogSearchTerms(
  value: string,
  allowMaterialTerm = false,
) {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const key = compact(raw);
    if (key.length < 2 || seen.has(key)) return;
    if (
      GENERIC_CATEGORY_TERMS.has(key) ||
      (PRODUCT_TOKEN_STOPWORDS.has(key) &&
        !(allowMaterialTerm && PRODUCT_MATERIAL_TERMS.has(key)))
    ) {
      return;
    }
    seen.add(key);
    result.push(key);
  };

  // Preserve the existing exact/suffix matches first.
  for (const term of suffixTerms(value, allowMaterialTerm)) add(term);

  // Semantic profile values are often phrases ("조류 사육용품",
  // "두피 세정 브러시"). Their important taxonomy anchor can be the first
  // token rather than the final suffix, so retain every meaningful token.
  for (const token of tokens(value)) {
    add(token);
    const key = compact(token);
    for (const suffix of [
      "관리용품",
      "용품",
      "브러쉬",
      "브러시",
      "도구",
      "액세서리",
      "소품",
      "마사지기",
      "관리기",
    ]) {
      if (!key.endsWith(suffix) || key.length <= suffix.length + 1) continue;
      add(key.slice(0, -suffix.length));
    }
  }

  return result;
}

function suffixTerms(value: string, allowMaterialTerm = false) {
  const normalized = compact(value).replace(
    /(?:[a-z]|\d+)(?:형|타입|사이즈)$/i,
    "",
  );
  const result: string[] = [];
  const maximum = Math.min(12, normalized.length);
  for (let length = maximum; length >= 2; length -= 1) {
    const candidate = normalized.slice(-length);
    if (
      !candidate ||
      (PRODUCT_TOKEN_STOPWORDS.has(candidate) &&
        !(allowMaterialTerm && PRODUCT_MATERIAL_TERMS.has(candidate)))
    ) {
      continue;
    }
    if (candidate.endsWith("사이즈")) continue;
    if (/^\d+$/.test(candidate)) continue;
    result.push(candidate);
  }
  return result;
}

export function scoreShoplingCategoryCandidate(
  productText: string,
  categoryPath: string,
) {
  const productCompact = compact(productText);
  const pathCompact = compact(categoryPath);
  const leaf = text(categoryPath.split(">").at(-1));
  const leafCompact = compact(leaf);
  let score = 0;
  if (leafCompact && productCompact.includes(leafCompact)) score += 30;
  if (productCompact && pathCompact.includes(productCompact)) score += 20;
  for (const token of new Set(tokens(productText))) {
    const key = compact(token);
    if (key.length < 2) continue;
    if (leafCompact.includes(key)) score += 8;
    else if (pathCompact.includes(key)) score += 4;
  }
  for (const token of new Set(tokens(categoryPath))) {
    const key = compact(token);
    if (key.length >= 2 && productCompact.includes(key)) score += 5;
  }
  score += jaccard(bigrams(productText), bigrams(leaf)) * 18;
  score += jaccard(bigrams(productText), bigrams(categoryPath)) * 7;
  return Number(score.toFixed(4));
}

function scoreIntent(
  categoryPath: string,
  intent: ShoplingCategoryIntent | null,
) {
  if (!intent) {
    return { score: 0, matched: false, blocked: false, evidence: [] as string[] };
  }
  const pathCompact = compact(categoryPath);
  const leafCompact = compact(categoryPath.split(">").at(-1));
  const evidence: string[] = [];
  let intentScore = 0;

  for (const blockedTerm of intent.blockedTerms) {
    const key = compact(blockedTerm);
    if (key && pathCompact.includes(key)) {
      return {
        score: -1_000,
        matched: false,
        blocked: true,
        evidence: [`차단:${blockedTerm}`],
      };
    }
  }

  for (const [index, relatedTerm] of intent.relatedTerms.entries()) {
    const key = compact(relatedTerm);
    if (!key || !pathCompact.includes(key)) continue;
    const isCore = key === compact(intent.coreTerm);
    const leafMatch = leafCompact.includes(key);
    const weight = isCore ? 260 : index <= 3 ? 150 : index <= 7 ? 110 : 70;
    intentScore += weight + (leafMatch ? 45 : 0);
    evidence.push(relatedTerm);
  }

  return {
    score: intentScore,
    matched: evidence.length > 0,
    blocked: false,
    evidence,
  };
}

export function shortlistShoplingCategories(
  input: ProductCategoryInput,
  categories: ShoplingCategoryEntryLike[],
  limit = MAX_CANDIDATES,
  profile?: ShoplingCategorySearchProfile | null,
): CategoryCandidate[] {
  const productText = [
    input.productName,
    ...input.optionLabels,
    input.modelNumber,
    ...(profile?.coreProductTerms ?? []),
    ...(profile?.contextTerms ?? []),
    ...(profile?.catalogCategoryTerms ?? []),
    ...(profile?.productFormTerms ?? []),
    ...(profile?.marketCategoryPaths ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const intent = inferShoplingCategoryIntent(input);
  const coreTerms = inferShoplingCoreProductTerms(input, categories, profile);
  const contextTerms = inferShoplingContextTerms(
    input,
    categories,
    profile,
    coreTerms,
  );
  const marketTerms = inferShoplingMarketCategoryTerms(categories, profile);
  const blockedCategoryTerms = profileBlockedCategoryTerms(profile);
  const ranked = categories
    .map((entry) => {
      const baseScore = scoreShoplingCategoryCandidate(productText, entry.path);
      const intentResult = scoreIntent(entry.path, intent);
      const pathCompact = compact(entry.path);
      const leafCompact = compact(entry.path.split(">").at(-1));
      const profileBlockedTerm = blockedCategoryTerms.find(({ key }) =>
        pathCompact.includes(key),
      );
      const matchedMarketTerms = marketTerms.filter((term) =>
        pathCompact.includes(term),
      );
      const matchedCoreTerms = coreTerms.filter((term) => pathCompact.includes(term));
      const matchedContextTerms = contextTerms.filter((term) => pathCompact.includes(term));
      const marketMatched = matchedMarketTerms.length > 0;
      const coreMatched = matchedCoreTerms.length > 0;
      const contextMatched = matchedContextTerms.length > 0;
      const marketBonus = matchedMarketTerms.reduce(
        (total, term) =>
          total + 330 + term.length * 16 + (leafCompact.includes(term) ? 90 : 0),
        0,
      );
      const coreBonus = matchedCoreTerms.reduce(
        (total, term) =>
          total + 260 + term.length * 14 + (leafCompact.includes(term) ? 70 : 0),
        0,
      );
      const contextBonus = matchedContextTerms.reduce(
        (total, term) =>
          total + 45 + term.length * 5 + (leafCompact.includes(term) ? 18 : 0),
        0,
      );
      return {
        path: entry.path,
        score: Number(
          (
            baseScore +
            intentResult.score +
            marketBonus +
            coreBonus +
            contextBonus
          ).toFixed(4),
        ),
        intentMatched: intentResult.matched,
        marketMatched,
        coreMatched,
        contextMatched,
        blocked: intentResult.blocked || Boolean(profileBlockedTerm),
        evidence: [
          ...intentResult.evidence,
          ...matchedMarketTerms.map((term) => `시장분류:${term}`),
          ...matchedCoreTerms,
          ...matchedContextTerms,
          ...(profileBlockedTerm ? [`차단:${profileBlockedTerm.term}`] : []),
        ],
      };
    })
    .filter((candidate) => !candidate.blocked)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    );

  const requestedLimit = Math.max(5, Math.min(30, limit));
  if (intent) {
    const matches = ranked
      .filter((candidate) => candidate.intentMatched)
      .map(({ path, score, intentMatched, evidence }) => ({
        path,
        score,
        intentMatched,
        evidence,
        matchKind: "intent" as const,
      }));
    if (matches.length) return diversifyCandidates(matches, requestedLimit);
  }

  if (marketTerms.length) {
    const matches = ranked
      .filter((candidate) => candidate.marketMatched)
      .map(({ path, score, intentMatched, evidence }) => ({
        path,
        score,
        intentMatched,
        evidence,
        matchKind: "market" as const,
      }));
    if (matches.length) return diversifyCandidates(matches, requestedLimit);
  }

  if (coreTerms.length) {
    const matches = ranked
      .filter((candidate) => candidate.coreMatched)
      .map(({ path, score, intentMatched, evidence }) => ({
        path,
        score,
        intentMatched,
        evidence,
        matchKind: "core" as const,
      }));
    if (matches.length) return diversifyCandidates(matches, requestedLimit);
  }

  if (contextTerms.length) {
    const matches = ranked
      .filter((candidate) => candidate.contextMatched)
      .map(({ path, score, intentMatched, evidence }) => ({
        path,
        score,
        intentMatched,
        evidence,
        matchKind: "context" as const,
      }));
    if (matches.length) return diversifyCandidates(matches, requestedLimit);
  }

  // A category without any product-identity or category-context evidence is
  // less useful than an empty review result. Never fall back to color, size,
  // material, or coincidental character overlap.
  return [];
}

function diversifyCandidates<T extends CategoryCandidate>(
  ranked: T[],
  limit: number,
) {
  if (ranked.length <= limit) return ranked;
  const result: T[] = [];
  const used = new Set<string>();
  const representedBranches = new Set<string>();
  const add = (candidate: T) => {
    if (used.has(candidate.path) || result.length >= limit) return;
    used.add(candidate.path);
    representedBranches.add(text(candidate.path.split(">")[0]));
    result.push(candidate);
  };

  for (const candidate of ranked.slice(0, Math.min(6, limit))) add(candidate);
  for (const candidate of ranked) {
    const branch = text(candidate.path.split(">")[0]);
    if (!representedBranches.has(branch)) add(candidate);
  }
  for (const candidate of ranked) add(candidate);
  return result;
}

export function parseProductCategoryInputs(value: unknown): ProductCategoryInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI 카테고리 요청 형식이 올바르지 않습니다.");
  }
  const source = value as { items?: unknown };
  if (!Array.isArray(source.items) || !source.items.length) {
    throw new Error("AI 카테고리를 설정할 상품을 선택하세요.");
  }
  if (source.items.length > MAX_PRODUCTS) {
    throw new Error(`AI 카테고리는 한 번에 최대 ${MAX_PRODUCTS}개까지 처리합니다.`);
  }
  return source.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${index + 1}번째 상품 형식이 올바르지 않습니다.`);
    }
    const row = raw as Record<string, unknown>;
    const itemId = text(row.itemId ?? row.id);
    const modelNumber = text(row.modelNumber).slice(0, 80);
    const productName = text(row.productName).slice(0, 240);
    if (!itemId || !productName) {
      throw new Error(`${index + 1}번째 상품의 ID와 모델명이 필요합니다.`);
    }
    return {
      itemId,
      modelNumber,
      productName,
      optionLabels: Array.isArray(row.optionLabels)
        ? row.optionLabels.map(text).filter(Boolean).slice(0, 30)
        : [],
      currentCategory: text(row.currentCategory).slice(0, 300),
      chinaProductLinks: Array.isArray(row.chinaProductLinks)
        ? row.chinaProductLinks.map(text).filter(Boolean).slice(0, 5)
        : [],
    };
  });
}
