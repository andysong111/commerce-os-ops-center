import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 15_000;
const MIN_SIMILARITY = 58;
const NAVER_SHOPPING_ENDPOINT = "https://openapi.naver.com/v1/search/shop.json";
const NAVER_SHOPPING_HTML_ENDPOINT = "https://search.shopping.naver.com/search/all";
const NAVER_DISPLAY = 20;
const MAX_EVIDENCE_ITEMS = 5;

type NaverEvidence = {
  categoryPaths: string[];
  confidence: number;
  summary: string;
  sourceDomains: string[];
};

type CategoryMatch = {
  path: string;
  score: number;
  sourcePath: string;
};

type SearchOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  naverClientId?: string;
  naverClientSecret?: string;
};

type NaverShoppingItem = {
  title?: unknown;
  link?: unknown;
  productId?: unknown;
  category1?: unknown;
  category2?: unknown;
  category3?: unknown;
  category4?: unknown;
};

type NaverShoppingResponse = {
  total?: unknown;
  items?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
};

type RankedShoppingItem = {
  title: string;
  categoryPath: string;
  relevance: number;
  rank: number;
};

type ProviderError = Error & {
  status?: number;
  retryAfterMs?: number;
  code?: string;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value: unknown) {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replaceAll("브러쉬", "브러시")
    .replaceAll("악세사리", "액세서리")
    .replaceAll("핸드폰", "휴대폰")
    .replaceAll("스마트폰", "휴대폰")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function categoryParts(value: string) {
  return value
    .split(/\s*(?:>|›|»|\|)\s*|\s+\/\s+/g)
    .map(text)
    .filter(Boolean);
}

function bigrams(value: string) {
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

function segmentSimilarity(left: string, right: string) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  return jaccard(bigrams(a), bigrams(b));
}

export function scoreNaverToShoplingCategory(
  naverPath: string,
  shoplingPath: string,
) {
  const source = categoryParts(naverPath);
  const target = categoryParts(shoplingPath);
  if (!source.length || !target.length) return 0;

  const leafScore = segmentSimilarity(source.at(-1)!, target.at(-1)!);
  const sourceAncestors = source.slice(0, -1);
  const targetAncestors = target.slice(0, -1);
  const ancestorScore = sourceAncestors.length
    ? sourceAncestors.reduce((total, part) => {
        const best = targetAncestors.reduce(
          (maximum, targetPart) =>
            Math.max(maximum, segmentSimilarity(part, targetPart)),
          0,
        );
        return total + best;
      }, 0) / sourceAncestors.length
    : 0;
  const pathScore = jaccard(bigrams(naverPath), bigrams(shoplingPath));
  const depthPenalty = Math.min(0.12, Math.abs(source.length - target.length) * 0.03);
  const score = leafScore * 0.55 + ancestorScore * 0.3 + pathScore * 0.15 - depthPenalty;
  return Number((Math.max(0, Math.min(1, score)) * 100).toFixed(2));
}

export function matchNaverCategoryPathsToShopling(
  naverPaths: string[],
  categories: Pick<ShoplingCategoryEntry, "path">[],
  limit = 3,
): CategoryMatch[] {
  const sources = naverPaths
    .map(text)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  if (!sources.length) return [];

  const maxResults = Math.max(1, Math.min(3, limit));
  const selected: CategoryMatch[] = [];
  const usedShoplingPaths = new Set<string>();

  const closestForSource = (sourcePath: string) =>
    categories
      .map((category) => ({
        path: category.path,
        score: scoreNaverToShoplingCategory(sourcePath, category.path),
        sourcePath,
      }))
      .filter((candidate) => candidate.score >= MIN_SIMILARITY)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.path.localeCompare(right.path, "ko-KR"),
      );

  for (const sourcePath of sources) {
    const closest = closestForSource(sourcePath).find(
      (candidate) => !usedShoplingPaths.has(candidate.path),
    );
    if (!closest) continue;
    selected.push(closest);
    usedShoplingPaths.add(closest.path);
    if (selected.length >= maxResults) return selected;
  }

  for (const candidate of closestForSource(sources[0])) {
    if (usedShoplingPaths.has(candidate.path)) continue;
    selected.push(candidate);
    usedShoplingPaths.add(candidate.path);
    if (selected.length >= maxResults) break;
  }

  return selected;
}

export function buildNaverCategoryEvidence(
  modelName: string,
  rawItems: NaverShoppingItem[],
): NaverEvidence {
  const ranked = rawItems
    .map((item, index) => rankShoppingItem(modelName, item, index))
    .filter((item): item is RankedShoppingItem => Boolean(item?.categoryPath))
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        left.rank - right.rank,
    );

  if (!ranked.length) {
    return {
      categoryPaths: [],
      confidence: 0,
      summary: "네이버 쇼핑 검색 API 결과에서 카테고리를 확인하지 못했습니다.",
      sourceDomains: ["openapi.naver.com"],
    };
  }

  const evidence = ranked.slice(0, MAX_EVIDENCE_ITEMS);
  const ordered = rankCategoryPaths(
    evidence.map((item) => ({
      path: item.categoryPath,
      relevance: item.relevance,
      rank: item.rank,
    })),
  );
  const dominantCount = evidence.filter(
    (item) => item.categoryPath === ordered[0],
  ).length;
  const supportRatio = evidence.length ? dominantCount / evidence.length : 0;
  const averageRelevance =
    evidence.reduce((sum, item) => sum + item.relevance, 0) / evidence.length;
  const confidence = Math.max(
    55,
    Math.min(
      97,
      Math.round(60 + supportRatio * 25 + Math.min(12, averageRelevance * 0.18)),
    ),
  );

  return {
    categoryPaths: ordered,
    confidence,
    summary:
      `네이버 쇼핑 검색 API 상위 ${evidence.length}개 결과의 실제 category1~4를 집계해 ${ordered[0]} 경로를 대표 카테고리로 확인했습니다.`,
    sourceDomains: ["openapi.naver.com"],
  };
}

export function extractNaverCategoryPathsFromHtml(html: string) {
  if (!text(html)) return [];

  const normalized = String(html)
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\"/g, '"');

  const candidates: string[] = [];

  const objectPattern =
    /"category1"\s*:\s*"([^"]*)"[\s\S]{0,1200}?"category2"\s*:\s*"([^"]*)"[\s\S]{0,1200}?"category3"\s*:\s*"([^"]*)"[\s\S]{0,1200}?"category4"\s*:\s*"([^"]*)"/g;
  for (const match of normalized.matchAll(objectPattern)) {
    const path = [match[1], match[2], match[3], match[4]]
      .map(stripHtml)
      .filter(Boolean)
      .join(" > ");
    if (categoryParts(path).length >= 2) candidates.push(path);
  }

  const withoutNoise = normalized
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const plain = stripHtml(withoutNoise);

  const breadcrumbPattern =
    /([가-힣A-Za-z0-9/&+()\[\]\- ]{2,30}\s*>\s*){2,5}[가-힣A-Za-z0-9/&+()\[\]\- ]{2,30}/g;
  for (const match of plain.matchAll(breadcrumbPattern)) {
    const path = categoryParts(match[0]).join(" > ");
    if (categoryParts(path).length >= 3) candidates.push(path);
  }

  return candidates
    .map((path) => categoryParts(path).join(" > "))
    .filter(Boolean)
    .filter((path, index, array) => array.indexOf(path) === index)
    .slice(0, 20);
}

function evidenceFromHtmlPaths(paths: string[]): NaverEvidence {
  const ranked = rankCategoryPaths(
    paths.map((path, index) => ({
      path,
      relevance: Math.max(55, 90 - index * 3),
      rank: index + 1,
    })),
  );

  return {
    categoryPaths: ranked,
    confidence: ranked.length ? Math.min(88, 68 + Math.min(20, paths.length * 4)) : 0,
    summary: ranked.length
      ? `네이버 쇼핑 검색 화면에서 실제 카테고리 경로를 확인해 ${ranked[0]} 경로를 대표 카테고리로 사용했습니다.`
      : "네이버 쇼핑 검색 화면에서 카테고리 경로를 확인하지 못했습니다.",
    sourceDomains: ["search.shopping.naver.com"],
  };
}

function rankCategoryPaths(
  rows: Array<{ path: string; relevance: number; rank: number }>,
) {
  const grouped = new Map<
    string,
    { count: number; score: number; bestRank: number }
  >();

  for (const row of rows) {
    const path = categoryParts(row.path).join(" > ");
    if (!path) continue;
    const current = grouped.get(path) ?? {
      count: 0,
      score: 0,
      bestRank: Number.MAX_SAFE_INTEGER,
    };
    current.count += 1;
    current.score += Math.max(1, MAX_EVIDENCE_ITEMS + 1 - row.rank) * 10 + row.relevance;
    current.bestRank = Math.min(current.bestRank, row.rank);
    grouped.set(path, current);
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      const a = left[1];
      const b = right[1];
      return (
        b.count - a.count ||
        b.score - a.score ||
        a.bestRank - b.bestRank ||
        left[0].localeCompare(right[0], "ko-KR")
      );
    })
    .map(([path]) => path)
    .slice(0, 3);
}

export async function generateNaverFirstShoplingCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: SearchOptions = {},
) {
  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    throw new Error(
      "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 업데이트를 실행하세요.",
    );
  }

  const naverClientId = text(
    options.naverClientId ??
      process.env.NAVER_CLIENT_ID ??
      process.env.NAVER_SEARCH_CLIENT_ID,
  );
  const naverClientSecret = text(
    options.naverClientSecret ??
      process.env.NAVER_CLIENT_SECRET ??
      process.env.NAVER_SEARCH_CLIENT_SECRET,
  );

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.min(
    Math.max(4_000, options.timeoutMs ?? SEARCH_TIMEOUT_MS),
    SEARCH_TIMEOUT_MS,
  );

  const settled = await mapWithConcurrencySettled(
    inputs,
    SEARCH_CONCURRENCY,
    (input) =>
      searchNaverShoppingCategory(input, {
        naverClientId,
        naverClientSecret,
        fetcher,
        timeoutMs,
      }),
  );

  const results: ProductCategoryRecommendation[] = [];
  const failures: Array<{
    itemId: string;
    modelNumber: string;
    productName: string;
    stage: "search_profile" | "recommendation";
    retryable: boolean;
    code: string;
    retryAfterMs: number;
    message: string;
  }> = [];

  settled.forEach((settledResult, index) => {
    const input = inputs[index];
    if (settledResult.status === "rejected") {
      failures.push(failureFromError(input, settledResult.reason));
      return;
    }

    const evidence = settledResult.value;
    if (!evidence.categoryPaths.length) {
      failures.push(
        failure(
          input,
          "search_profile",
          "NAVER_CATEGORY_NOT_FOUND",
          false,
          "네이버 쇼핑 검색 결과에서 카테고리 경로를 확인하지 못했습니다.",
        ),
      );
      return;
    }

    const matches = matchNaverCategoryPathsToShopling(
      evidence.categoryPaths,
      snapshot.categories,
      3,
    );
    const selected = matches[0];
    if (!selected) {
      failures.push(
        failure(
          input,
          "recommendation",
          "SHOPLING_CATEGORY_MATCH_NOT_FOUND",
          false,
          `네이버 쇼핑 카테고리 '${evidence.categoryPaths[0]}'와 충분히 가까운 샵플링 표준 카테고리를 찾지 못했습니다.`,
        ),
      );
      return;
    }

    const candidatePaths = matches.map((candidate) => candidate.path);
    const evidenceSource = evidence.sourceDomains.includes("openapi.naver.com")
      ? "네이버 쇼핑 검색 API"
      : "네이버 쇼핑 검색 결과";
    results.push({
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      selectedPath: selected.path,
      confidence: Math.max(
        0,
        Math.min(
          97,
          Math.round(Math.min(selected.score, evidence.confidence || selected.score)),
        ),
      ),
      reason: `${evidenceSource}에서 확인된 카테고리 '${selected.sourcePath}'를 기준으로 샵플링 표준 카테고리 원장에서 가장 가까운 경로를 선택했습니다.`,
      alternatives: candidatePaths.slice(1, 3),
      autoApply: false,
      skippedExisting: Boolean(input.currentCategory),
      candidatePaths,
      matchKind: "market",
      marketEvidence: {
        status: "web",
        confidence: evidence.confidence,
        summary: evidence.summary,
        categoryPaths: evidence.categoryPaths,
        sourceDomains: evidence.sourceDomains,
      },
    });
  });

  return {
    status: failures.length ? ("partial" as const) : ("success" as const),
    snapshot: {
      collectedAt: snapshot.collectedAt,
      categoryCount: snapshot.categoryCount,
      hash: snapshot.hash,
    },
    autoApplyConfidence: null,
    results,
    failures,
  };
}

async function searchNaverShoppingCategory(
  input: ProductCategoryInput,
  options: {
    naverClientId: string;
    naverClientSecret: string;
    fetcher: typeof fetch;
    timeoutMs: number;
  },
): Promise<NaverEvidence> {
  const queries = searchQueries(input.productName);
  let combined: NaverShoppingItem[] = [];
  let officialFailure: unknown = null;

  if (options.naverClientId && options.naverClientSecret) {
    try {
      for (const query of queries) {
        const items = await requestNaverShoppingApi(query, options);
        combined = dedupeShoppingItems([...combined, ...items]);
        const evidence = buildNaverCategoryEvidence(input.productName, combined);
        if (evidence.categoryPaths.length && combined.length >= MAX_EVIDENCE_ITEMS) {
          return evidence;
        }
      }
      const evidence = buildNaverCategoryEvidence(input.productName, combined);
      if (evidence.categoryPaths.length) return evidence;
    } catch (error) {
      officialFailure = error;
      if (!shouldUseHtmlFallback(error)) throw error;
    }
  }

  const htmlPaths: string[] = [];
  for (const query of queries) {
    try {
      const html = await requestNaverShoppingHtml(query, options);
      htmlPaths.push(...extractNaverCategoryPathsFromHtml(html));
      const evidence = evidenceFromHtmlPaths(htmlPaths);
      if (evidence.categoryPaths.length) return evidence;
    } catch (error) {
      if (!officialFailure) officialFailure = error;
    }
  }

  if (officialFailure) throw officialFailure;
  return evidenceFromHtmlPaths([]);
}

async function requestNaverShoppingApi(
  query: string,
  options: {
    naverClientId: string;
    naverClientSecret: string;
    fetcher: typeof fetch;
    timeoutMs: number;
  },
): Promise<NaverShoppingItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const url = new URL(NAVER_SHOPPING_ENDPOINT);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(NAVER_DISPLAY));
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "sim");

    const response = await options.fetcher(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Naver-Client-Id": options.naverClientId,
        "X-Naver-Client-Secret": options.naverClientSecret,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as NaverShoppingResponse;
    if (!response.ok) {
      const error = new Error(
        text(payload.errorMessage) ||
          `네이버 쇼핑 검색 API 요청에 실패했습니다. HTTP ${response.status}`,
      ) as ProviderError;
      error.status = response.status;
      error.code = text(payload.errorCode);
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw error;
    }

    return Array.isArray(payload.items)
      ? payload.items.filter(
          (item): item is NaverShoppingItem =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [];
  } finally {
    clearTimeout(timer);
  }
}

async function requestNaverShoppingHtml(
  query: string,
  options: {
    fetcher: typeof fetch;
    timeoutMs: number;
  },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const url = new URL(NAVER_SHOPPING_HTML_ENDPOINT);
    url.searchParams.set("query", query);
    const response = await options.fetcher(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(
        `네이버 쇼핑 검색 화면 요청에 실패했습니다. HTTP ${response.status}`,
      ) as ProviderError;
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function shouldUseHtmlFallback(error: unknown) {
  if (!error || typeof error !== "object") return true;
  const row = error as ProviderError;
  const message = text(row.message);
  return (
    row.status === 401 ||
    row.status === 403 ||
    row.status === 404 ||
    row.code === "SE05" ||
    /Invalid search api|존재하지 않는 검색 api|인증|권한/i.test(message)
  );
}

function rankShoppingItem(
  modelName: string,
  item: NaverShoppingItem,
  zeroBasedRank: number,
): RankedShoppingItem | null {
  const categoryPath = [
    item.category1,
    item.category2,
    item.category3,
    item.category4,
  ]
    .map(text)
    .filter(Boolean)
    .join(" > ");
  if (!categoryPath) return null;

  const title = stripHtml(item.title);
  const relevance = titleRelevance(modelName, title);
  return {
    title,
    categoryPath,
    relevance,
    rank: zeroBasedRank + 1,
  };
}

function titleRelevance(modelName: string, title: string) {
  const queryCompact = compact(modelName);
  const titleCompact = compact(title);
  if (!queryCompact || !titleCompact) return 0;
  if (queryCompact === titleCompact) return 100;
  if (titleCompact.includes(queryCompact)) return 95;
  if (queryCompact.includes(titleCompact) && titleCompact.length >= 4) return 82;

  const queryTokens = meaningfulTokens(modelName);
  const titleTokens = new Set(meaningfulTokens(title));
  if (!queryTokens.length) return Math.round(jaccard(bigrams(modelName), bigrams(title)) * 60);

  const matched = queryTokens.filter((token) => titleTokens.has(token)).length;
  const coverage = matched / queryTokens.length;
  const characterSimilarity = jaccard(bigrams(modelName), bigrams(title));
  return Math.round(Math.min(100, coverage * 70 + characterSimilarity * 30));
}

function meaningfulTokens(value: string) {
  const ignored = new Set([
    "색상랜덤",
    "랜덤",
    "블랙",
    "화이트",
    "그레이",
    "회색",
    "실버",
    "골드",
    "레드",
    "블루",
    "핑크",
    "브라운",
    "베이지",
    "단품",
  ]);
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/g)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !ignored.has(token) &&
        !/^\d+(?:cm|mm|m|g|kg|ml|l|개|p|pcs?)?$/i.test(token),
    );
}

function searchQueries(modelName: string) {
  const full = text(modelName);
  const simplified = text(
    full
      .replace(/\b(?:블랙|화이트|그레이|회색|실버|골드|레드|블루|핑크|브라운|베이지)\b/gi, " ")
      .replace(/색상\s*랜덤|색상랜덤|랜덤색상|랜덤/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:cm|mm|m|g|kg|ml|l|개|p|pcs?)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
  return [full, simplified]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 2);
}

function dedupeShoppingItems(items: NaverShoppingItem[]) {
  const seen = new Set<string>();
  const result: NaverShoppingItem[] = [];
  for (const item of items) {
    const key =
      text(item.productId) ||
      [
        stripHtml(item.title),
        text(item.category1),
        text(item.category2),
        text(item.category3),
        text(item.category4),
      ].join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= NAVER_DISPLAY * 2) break;
  }
  return result;
}

function failure(
  input: ProductCategoryInput,
  stage: "search_profile" | "recommendation",
  code: string,
  retryable: boolean,
  message: string,
  retryAfterMs = 0,
) {
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    stage,
    retryable,
    code,
    retryAfterMs,
    message,
  };
}

function failureFromError(input: ProductCategoryInput, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status =
    error && typeof error === "object"
      ? Number((error as ProviderError).status) || 0
      : 0;
  const code =
    error && typeof error === "object"
      ? text((error as ProviderError).code)
      : "";
  const retryAfterMs =
    error && typeof error === "object"
      ? Math.max(0, Number((error as ProviderError).retryAfterMs) || 0)
      : 0;

  if (code === "SE05" || /Invalid search api|존재하지 않는 검색 api/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_ROUTE",
      false,
      "네이버 공식 검색 API가 현재 키에서 사용할 수 없고 쇼핑 화면 대체 수집에서도 카테고리를 확인하지 못했습니다.",
    );
  }
  if (status === 401 || status === 403) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_AUTH",
      false,
      "네이버 공식 검색 API 인증/권한이 맞지 않고 쇼핑 화면 대체 수집에서도 카테고리를 확인하지 못했습니다.",
    );
  }
  if (status === 429) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_RATE_LIMIT",
      true,
      "네이버 쇼핑 검색 호출 한도에 도달했습니다.",
      retryAfterMs,
    );
  }
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /aborted|timeout|timed out|시간.*초과/i.test(message)
  ) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_TIMEOUT",
      true,
      "네이버 쇼핑 카테고리 확인 제한시간을 초과했습니다.",
      retryAfterMs,
    );
  }
  if (status >= 500) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_UPSTREAM",
      true,
      "네이버 쇼핑 검색이 일시적으로 응답하지 않았습니다.",
      retryAfterMs,
    );
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_NETWORK",
      true,
      "네이버 쇼핑 검색 연결이 일시적으로 끊겼습니다.",
      retryAfterMs,
    );
  }
  return failure(
    input,
    "search_profile",
    "NAVER_API_UNKNOWN",
    false,
    message.slice(0, 240) || "네이버 쇼핑 카테고리 확인을 완료하지 못했습니다.",
  );
}

function parseRetryAfterMs(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date)
    ? Math.min(30_000, Math.max(0, date - Date.now()))
    : 0;
}

async function mapWithConcurrencySettled<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const result = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        result[index] = { status: "fulfilled", value: await worker(values[index]) };
      } catch (reason) {
        result[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, runWorker),
  );
  return result;
}
