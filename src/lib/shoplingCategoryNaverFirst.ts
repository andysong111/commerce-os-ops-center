import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 30_000;
const MIN_SIMILARITY = 58;

type OpenAiResponse = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    action?: { sources?: Array<{ url?: unknown }> };
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

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
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
  const sources = naverPaths.map(text).filter(Boolean);
  if (!sources.length) return [];

  return categories
    .map((category) => {
      let score = 0;
      let sourcePath = "";
      for (const source of sources) {
        const nextScore = scoreNaverToShoplingCategory(source, category.path);
        if (nextScore <= score) continue;
        score = nextScore;
        sourcePath = source;
      }
      return { path: category.path, score, sourcePath };
    })
    .filter((candidate) => candidate.score >= MIN_SIMILARITY)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    )
    .slice(0, Math.max(1, Math.min(3, limit)));
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

  const apiKey = text(options.apiKey ?? process.env.SHOPLING_CATEGORY_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 네이버 쇼핑 카테고리를 검색할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.min(options.timeoutMs ?? SEARCH_TIMEOUT_MS, SEARCH_TIMEOUT_MS);

  const settled = await mapWithConcurrencySettled(inputs, SEARCH_CONCURRENCY, (input) =>
    searchNaverShoppingCategory(input, { apiKey, model, fetcher, timeoutMs }),
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
      failures.push(failure(input, "search_profile", "AI_INVALID_RESPONSE", false,
        "네이버 쇼핑 검색 결과에서 동일 상품의 카테고리 경로를 확인하지 못했습니다."));
      return;
    }

    const matches = matchNaverCategoryPathsToShopling(
      evidence.categoryPaths,
      snapshot.categories,
      3,
    );
    const selected = matches[0];
    if (!selected) {
      failures.push(failure(input, "recommendation", "AI_INVALID_RESPONSE", false,
        `네이버 쇼핑 카테고리 '${evidence.categoryPaths[0]}'와 충분히 유사한 샵플링 저장 카테고리를 찾지 못했습니다.`));
      return;
    }

    const candidatePaths = matches.map((candidate) => candidate.path);
    results.push({
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      selectedPath: selected.path,
      confidence: Math.max(
        0,
        Math.min(97, Math.round(Math.min(selected.score, evidence.confidence || selected.score))),
      ),
      reason: `네이버 쇼핑에서 확인된 '${selected.sourcePath}'와 저장된 샵플링 카테고리 경로를 직접 비교해 가장 유사한 경로를 선택했습니다.`,
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

function evidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "categoryPaths", "confidence", "summary"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            categoryPaths: {
              type: "array",
              minItems: 0,
              maxItems: 3,
              items: { type: "string", minLength: 1, maxLength: 240 },
            },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "string", minLength: 0, maxLength: 240 },
          },
        },
      },
    },
  };
}

async function searchNaverShoppingCategory(
  input: ProductCategoryInput,
  options: { apiKey: string; model: string; fetcher: typeof fetch; timeoutMs: number },
): Promise<NaverEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        store: false,
        max_output_tokens: 900,
        tools: [
          {
            type: "web_search",
            search_context_size: "medium",
          },
        ],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 네이버 쇼핑 카테고리 확인 담당자다.",
                "주어진 모델명을 그대로 네이버 쇼핑에서 검색한다. 먼저 모델명 전체 문구를 사용하고, 결과가 부족할 때만 색상·수량·규격 같은 끝 속성을 제거한 검색을 추가한다.",
                "네이버 쇼핑 검색 결과 상단의 같은 제품군을 최대 5개까지 확인한다.",
                "각 결과에서 네이버가 실제 표시한 쇼핑 카테고리 경로만 읽는다. 제품명이나 상식으로 카테고리를 새로 추론하지 않는다.",
                "같은 제품군에서 반복되는 카테고리 경로가 있으면 그 경로를 categoryPaths 첫 번째에 둔다.",
                "웹 검색 쿼리는 site:shopping.naver.com, site:search.shopping.naver.com, site:naver.com 순으로 네이버 결과를 우선 확인한다.",
                "네이버 쇼핑 이외의 쇼핑몰 카테고리는 근거로 사용하지 않는다.",
                "색상·수량·규격 차이는 무시해도 되지만 제품 종류·용도·사용 대상이 다른 상품은 제외한다.",
                "실제 네이버 쇼핑 카테고리를 확인할 수 없으면 억지 후보를 만들지 말고 categoryPaths를 빈 배열로 둔다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                task: "네이버 쇼핑에서 모델명 검색 후 실제 카테고리 경로 확인",
                itemId: input.itemId,
                modelName: input.productName,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "naver_shopping_category_evidence",
            strict: true,
            schema: evidenceSchema(),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      const error = new Error(
        text(payload.error?.message) || `네이버 쇼핑 검색 요청에 실패했습니다. HTTP ${response.status}`,
      ) as Error & { status?: number; retryAfterMs?: number };
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw error;
    }

    const parsed = parseOpenAiStructuredOutput(payload);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("네이버 쇼핑 카테고리 검색 결과 형식이 올바르지 않습니다.");
    }
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) {
      throw new Error("네이버 쇼핑 카테고리 검색 결과의 상품 ID가 일치하지 않습니다.");
    }

    const sourceDomains = extractNaverSourceDomains(payload);
    if (!sourceDomains.length) {
      throw new Error("네이버 검색 근거를 확인하지 못했습니다.");
    }

    return {
      categoryPaths: Array.isArray(value.categoryPaths)
        ? value.categoryPaths.map(text).filter(Boolean).slice(0, 3)
        : [],
      confidence: Math.max(0, Math.min(100, Math.round(Number(value.confidence) || 0))),
      summary: text(value.summary).slice(0, 240),
      sourceDomains,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractNaverSourceDomains(payload: OpenAiResponse) {
  const domains = new Set<string>();
  for (const output of payload.output ?? []) {
    if (output.type !== "web_search_call") continue;
    for (const source of output.action?.sources ?? []) {
      try {
        const hostname = new URL(text(source.url)).hostname
          .toLocaleLowerCase("en-US")
          .replace(/^www\./, "");
        if (hostname === "naver.com" || hostname.endsWith(".naver.com")) {
          domains.add(hostname);
        }
      } catch {
        // Ignore malformed source URLs.
      }
    }
  }
  return [...domains].slice(0, 8);
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
  const status = error && typeof error === "object"
    ? Number((error as Record<string, unknown>).status) || 0
    : 0;
  const retryAfterMs = error && typeof error === "object"
    ? Math.max(0, Number((error as Record<string, unknown>).retryAfterMs) || 0)
    : 0;

  if (status === 429 || /rate[_ ]limit|too many requests|HTTP 429/i.test(message)) {
    return failure(input, "search_profile", "AI_RATE_LIMIT", true,
      "네이버 쇼핑 검색 요청이 한꺼번에 몰려 제한되었습니다.", retryAfterMs);
  }
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /aborted|timeout|timed out|시간.*초과/i.test(message)
  ) {
    return failure(input, "search_profile", "AI_TIMEOUT", true,
      "네이버 쇼핑 카테고리 검색 제한시간을 초과했습니다.", retryAfterMs);
  }
  if (status >= 500 || /HTTP 5\d\d|temporar|overloaded/i.test(message)) {
    return failure(input, "search_profile", "AI_UPSTREAM", true,
      "네이버 쇼핑 검색에 사용하는 AI 서비스가 일시적으로 응답하지 않았습니다.", retryAfterMs);
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return failure(input, "search_profile", "AI_NETWORK", true,
      "네이버 쇼핑 검색 연결이 일시적으로 끊겼습니다.", retryAfterMs);
  }
  return failure(input, "search_profile", "AI_UNKNOWN", false,
    message.slice(0, 240) || "네이버 쇼핑 카테고리 검색을 완료하지 못했습니다.");
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