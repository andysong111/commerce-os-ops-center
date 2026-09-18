import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const SEARCH_CONCURRENCY = 5;
const SEARCH_TIMEOUT_MS = 12_000;
const MIN_SIMILARITY = 58;
const NAVER_SHOPPING_ENDPOINT = "https://openapi.naver.com/v1/search/shop.json";
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

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value: unknown) {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
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
  const grouped = new Map<
    string,
    { score: number; count: number; bestRank: number; relevanceTotal: number }
  >();

  for (const item of evidence) {
    const current = grouped.get(item.categoryPath) ?? {
      score: 0,
      count: 0,
      bestRank: Number.MAX_SAFE_INTEGER,
      relevanceTotal: 0,
    };
    const rankWeight = Math.max(1, MAX_EVIDENCE_ITEMS + 1 - item.rank);
    current.score += rankWeight * 10 + item.relevance;
    current.count += 1;
    current.bestRank = Math.min(current.bestRank, item.rank);
    current.relevanceTotal += item.relevance;
    grouped.set(item.categoryPath, current);
  }

  const ordered = [...grouped.entries()]
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

  const dominant = grouped.get(ordered[0]);
  const supportRatio = dominant ? dominant.count / evidence.length : 0;
  const averageRelevance = evidence.reduce((sum, item) => sum + item.relevance, 0) /
    evidence.length;
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
      `네이버 쇼핑 검색 API 상위 ${evidence.length}개 결과에서 실제 category1~4를 수집해 ${ordered[0]} 경로를 대표 카테고리로 확인했습니다.`,
    sourceDomains: ["openapi.naver.com"],
  };
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
  if (!naverClientId || !naverClientSecret) {
    throw new Error(
      "NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 설정되지 않아 네이버 쇼핑 검색 API를 사용할 수 없습니다.",
    );
  }

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
          "네이버 쇼핑 검색 API 결과에서 카테고리 경로를 확인하지 못했습니다.",
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
      reason: `네이버 쇼핑 검색 API에서 확인된 카테고리 '${selected.sourcePath}'를 기준으로 샵플링 표준 카테고리 원장에서 가장 가까운 경로를 선택했습니다.`,
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

  for (const query of queries) {
    const items = await requestNaverShoppingApi(query, options);
    combined = dedupeShoppingItems([...combined, ...items]);
    const evidence = buildNaverCategoryEvidence(input.productName, combined);
    if (evidence.categoryPaths.length && combined.length >= MAX_EVIDENCE_ITEMS) {
      return evidence;
    }
  }

  return buildNaverCategoryEvidence(input.productName, combined);
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
    url.searchParams.set("exclude", "used:rental:cbshop");

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
      ) as Error & { status?: number; retryAfterMs?: number };
      error.status = response.status;
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
      [stripHtml(item.title), text(item.category1), text(item.category2), text(item.category3), text(item.category4)].join("|");
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
      ? Number((error as Record<string, unknown>).status) || 0
      : 0;
  const retryAfterMs =
    error && typeof error === "object"
      ? Math.max(
          0,
          Number((error as Record<string, unknown>).retryAfterMs) || 0,
        )
      : 0;

  if (/NAVER_CLIENT_ID|NAVER_CLIENT_SECRET/.test(message)) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_CONFIG",
      false,
      message,
    );
  }
  if (status === 401 || status === 403) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_AUTH",
      false,
      "네이버 쇼핑 검색 API 인증에 실패했습니다. NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 확인하세요.",
    );
  }
  if (status === 429) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_RATE_LIMIT",
      true,
      "네이버 쇼핑 검색 API 호출 한도에 도달했습니다.",
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
      "네이버 쇼핑 검색 API 응답 제한시간을 초과했습니다.",
      retryAfterMs,
    );
  }
  if (status >= 500) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_UPSTREAM",
      true,
      "네이버 쇼핑 검색 API가 일시적으로 응답하지 않았습니다.",
      retryAfterMs,
    );
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "NAVER_API_NETWORK",
      true,
      "네이버 쇼핑 검색 API 연결이 일시적으로 끊겼습니다.",
      retryAfterMs,
    );
  }
  return failure(
    input,
    "search_profile",
    "NAVER_API_UNKNOWN",
    false,
    message.slice(0, 240) || "네이버 쇼핑 검색 API를 완료하지 못했습니다.",
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
