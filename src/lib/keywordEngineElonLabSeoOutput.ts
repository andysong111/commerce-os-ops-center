export const KEYWORD_ELON_SEO_SEARCH_LIMIT = 10;
export const KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT = 50;
export const KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT = 36;
export const KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT = 30;
export const KEYWORD_ELON_SEO_FORBIDDEN_TERMS = [
  "도매",
  "대량",
  "납품",
  "바이칸",
] as const;
export const KEYWORD_ELON_SEO_NOISE_TERMS = [
  "제조지",
  "원산지",
  "중국",
  "광동",
  "광동성",
  "포장단위",
  "판매단위",
  "박스수량",
  "최소주문",
  "상품코드",
  "색상옵션",
  "사이즈옵션",
  "규격표기",
] as const;

export type KeywordElonSeoIdentity = {
  koreanProductIdentity?: string;
  coreProduct?: string;
  identityAnchor?: string;
  primarySeeds?: string[];
  conditionalSeeds?: string[];
  functionModifiers?: string[];
  designShapeModifiers?: string[];
  specAttributes?: string[];
};

export type KeywordElonSeoCandidate = {
  keyword?: string;
  searchKey?: string;
  searchKeyword?: string;
  relevance?: number;
  shoppingIntent?: number;
  specificity?: number;
  qualityScore?: number;
  totalSearch?: number | null;
  titleEligible?: boolean;
};

export type KeywordElonSeoMarket = {
  productGroup: string;
  groupSuffix: string;
  productGroupType: string;
  marketName: string;
  mallType: string;
  mallKey: string;
  accountIdLabel: string;
};

export type KeywordElonSeoTitleResult = {
  title?: string;
  usedKeywords?: string[];
};

export type KeywordElonSeoKeywordOrigin = "step4" | "step4_pair";

export type KeywordElonSeoSearchKeyword = {
  keyword: string;
  origin: KeywordElonSeoKeywordOrigin;
  sourceMaterials: string[];
  score: number;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  qualityScore: number;
  demandScore: number;
  totalSearch: number | null;
};

export type KeywordElonSeoModelNameSource =
  | "core_product"
  | "identity_compact"
  | "step4_specific"
  | "fallback";

export type KeywordElonSeoGroupStrategy = {
  productGroup: string;
  label: string;
  description: string;
  variantLimit: number;
  maxTerms: number;
  modelPosition: "first" | "after_lead";
};

export type KeywordElonSeoMallTitle = {
  productGroup: string;
  groupSuffix: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  byteLength: number;
  modelName: string;
  usedMaterials: string[];
  keywordMaterials: string[];
  strategyLabel: string;
  variantIndex: number;
};

export type KeywordElonSeoPackage = {
  status: "ready" | "needs_more_keywords";
  modelName: string;
  modelNameSource: KeywordElonSeoModelNameSource;
  modelNameByteLength: number;
  modelNameCoverageCount: number;
  commonSearchKeywords: string[];
  commonSearchLine: string;
  searchKeywordDetails: KeywordElonSeoSearchKeyword[];
  sourceMaterialCount: number;
  marketDerivedKeywordCount: number;
  generatedFallbackKeywordCount: number;
  externalMaterialCount: number;
  allowedMaterialCount: number;
  filteredNoiseMaterialCount: number;
  titleByteLimit: number;
  groupStrategies: KeywordElonSeoGroupStrategy[];
  mallTitles: KeywordElonSeoMallTitle[];
  uniqueTitleCount: number;
  warnings: string[];
};

export type KeywordElonSeoPackageInput = {
  identity: KeywordElonSeoIdentity;
  candidates: KeywordElonSeoCandidate[];
  allowedKeys: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
  titleResult?: KeywordElonSeoTitleResult | null;
};

type KeywordRole = "anchor" | "exact" | "form" | "modifier" | "generic";
type GroupStrategyInternal = KeywordElonSeoGroupStrategy & {
  rank: (keyword: KeywordElonSeoSearchKeyword, input: KeywordElonSeoPackageInput) => number;
};
type TitleBuild = {
  title: string;
  usedMaterials: string[];
  keywordMaterials: string[];
};

const FORM_ONLY_TERMS = new Set([
  "테이프",
  "스티커",
  "패치",
  "브러시",
  "브러쉬",
  "솔",
  "도구",
  "용품",
  "세트",
  "커버",
  "케이스",
  "수납함",
  "정리함",
  "서랍",
  "수납장",
  "거치대",
  "보관함",
  "모자",
  "캡",
  "운동화",
  "신발",
  "골무",
  "압출기",
  "천공기",
  "주걱",
  "헤라",
]);

const MODIFIER_ONLY_TERMS = new Set([
  "붙이는",
  "부착",
  "부착형",
  "조절",
  "조절식",
  "접이식",
  "휴대용",
  "미니",
  "소형",
  "대형",
  "콧대",
  "콧등",
]);

const GENERIC_MODEL_NAMES = new Set([
  "상품",
  "제품",
  "용품",
  "도구",
  "세트",
  ...FORM_ONLY_TERMS,
]);

const MODEL_NOUN_SUFFIXES = [
  "청소브러시",
  "청소브러쉬",
  "신발주걱",
  "서랍형수납함",
  "여드름압출기",
  "계란천공기",
  "등산화",
  "운동화",
  "수납함",
  "수납장",
  "정리함",
  "신발주걱",
  "썬캡",
  "챙모자",
  "압출기",
  "천공기",
  "브러시",
  "브러쉬",
  "스티커",
  "테이프",
  "패치",
  "골무",
  "모자",
  "주걱",
  "헤라",
];

function normalizedText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function keywordElonSeoCanonical(value: unknown) {
  return normalizedText(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

export function keywordElonSeoUtf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function number100(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function candidateText(row: KeywordElonSeoCandidate) {
  return normalizedText(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateKey(row: KeywordElonSeoCandidate) {
  return keywordElonSeoCanonical(candidateText(row));
}

function normalizedBlockedKeys(input: KeywordElonSeoPackageInput) {
  return [...new Set([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ].map(keywordElonSeoCanonical).filter((value) => value.length >= 2))];
}

function blocked(value: unknown, blockedKeys: string[]) {
  const key = keywordElonSeoCanonical(value);
  return !key || blockedKeys.some((term) => key.includes(term));
}

function safeSearchTerm(value: unknown, blockedKeys: string[]) {
  const key = keywordElonSeoCanonical(value);
  if (
    key.length < 2
    || blocked(key, blockedKeys)
    || keywordElonSeoUtf8Bytes(key) > KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT
  ) return "";
  return key;
}

function cleanHumanPhrase(value: unknown) {
  return normalizedText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fitWords(value: unknown, maxBytes: number) {
  const words = cleanHumanPhrase(value).split(/\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    const next = [...selected, word].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.push(word);
  }
  return selected.join(" ");
}

function fitIdentityAroundCore(value: unknown, coreKey: string, maxBytes: number) {
  const words = cleanHumanPhrase(value).split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const coreIndex = words.findIndex((word) => {
    const key = keywordElonSeoCanonical(word);
    return key === coreKey || key.includes(coreKey) || coreKey.includes(key);
  });
  if (coreIndex < 0) return fitWords(words.join(" "), maxBytes);

  const selected = [words[coreIndex]];
  for (let index = coreIndex - 1; index >= 0; index -= 1) {
    const next = [words[index], ...selected].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.unshift(words[index]);
  }
  for (let index = coreIndex + 1; index < words.length; index += 1) {
    const next = [...selected, words[index]].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.push(words[index]);
  }
  return selected.join(" ");
}

function humanizeModelKeyword(value: unknown, coreProduct: unknown) {
  const raw = cleanHumanPhrase(value);
  const key = keywordElonSeoCanonical(raw);
  const core = cleanHumanPhrase(coreProduct);
  const coreKey = keywordElonSeoCanonical(core);
  if (!key) return "";

  if (coreKey && key !== coreKey && key.endsWith(coreKey)) {
    const prefix = key.slice(0, -coreKey.length);
    if (prefix.length >= 2) return `${prefix} ${core}`.trim();
  }
  for (const suffix of MODEL_NOUN_SUFFIXES) {
    const suffixKey = keywordElonSeoCanonical(suffix);
    if (key !== suffixKey && key.endsWith(suffixKey)) {
      const prefix = key.slice(0, -suffixKey.length);
      if (prefix.length >= 2) return `${prefix} ${suffix}`.trim();
    }
  }
  return raw;
}

function demandScore(totalSearch: number | null | undefined) {
  const numeric = Number(totalSearch);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.min(100, Math.log10(numeric + 1) * 22));
}

function candidateMetrics(row: KeywordElonSeoCandidate) {
  return {
    relevance: number100(row.relevance),
    shoppingIntent: number100(row.shoppingIntent),
    specificity: number100(row.specificity),
    qualityScore: number100(row.qualityScore),
    demand: demandScore(row.totalSearch),
  };
}

function directPriority(row: KeywordElonSeoCandidate) {
  const metric = candidateMetrics(row);
  return (
    metric.relevance * 0.30
    + metric.qualityScore * 0.25
    + metric.shoppingIntent * 0.18
    + metric.specificity * 0.17
    + metric.demand * 0.10
  );
}

function coreKeys(input: KeywordElonSeoPackageInput) {
  return [
    input.identity.coreProduct,
    input.identity.koreanProductIdentity,
    input.identity.identityAnchor,
  ].map(keywordElonSeoCanonical).filter(Boolean);
}

function exactCoreMatch(keyword: string, input: KeywordElonSeoPackageInput) {
  const key = keywordElonSeoCanonical(keyword);
  return coreKeys(input).some((core) => core === key);
}

function matchesCore(keyword: string, input: KeywordElonSeoPackageInput) {
  const key = keywordElonSeoCanonical(keyword);
  if (!key) return false;
  return coreKeys(input).some((core) => (
    core === key
    || (key.length >= 4 && (core.includes(key) || key.includes(core)))
  ));
}

function keywordRole(
  keyword: KeywordElonSeoSearchKeyword,
  input: KeywordElonSeoPackageInput,
): KeywordRole {
  const key = keywordElonSeoCanonical(keyword.keyword);
  if (exactCoreMatch(key, input)) return "anchor";
  if (FORM_ONLY_TERMS.has(key)) return "form";
  if (MODIFIER_ONLY_TERMS.has(key)) return "modifier";
  if (matchesCore(key, input)) return "anchor";
  if (keyword.origin === "step4_pair") return "exact";
  if (key.length <= 3) return "modifier";
  if (keyword.relevance >= 88 && keyword.specificity >= 65) return "exact";
  return "generic";
}

function directKeywordDetail(
  row: KeywordElonSeoCandidate,
  keyword: string,
): KeywordElonSeoSearchKeyword {
  const metric = candidateMetrics(row);
  return {
    keyword,
    origin: "step4",
    sourceMaterials: [keyword],
    score: directPriority(row) + 12,
    relevance: metric.relevance,
    shoppingIntent: metric.shoppingIntent,
    specificity: metric.specificity,
    qualityScore: metric.qualityScore,
    demandScore: metric.demand,
    totalSearch: Number.isFinite(Number(row.totalSearch)) ? Number(row.totalSearch) : null,
  };
}

function pairRoleBonus(left: KeywordRole, right: KeywordRole) {
  if (["anchor", "exact"].includes(left) && right === "form") return 16;
  if (["anchor", "exact"].includes(left) && right === "modifier") return 12;
  if (["anchor", "exact"].includes(left) && ["anchor", "exact"].includes(right)) return 8;
  if (left === "modifier" && right === "form") return 7;
  if (left === "form" && right === "modifier") return 1;
  return -20;
}

function buildPairKeyword(
  left: KeywordElonSeoSearchKeyword,
  right: KeywordElonSeoSearchKeyword,
  input: KeywordElonSeoPackageInput,
  blockedKeys: string[],
): KeywordElonSeoSearchKeyword | null {
  const leftKey = keywordElonSeoCanonical(left.keyword);
  const rightKey = keywordElonSeoCanonical(right.keyword);
  if (!leftKey || !rightKey || leftKey === rightKey) return null;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return null;

  const roleBonus = pairRoleBonus(keywordRole(left, input), keywordRole(right, input));
  if (roleBonus < 0) return null;
  const keyword = safeSearchTerm(`${leftKey}${rightKey}`, blockedKeys);
  if (!keyword) return null;

  const relevance = Math.min(left.relevance, right.relevance);
  const shoppingIntent = (left.shoppingIntent + right.shoppingIntent) / 2;
  const specificity = Math.min(100, (left.specificity + right.specificity) / 2 + 8);
  const qualityScore = (left.qualityScore + right.qualityScore) / 2;
  const demand = Math.max(left.demandScore, right.demandScore) * 0.65;
  if (relevance < 80 || shoppingIntent < 70) return null;

  return {
    keyword,
    origin: "step4_pair",
    sourceMaterials: [left.keyword, right.keyword],
    score:
      relevance * 0.34
      + qualityScore * 0.20
      + shoppingIntent * 0.16
      + specificity * 0.20
      + demand * 0.10
      + roleBonus,
    relevance,
    shoppingIntent,
    specificity,
    qualityScore,
    demandScore: demand,
    totalSearch: null,
  };
}

function buildSearchKeywords(
  input: KeywordElonSeoPackageInput,
  allowedRows: KeywordElonSeoCandidate[],
  blockedKeys: string[],
) {
  const direct = allowedRows
    .map((row) => {
      const keyword = safeSearchTerm(candidateText(row), blockedKeys);
      return keyword ? directKeywordDetail(row, keyword) : null;
    })
    .filter((row): row is KeywordElonSeoSearchKeyword => Boolean(row))
    .sort((left, right) => right.score - left.score || right.relevance - left.relevance);

  const directMap = new Map<string, KeywordElonSeoSearchKeyword>();
  for (const row of direct) if (!directMap.has(row.keyword)) directMap.set(row.keyword, row);
  const directUnique = [...directMap.values()];

  const pairMap = new Map<string, KeywordElonSeoSearchKeyword>();
  for (const left of directUnique) {
    for (const right of directUnique) {
      const pair = buildPairKeyword(left, right, input, blockedKeys);
      const current = pair ? pairMap.get(pair.keyword) : null;
      if (pair && (!current || pair.score > current.score)) pairMap.set(pair.keyword, pair);
    }
  }
  const pairs = [...pairMap.values()].sort(
    (left, right) => right.score - left.score || left.keyword.length - right.keyword.length,
  );

  const selected: KeywordElonSeoSearchKeyword[] = [];
  const seen = new Set<string>();
  const add = (row: KeywordElonSeoSearchKeyword) => {
    if (selected.length >= KEYWORD_ELON_SEO_SEARCH_LIMIT || seen.has(row.keyword)) return;
    seen.add(row.keyword);
    selected.push(row);
  };
  for (const row of directUnique) add(row);
  for (const row of pairs) add(row);

  return {
    details: selected.slice(0, KEYWORD_ELON_SEO_SEARCH_LIMIT),
    sourceMaterialCount: directUnique.length,
  };
}

function longTailScore(keyword: KeywordElonSeoSearchKeyword) {
  const lengthScore = Math.min(100, keywordElonSeoCanonical(keyword.keyword).length * 10);
  return Math.min(100, lengthScore + (keyword.origin === "step4_pair" ? 15 : 0));
}

function genericPenalty(keyword: KeywordElonSeoSearchKeyword, input: KeywordElonSeoPackageInput) {
  return ["form", "modifier", "generic"].includes(keywordRole(keyword, input)) ? 35 : 0;
}

function isSpecificModelName(value: unknown) {
  const key = keywordElonSeoCanonical(value);
  return key.length >= 4 && !GENERIC_MODEL_NAMES.has(key);
}

function resolveModelName(
  input: KeywordElonSeoPackageInput,
  allowedRows: KeywordElonSeoCandidate[],
  blockedKeys: string[],
): { modelName: string; source: KeywordElonSeoModelNameSource } {
  const core = cleanHumanPhrase(input.identity.coreProduct);
  const coreKey = keywordElonSeoCanonical(core);
  const fittedCore = fitWords(core, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
  if (fittedCore && isSpecificModelName(fittedCore) && !blocked(fittedCore, blockedKeys)) {
    return { modelName: fittedCore, source: "core_product" };
  }

  const identityCandidates = [
    input.identity.koreanProductIdentity,
    input.identity.identityAnchor,
  ];
  for (const candidate of identityCandidates) {
    const fitted = fitIdentityAroundCore(candidate, coreKey, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
    if (fitted && isSpecificModelName(fitted) && !blocked(fitted, blockedKeys)) {
      return { modelName: fitted, source: "identity_compact" };
    }
  }

  const ranked = [...allowedRows]
    .filter((row) => !blocked(candidateText(row), blockedKeys))
    .sort((left, right) => {
      const leftMetric = candidateMetrics(left);
      const rightMetric = candidateMetrics(right);
      const leftScore = leftMetric.relevance * 0.45 + leftMetric.specificity * 0.35 + leftMetric.qualityScore * 0.20;
      const rightScore = rightMetric.relevance * 0.45 + rightMetric.specificity * 0.35 + rightMetric.qualityScore * 0.20;
      return rightScore - leftScore;
    });
  for (const row of ranked) {
    const candidate = humanizeModelKeyword(candidateText(row), core);
    const fitted = fitWords(candidate, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
    const key = keywordElonSeoCanonical(fitted);
    const hasProductNoun = Boolean(
      coreKey && (key.includes(coreKey) || coreKey.includes(key))
      || MODEL_NOUN_SUFFIXES.some((suffix) => key.endsWith(keywordElonSeoCanonical(suffix))),
    );
    if (fitted && hasProductNoun && isSpecificModelName(fitted) && !blocked(fitted, blockedKeys)) {
      return { modelName: fitted, source: "step4_specific" };
    }
  }

  const fallback = fittedCore
    || fitWords(input.identity.koreanProductIdentity, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT)
    || fitWords(input.identity.identityAnchor, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT)
    || humanizeModelKeyword(candidateText(ranked[0] ?? {}), core)
    || "상품명 확인 필요";
  return { modelName: fallback, source: "fallback" };
}

const STRATEGY_CONFIGS: Record<string, GroupStrategyInternal> = {
  도매1: {
    productGroup: "도매1",
    label: "대표 정확형",
    description: "자동 모델명을 앞에 고정하고 상품 관련성·구체성이 가장 높은 검색어를 보조로 배치합니다.",
    variantLimit: 2,
    maxTerms: 2,
    modelPosition: "first",
    rank: (keyword, input) => (
      keyword.relevance * 0.45
      + keyword.specificity * 0.30
      + keyword.demandScore * 0.15
      + keyword.shoppingIntent * 0.10
      - genericPenalty(keyword, input)
    ),
  },
  도매2: {
    productGroup: "도매2",
    label: "기능·문제해결형",
    description: "구체 기능 검색어를 먼저 배치하고 자동 모델명을 바로 뒤에 넣어 상품 정체성을 고정합니다.",
    variantLimit: 2,
    maxTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword, input) => (
      keyword.relevance * 0.40
      + keyword.specificity * 0.35
      + keyword.shoppingIntent * 0.15
      + keyword.demandScore * 0.10
      + (keyword.origin === "step4_pair" ? 6 : 0)
      - genericPenalty(keyword, input)
    ),
  },
  도매3: {
    productGroup: "도매3",
    label: "세부 용도·형태형",
    description: "세부 부위·용도·형태 검색어와 자동 모델명을 결합해 다른 도매 그룹의 롱테일을 보완합니다.",
    variantLimit: 2,
    maxTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword, input) => (
      keyword.specificity * 0.42
      + keyword.relevance * 0.35
      + longTailScore(keyword) * 0.13
      + keyword.shoppingIntent * 0.10
      - genericPenalty(keyword, input)
    ),
  },
  도매4: {
    productGroup: "도매4",
    label: "초간결 정확형",
    description: "자동 모델명을 중심으로 가장 정확한 검색어 하나만 더해 짧고 빠르게 식별되는 제목을 만듭니다.",
    variantLimit: 1,
    maxTerms: 1,
    modelPosition: "first",
    rank: (keyword, input) => (
      keyword.relevance * 0.50
      + keyword.specificity * 0.35
      + keyword.qualityScore * 0.15
      - genericPenalty(keyword, input)
    ),
  },
  소매1: {
    productGroup: "소매1",
    label: "검색량·발견형",
    description: "월검색 수요와 쇼핑의도가 높은 구체 검색어를 앞에 두고 자동 모델명으로 상품 정체성을 명확히 합니다.",
    variantLimit: 4,
    maxTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword, input) => (
      keyword.demandScore * 0.35
      + keyword.relevance * 0.35
      + keyword.shoppingIntent * 0.20
      + keyword.specificity * 0.10
      + (keyword.totalSearch !== null ? 5 : 0)
      - genericPenalty(keyword, input)
    ),
  },
  소매2: {
    productGroup: "소매2",
    label: "롱테일·정확형",
    description: "관련성과 구체성이 높은 긴 검색 조합을 앞에 두고 자동 모델명을 결합해 세부 수요를 담당합니다.",
    variantLimit: 2,
    maxTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword, input) => (
      keyword.relevance * 0.40
      + keyword.specificity * 0.25
      + keyword.shoppingIntent * 0.15
      + keyword.demandScore * 0.10
      + longTailScore(keyword) * 0.10
      - genericPenalty(keyword, input)
    ),
  },
};

export const KEYWORD_ELON_SEO_GROUP_STRATEGIES: KeywordElonSeoGroupStrategy[] = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
].map((productGroup) => {
  const strategy = STRATEGY_CONFIGS[productGroup];
  return {
    productGroup: strategy.productGroup,
    label: strategy.label,
    description: strategy.description,
    variantLimit: strategy.variantLimit,
    maxTerms: strategy.maxTerms,
    modelPosition: strategy.modelPosition,
  };
});

function overlaps(left: string, right: string) {
  const leftKey = keywordElonSeoCanonical(left);
  const rightKey = keywordElonSeoCanonical(right);
  if (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;
  return [...FORM_ONLY_TERMS].some((term) => (
    term.length >= 2 && leftKey.includes(term) && rightKey.includes(term)
  ));
}

function composeTitle(
  modelName: string,
  keywords: KeywordElonSeoSearchKeyword[],
  modelPosition: "first" | "after_lead",
) {
  const keywordTexts = keywords.map((row) => row.keyword);
  if (modelPosition === "after_lead" && keywordTexts.length) {
    return [keywordTexts[0], modelName, ...keywordTexts.slice(1)].join(" ");
  }
  return [modelName, ...keywordTexts].join(" ");
}

function fitTitle(
  ordered: KeywordElonSeoSearchKeyword[],
  input: KeywordElonSeoPackageInput,
  modelName: string,
  strategy: GroupStrategyInternal,
): TitleBuild {
  const selected: KeywordElonSeoSearchKeyword[] = [];
  for (const keyword of ordered) {
    if (overlaps(modelName, keyword.keyword)) continue;
    if (selected.some((current) => overlaps(current.keyword, keyword.keyword))) continue;
    if (!selected.length && ["form", "modifier", "generic"].includes(keywordRole(keyword, input))) continue;
    const next = composeTitle(modelName, [...selected, keyword], strategy.modelPosition);
    if (keywordElonSeoUtf8Bytes(next) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) continue;
    selected.push(keyword);
    if (selected.length >= strategy.maxTerms) break;
  }

  const title = composeTitle(modelName, selected, strategy.modelPosition);
  return {
    title,
    usedMaterials: [modelName, ...selected.map((keyword) => keyword.keyword)],
    keywordMaterials: selected.map((keyword) => keyword.keyword),
  };
}

function buildGroupVariants(
  strategy: GroupStrategyInternal,
  keywords: KeywordElonSeoSearchKeyword[],
  input: KeywordElonSeoPackageInput,
  modelName: string,
) {
  const ranked = [...keywords].sort((left, right) => (
    strategy.rank(right, input) - strategy.rank(left, input)
    || right.score - left.score
    || right.keyword.length - left.keyword.length
  ));
  const leads = ranked.filter((keyword) => (
    !overlaps(modelName, keyword.keyword)
    && !["form", "modifier", "generic"].includes(keywordRole(keyword, input))
  ));
  const leadPool = leads.length ? leads : ranked.filter((keyword) => !overlaps(modelName, keyword.keyword));
  const variants: TitleBuild[] = [];
  const seen = new Set<string>();

  for (let variantIndex = 0; variantIndex < strategy.variantLimit; variantIndex += 1) {
    for (let attempt = 0; attempt < Math.max(1, leadPool.length); attempt += 1) {
      const lead = leadPool[(variantIndex + attempt) % Math.max(1, leadPool.length)];
      const pivot = (variantIndex * 2 + attempt) % Math.max(1, ranked.length);
      const order = lead
        ? [lead, ...ranked.slice(pivot), ...ranked.slice(0, pivot)]
        : [...ranked.slice(pivot), ...ranked.slice(0, pivot)];
      const result = fitTitle(order, input, modelName, strategy);
      const key = keywordElonSeoCanonical(result.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      variants.push(result);
      break;
    }
  }

  if (!variants.length) {
    variants.push({
      title: modelName,
      usedMaterials: [modelName],
      keywordMaterials: [],
    });
  }
  return variants;
}

export function buildKeywordElonSeoPackage(
  input: KeywordElonSeoPackageInput,
  markets: KeywordElonSeoMarket[],
): KeywordElonSeoPackage {
  const blockedKeys = normalizedBlockedKeys(input);
  const candidateMap = new Map<string, KeywordElonSeoCandidate>();
  for (const row of input.candidates ?? []) {
    const key = candidateKey(row);
    if (key && !candidateMap.has(key)) candidateMap.set(key, row);
  }

  const allowedRows: KeywordElonSeoCandidate[] = [];
  const seenAllowed = new Set<string>();
  let filteredNoiseMaterialCount = 0;
  for (const rawKey of input.allowedKeys ?? []) {
    const key = keywordElonSeoCanonical(rawKey);
    const row = candidateMap.get(key);
    if (!row || seenAllowed.has(key)) continue;
    seenAllowed.add(key);
    if (!safeSearchTerm(candidateText(row), blockedKeys)) {
      filteredNoiseMaterialCount += 1;
      continue;
    }
    allowedRows.push(row);
  }
  allowedRows.sort((left, right) => directPriority(right) - directPriority(left));

  const search = buildSearchKeywords(input, allowedRows, blockedKeys);
  const commonSearchKeywords = search.details.map((row) => row.keyword);
  const marketDerivedKeywordCount = search.details.filter((row) => row.origin === "step4").length;
  const generatedFallbackKeywordCount = search.details.filter((row) => row.origin === "step4_pair").length;
  const model = resolveModelName(input, allowedRows, blockedKeys);

  const variantsByGroup = new Map<string, TitleBuild[]>();
  for (const group of Object.keys(STRATEGY_CONFIGS)) {
    variantsByGroup.set(
      group,
      buildGroupVariants(STRATEGY_CONFIGS[group], search.details, input, model.modelName),
    );
  }

  const groupIndexes = new Map<string, number>();
  const mallTitles = markets.map((market) => {
    const strategy = STRATEGY_CONFIGS[market.productGroup] ?? STRATEGY_CONFIGS["소매1"];
    const variants = variantsByGroup.get(market.productGroup)
      ?? buildGroupVariants(strategy, search.details, input, model.modelName);
    const groupIndex = groupIndexes.get(market.productGroup) ?? 0;
    groupIndexes.set(market.productGroup, groupIndex + 1);
    const variantIndex = groupIndex % Math.max(1, variants.length);
    const selected = variants[variantIndex] ?? {
      title: model.modelName,
      usedMaterials: [model.modelName],
      keywordMaterials: [],
    };
    return {
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: selected.title,
      byteLength: keywordElonSeoUtf8Bytes(selected.title),
      modelName: model.modelName,
      usedMaterials: selected.usedMaterials,
      keywordMaterials: selected.keywordMaterials,
      strategyLabel: strategy.label,
      variantIndex: variantIndex + 1,
    };
  });

  const modelKey = keywordElonSeoCanonical(model.modelName);
  const modelNameCoverageCount = mallTitles.filter((row) => (
    modelKey && keywordElonSeoCanonical(row.title).includes(modelKey)
  )).length;
  const warnings: string[] = [];
  if (filteredNoiseMaterialCount > 0) {
    warnings.push(`STEP 4 재료 중 원산지·제조·포장성 노이즈 ${filteredNoiseMaterialCount}개를 SEO OUTPUT에서 제외했습니다.`);
  }
  if (generatedFallbackKeywordCount > 0) {
    warnings.push(
      `STEP 4 원본 ${marketDerivedKeywordCount}개에 최종 재료 2개 조합 ${generatedFallbackKeywordCount}개를 검증해 검색어 10개를 구성했습니다.`,
    );
  }
  if (commonSearchKeywords.length < KEYWORD_ELON_SEO_SEARCH_LIMIT) {
    warnings.push(
      `최종 재료만으로 검색어가 ${commonSearchKeywords.length}/${KEYWORD_ELON_SEO_SEARCH_LIMIT}개입니다. STEP 5에서 안전 키워드를 추가한 뒤 다시 확인하세요.`,
    );
  }
  if (model.source === "fallback") {
    warnings.push("자동 모델명이 보수적 fallback으로 결정되었습니다. 상품 정체성 세부내용을 확인하세요.");
  }
  if (modelNameCoverageCount !== mallTitles.length) {
    warnings.push(`자동 모델명 포함 검증이 ${modelNameCoverageCount}/${mallTitles.length}개입니다.`);
  }
  if (mallTitles.some((row) => !row.title || row.byteLength > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT)) {
    warnings.push("일부 쇼핑몰별 상품명이 비어 있거나 50bytes를 초과해 검토가 필요합니다.");
  }

  const uniqueTitleCount = new Set(mallTitles.map((row) => keywordElonSeoCanonical(row.title)).filter(Boolean)).size;
  const ready = (
    commonSearchKeywords.length === KEYWORD_ELON_SEO_SEARCH_LIMIT
    && mallTitles.length === markets.length
    && modelNameCoverageCount === markets.length
    && mallTitles.every((row) => row.title && row.byteLength <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT)
  );

  return {
    status: ready ? "ready" : "needs_more_keywords",
    modelName: model.modelName,
    modelNameSource: model.source,
    modelNameByteLength: keywordElonSeoUtf8Bytes(model.modelName),
    modelNameCoverageCount,
    commonSearchKeywords,
    commonSearchLine: commonSearchKeywords.join(","),
    searchKeywordDetails: search.details,
    sourceMaterialCount: search.sourceMaterialCount,
    marketDerivedKeywordCount,
    generatedFallbackKeywordCount,
    externalMaterialCount: 0,
    allowedMaterialCount: allowedRows.length,
    filteredNoiseMaterialCount,
    titleByteLimit: KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
    groupStrategies: KEYWORD_ELON_SEO_GROUP_STRATEGIES,
    mallTitles,
    uniqueTitleCount,
    warnings,
  };
}
