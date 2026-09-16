import { collectSeoBulkSourceChain, type SeoBulkShoplingSourceLoader, type SeoBulkCollectedSource, type SeoBulkCollectionMode } from "./seoBulkSourceFallback.ts";
import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  compactKeywordElonKey,
  parse1688OfferId,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import { discoverKeywordElonCandidatesResilient } from "@/lib/keywordEngineElonLabV2Discovery";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import { buildKeywordElonSeoModelPackage } from "@/lib/keywordEngineElonLabSeoModelOutput";
import { composeFreshKeywordElonMallTitles } from "@/lib/keywordEngineElonFreshMallTitleComposer";
import { scoreKeywordElonCandidatesBatched } from "@/lib/keywordEngineElonLabV2Scoring";
import {
  analyzeKeywordElonIdentity,
  collectKeywordElon1688Source,
  generateKeywordElonTitle,
} from "@/lib/keywordEngineElonLabV2Server";
import { expandKeywordElonFromPassing } from "@/lib/keywordEngineElonLabV2Step3";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";
import {
  normalizeKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
} from "@/lib/keywordEngineElonLabV2Selection";
import {
  buildKeywordElonTitleExpansionPool,
  type KeywordElonTitleExpansionMaterial,
} from "@/lib/keywordEngineElonTitleExpansion";
import {
  buildKeywordElonTitleKeywordReservoirV8,
  selectKeywordElonComplementSearchKeywordsV8,
} from "@/lib/keywordEngineElonKeywordPortfolioV8";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";

// Keep the hidden group key stable so existing stored FINAL payloads remain readable.
export const SEO_TITLE_EXPANSION_META_GROUP_KEY = "__seoTitleExpansionV6";
const SEO_FINAL_SOURCE_V8 = "seo-bulk-cloud-title-first-search-complement-v8";
const INTERNAL_CATEGORY_META_PREFIX = "SHOPLING_CATEGORY=";
const SHOPLING_GROUPS = [
  ["wholesale1", "도매1"],
  ["wholesale2", "도매2"],
  ["wholesale3", "도매3"],
  ["wholesale4", "도매4"],
  ["retail1", "소매1"],
  ["retail2", "소매2"],
] as const;

export type KeywordElonBulkFinalInput = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  shoplingGoodsKeys?: string[];
  optionText?: string;
  supportingText?: string;
  mallTitleCategory?: string;
  mallTitleDetailHtml?: string;
  mallTitleMainImageUrl?: string;
  mallTitleAdditionalImageUrls?: string[];
  customBlockedTerms?: string[];
  variationSeed?: string;
  excludedMallTitles?: string[];
};

export type KeywordElonBulkFinalResult = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  collectionMode: SeoBulkCollectionMode;
  sourceWarnings: string[];
  identity: KeywordElonIdentity;
  candidateCount: number;
  finalMaterialCount: number;
  seoFinal: {
    productName: string;
    groupProductNames: Record<string, string>;
    searchKeywords: string[];
    searchLine: string;
    source: string;
    sourceUrl: string;
    offerId: string;
    generatedAt: string;
    titleExpansionCategory: string;
    titleMaterialPolicy: string;
    titleExpansionPool: KeywordElonTitleExpansionMaterial[];
    mallTitles: Array<{
      productGroup: string;
      marketName: string;
      mallKey: string;
      accountIdLabel: string;
      title: string;
    }>;
  };
  warnings: string[];
};

export type KeywordElonBulkComposeInput = KeywordElonBulkFinalInput & {
  source: KeywordElonSourceDraft;
  collectionMode: SeoBulkCollectionMode;
  identity: KeywordElonIdentity;
  candidates: KeywordElonCandidate[];
  allowedKeys: string[];
  blockedKeys: string[];
  finalMaterialCount: number;
  titleResult: KeywordElonTitleResult;
  supplementalSearchKeywords?: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: unknown[], limit = 120) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function publicSourceWarnings(source: KeywordElonSourceDraft) {
  return (source.warnings ?? []).filter(
    (warning) => !text(warning).startsWith(INTERNAL_CATEGORY_META_PREFIX),
  );
}

function passingRows(candidates: KeywordElonCandidate[]) {
  return candidates
    .filter(
      (row) => row.safetyPass && row.qualityScore >= KEYWORD_ELON_V2_DEFAULT_CUTOFF,
    )
    .sort(
      (a, b) =>
        b.qualityScore - a.qualityScore ||
        (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
    );
}

function seedRows(candidates: KeywordElonCandidate[]) {
  return unique(
    passingRows(candidates).map(
      (row) => row.searchKeyword || row.searchKey || row.keyword,
    ),
    8,
  );
}

function trackerFallbackSource(
  input: KeywordElonBulkFinalInput,
): KeywordElonSourceDraft {
  const optionText = text(input.optionText);
  const rawSupportingText = text(input.supportingText);
  const category = text(input.mallTitleCategory);
  const categoryFreeSupportingText =
    category && rawSupportingText.startsWith(category)
      ? rawSupportingText
          .slice(category.length)
          .replace(/^\s*·\s*/, "")
          .trim()
      : rawSupportingText;
  const supportingText = [
    categoryFreeSupportingText,
    input.modelNumber ? `모델번호 ${input.modelNumber}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    url: text(input.sourceUrl),
    offerId: parse1688OfferId(input.sourceUrl),
    autoStatus: "partial",
    chineseTitle: text(input.productName),
    optionText,
    supportingText,
    warnings: ["BULK_TRACKER_SOURCE_FALLBACK"],
    collectedAt: new Date().toISOString(),
  };
}

// The no-loader overload preserves the legacy pipeline's two-mode contract.
export function collectKeywordElonBulkSource(
  input: KeywordElonBulkFinalInput,
): Promise<{ source: KeywordElonSourceDraft; mode: "1688_server" | "tracker_fallback" }>;
export function collectKeywordElonBulkSource(
  input: KeywordElonBulkFinalInput,
  collectShopling: SeoBulkShoplingSourceLoader,
): Promise<SeoBulkCollectedSource>;
export async function collectKeywordElonBulkSource(
  input: KeywordElonBulkFinalInput,
  collectShopling?: SeoBulkShoplingSourceLoader,
): Promise<SeoBulkCollectedSource> {
  return collectSeoBulkSourceChain(input, {
    collect1688: collectKeywordElon1688Source,
    collectShopling,
    trackerFallback: trackerFallbackSource,
  });
}

function recoveredSearchKeywords(
  baseKeywords: string[],
  supplementalKeywords: string[],
  blockedKeys: string[],
  customBlockedTerms: string[],
) {
  const blocked = new Set(
    [...blockedKeys, ...customBlockedTerms]
      .map((value) => compactKeywordElonKey(value))
      .filter(Boolean),
  );
  const additions = supplementalKeywords
    .map((value) => compactKeywordElonKey(value))
    .filter((key) => key.length >= 2 && !blocked.has(key));
  return unique([...baseKeywords, ...additions], 10);
}

export function composeKeywordElonBulkFinal(
  input: KeywordElonBulkComposeInput,
): KeywordElonBulkFinalResult {
  if (!text(input.launchItemId)) throw new Error("출시 상품 ID가 없습니다.");
  if (!input.candidates.length) {
    throw new Error("FINAL RESULT를 만들 후보 키워드가 없습니다.");
  }
  if (!input.allowedKeys.length) {
    throw new Error("금지키워드 제거 후 사용할 SEO 재료가 없습니다.");
  }

  const output = buildKeywordElonSeoModelPackage(
    {
      identity: input.identity,
      candidates: input.candidates,
      allowedKeys: unique(input.allowedKeys),
      blockedKeys: unique(input.blockedKeys),
      customBlockedTerms: unique(input.customBlockedTerms ?? []),
      titleResult: input.titleResult,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );

  const fallbackSearchKeywords = recoveredSearchKeywords(
    [...output.commonSearchKeywords],
    input.supplementalSearchKeywords ?? [],
    input.blockedKeys,
    input.customBlockedTerms ?? [],
  );
  const titleReservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates: input.candidates,
    allowedKeys: input.allowedKeys,
    fallbackKeywords: fallbackSearchKeywords,
    blockedKeys: input.blockedKeys,
    customBlockedTerms: input.customBlockedTerms ?? [],
    limit: 12,
  });
  const titleKeywords = titleReservoir.titleKeywords;
  if (titleKeywords.length < 2) {
    throw new Error(
      `상품명용 우수 키워드가 부족합니다. 현재 ${titleKeywords.length}개`,
    );
  }

  const titleExpansionCategory = text(input.mallTitleCategory);
  const titleExpansionPool = buildKeywordElonTitleExpansionPool({
    candidates: input.candidates,
    searchKeywords: titleKeywords,
    allowedKeys: input.allowedKeys,
    category: titleExpansionCategory,
    limit: 30,
  });

  const mallComposition = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: titleKeywords,
    titleExpansionPool,
    modelName: output.modelName,
    context: {
      modelNumber: input.modelNumber,
      productName: input.productName,
      category: titleExpansionCategory,
      optionText: input.optionText,
      detailHtml: input.mallTitleDetailHtml,
      mainImageUrl: input.mallTitleMainImageUrl,
      additionalImageUrls: input.mallTitleAdditionalImageUrls,
    },
    blockedTerms: unique([
      ...input.blockedKeys,
      ...(input.customBlockedTerms ?? []),
    ]),
    excludedTitles: unique(input.excludedMallTitles ?? [], 1200),
    variationSeed: text(input.variationSeed),
  });
  const mallTitles = mallComposition.rows;
  if (mallTitles.length !== 29) {
    throw new Error(
      `쇼핑몰별 상품명이 29개가 아닙니다. 현재 ${mallTitles.length}개`,
    );
  }

  const searchSelection = selectKeywordElonComplementSearchKeywordsV8({
    rankedDirectKeywords: titleReservoir.rankedDirectKeywords,
    titleTexts: mallTitles.map((row) => row.title),
    fallbackSearchKeywords,
    supplementalSearchKeywords: input.supplementalSearchKeywords ?? [],
    blockedKeys: input.blockedKeys,
    customBlockedTerms: input.customBlockedTerms ?? [],
    limit: 10,
  });
  const searchKeywords = searchSelection.searchKeywords;
  if (searchKeywords.length !== 10) {
    throw new Error(
      `FINAL 검색어가 10개가 아닙니다. 현재 ${searchKeywords.length}개`,
    );
  }

  const groupProductNames: Record<string, string> = {};
  for (const [key, label] of SHOPLING_GROUPS) {
    const title = mallTitles.find((row) => row.productGroup === label)?.title;
    if (!title) throw new Error(`${label} 기준 상품명을 만들지 못했습니다.`);
    groupProductNames[key] = title;
  }
  groupProductNames[SEO_TITLE_EXPANSION_META_GROUP_KEY] = JSON.stringify({
    version: 8,
    category: titleExpansionCategory,
    titleKeywords,
    pool: titleExpansionPool,
    searchComplement: {
      nonOverlapCount: searchSelection.nonOverlapCount,
      overlapFallbackCount: searchSelection.overlapFallbackCount,
      syntheticFallbackCount: searchSelection.syntheticFallbackCount,
    },
  });

  const generatedAt = new Date().toISOString();
  const originalSearchSet = new Set(
    output.commonSearchKeywords.map(compactKeywordElonKey).filter(Boolean),
  );
  const recoveredCount = searchKeywords.filter(
    (keyword) => !originalSearchSet.has(compactKeywordElonKey(keyword)),
  ).length;
  const sourceWarnings = publicSourceWarnings(input.source);
  return {
    launchItemId: input.launchItemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    sourceUrl: input.sourceUrl,
    collectionMode: input.collectionMode,
    sourceWarnings,
    identity: input.identity,
    candidateCount: input.candidates.length,
    finalMaterialCount: Math.max(
      0,
      Math.floor(input.finalMaterialCount || input.allowedKeys.length),
    ),
    seoFinal: {
      productName: output.modelName,
      groupProductNames,
      searchKeywords,
      searchLine: searchKeywords.join(","),
      source: SEO_FINAL_SOURCE_V8,
      sourceUrl: input.sourceUrl,
      offerId: input.source.offerId || parse1688OfferId(input.sourceUrl),
      generatedAt,
      titleExpansionCategory,
      titleMaterialPolicy: titleExpansionPool.length
        ? "excellent-direct-title-reservoir-plus-intent-portfolio-v8"
        : "excellent-direct-title-reservoir-v8-fallback",
      titleExpansionPool,
      mallTitles: mallTitles.map((row) => ({
        productGroup: row.productGroup,
        marketName: row.marketName,
        mallKey: row.mallKey,
        accountIdLabel: row.accountIdLabel,
        title: row.title,
      })),
    },
    warnings: [
      ...output.warnings,
      ...titleReservoir.warnings,
      ...mallComposition.warnings,
      ...searchSelection.warnings,
      ...sourceWarnings,
      `TITLE_EXPANSION_CATEGORY:${titleExpansionCategory || "none"}`,
      `TITLE_EXPANSION_POOL_COUNT:${titleExpansionPool.length}`,
      `TITLE_PRIMARY_KEYWORD_COUNT:${titleKeywords.length}`,
      "TITLE_MALL_NAME_POLICY:INTENT_PORTFOLIO_V7",
      "SEO_KEYWORD_POLICY:TITLE_FIRST_SEARCH_COMPLEMENT_V8",
      `SEO_RUN_VARIATION_SEED:${text(input.variationSeed) || "none"}`,
      ...(recoveredCount
        ? [`FINAL_SEARCH_KEYWORD_RECOVERY:${recoveredCount}`]
        : []),
    ],
  };
}

export async function generateKeywordElonBulkFinal(
  input: KeywordElonBulkFinalInput,
): Promise<KeywordElonBulkFinalResult> {
  const collected = await collectKeywordElonBulkSource(input);
  const source = collected.source;
  const identity = await analyzeKeywordElonIdentity(source);

  let discovery: KeywordElonDiscovery =
    await discoverKeywordElonCandidatesResilient(source, identity);
  const firstScored = await scoreKeywordElonCandidatesBatched({
    source,
    identity,
    discovery,
    shoplingCategory: input.mallTitleCategory,
  });
  let candidates = firstScored.candidates;

  for (let round = 1; round <= 3; round += 1) {
    const seeds = seedRows(candidates);
    if (!seeds.length) break;
    const expanded = await expandKeywordElonFromPassing({
      identity,
      seedKeywords: seeds,
      existingDiscovery: discovery,
      existingCandidates: candidates,
      round,
    });
    if (!expanded.newCandidateCount || !expanded.discovery.candidates.length) {
      continue;
    }
    const scored = await scoreKeywordElonCandidatesBatched({
      source,
      identity,
      discovery: expanded.discovery,
      shoplingCategory: input.mallTitleCategory,
    });
    candidates = mergeKeywordElonCandidates(candidates, scored.candidates);
    discovery = mergeKeywordElonDiscovery(discovery, expanded.discovery);
  }

  const thresholds = normalizeKeywordElonSelectionThresholds();
  const step4Candidates = selectKeywordElonStep4Union(candidates, thresholds);
  if (!step4Candidates.length) {
    throw new Error("STEP 4에 전달할 최종 후보가 없습니다.");
  }

  const filtered = await filterKeywordElonProhibitedKeywords({
    identity,
    candidates: step4Candidates,
    customBlockedTerms: unique(input.customBlockedTerms ?? []),
  });
  const allowedKeys = new Set(filtered.allowedKeys);
  const allowedCandidates = step4Candidates.filter((row) =>
    allowedKeys.has(
      compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword),
    ),
  );
  if (!allowedCandidates.length) {
    throw new Error("금지키워드 제거 후 사용할 SEO 재료가 없습니다.");
  }

  const titleResult = await generateKeywordElonTitle({
    source,
    identity,
    candidates: allowedCandidates,
    cutoff: 0,
  });
  const blockedKeys = filtered.decisions
    .filter((row) => row.blocked === true)
    .map((row) => row.searchKey)
    .filter(Boolean);

  return composeKeywordElonBulkFinal({
    ...input,
    source,
    collectionMode: collected.mode,
    identity,
    candidates,
    allowedKeys: filtered.allowedKeys,
    blockedKeys,
    finalMaterialCount: filtered.allowedCount,
    titleResult,
  });
}
