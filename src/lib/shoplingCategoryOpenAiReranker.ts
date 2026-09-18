import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import { scoreNaverToShoplingCategory } from "./shoplingCategoryNaverFirst.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const RERANK_CANDIDATE_LIMIT = 8;
const RERANK_MIN_SIMILARITY = 30;
const RERANK_TIMEOUT_MS = 45_000;

type Candidate = {
  path: string;
  score: number;
  sourcePath: string;
};

type RerankOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type RerankDecision = {
  itemId: string;
  orderedPaths: string[];
  confidence: number;
  reason: string;
};

type CategoryFailureLike = {
  itemId: string;
  modelNumber: string;
  productName: string;
  stage: "search_profile" | "recommendation";
  retryable: boolean;
  code: string;
  retryAfterMs: number;
  message: string;
};

export type RerankableCategoryBatch = {
  status: "success" | "partial";
  snapshot: unknown;
  autoApplyConfidence: number | null;
  results: ProductCategoryRecommendation[];
  failures: CategoryFailureLike[];
};

type OpenAiResponse = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildNaverGroundedShoplingCandidatePool(
  naverPaths: string[],
  categories: Pick<ShoplingCategoryEntry, "path">[],
  limit = RERANK_CANDIDATE_LIMIT,
): Candidate[] {
  const sources = naverPaths
    .map(text)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  if (!sources.length) return [];

  return categories
    .map((category) => {
      let bestScore = 0;
      let sourcePath = sources[0];
      let sourceIndex = Number.MAX_SAFE_INTEGER;
      sources.forEach((source, index) => {
        const score = scoreNaverToShoplingCategory(source, category.path);
        if (
          score > bestScore ||
          (score === bestScore && index < sourceIndex)
        ) {
          bestScore = score;
          sourcePath = source;
          sourceIndex = index;
        }
      });
      return {
        path: category.path,
        score: bestScore,
        sourcePath,
        sourceIndex,
      };
    })
    .filter((candidate) => candidate.score >= RERANK_MIN_SIMILARITY)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.sourceIndex - right.sourceIndex ||
        left.path.localeCompare(right.path, "ko-KR"),
    )
    .slice(0, Math.max(1, Math.min(RERANK_CANDIDATE_LIMIT, limit)))
    .map(({ path, score, sourcePath }) => ({ path, score, sourcePath }));
}

export function sanitizeConstrainedOrderedPaths(
  orderedPaths: unknown[],
  pool: readonly Candidate[],
  limit = 3,
) {
  const allowed = new Set(pool.map((candidate) => candidate.path));
  return orderedPaths
    .map(text)
    .filter((path) => allowed.has(path))
    .filter((path, index, array) => array.indexOf(path) === index)
    .slice(0, Math.max(1, Math.min(3, limit)));
}

export async function rerankNaverGroundedShoplingRecommendations(
  inputs: ProductCategoryInput[],
  generated: RerankableCategoryBatch,
  options: RerankOptions = {},
): Promise<RerankableCategoryBatch> {
  if (!generated.results.length) return generated;

  const apiKey = text(
    options.apiKey ??
      process.env.SHOPLING_CATEGORY_OPENAI_API_KEY,
  );
  if (!apiKey) {
    return withRerankFallbackReason(
      generated,
      "SHOPLING_CATEGORY_OPENAI_API_KEY가 없어 네이버-샵플링 기계 최근접 순서를 유지했습니다.",
    );
  }

  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    return withRerankFallbackReason(
      generated,
      "샵플링 카테고리 스냅샷을 다시 읽지 못해 기계 최근접 순서를 유지했습니다.",
    );
  }

  const inputById = new Map(inputs.map((input) => [input.itemId, input]));
  const pools = new Map<string, Candidate[]>();
  for (const recommendation of generated.results) {
    const paths = recommendation.marketEvidence?.categoryPaths ?? [];
    const pool = buildNaverGroundedShoplingCandidatePool(
      paths,
      snapshot.categories,
      RERANK_CANDIDATE_LIMIT,
    );
    if (pool.length) pools.set(recommendation.itemId, pool);
  }
  if (!pools.size) return generated;

  let decisions: RerankDecision[];
  try {
    decisions = await requestConstrainedRerank(
      generated.results,
      pools,
      inputById,
      {
        apiKey,
        model: text(
          options.model ??
            process.env.OPENAI_CATEGORY_RERANK_MODEL ??
            process.env.OPENAI_CATEGORY_MODEL ??
            process.env.OPENAI_MODEL ??
            "gpt-5-mini",
        ),
        fetcher: options.fetcher ?? fetch,
        timeoutMs: Math.min(
          Math.max(10_000, options.timeoutMs ?? RERANK_TIMEOUT_MS),
          RERANK_TIMEOUT_MS,
        ),
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI 재정렬에 실패했습니다.";
    return withRerankFallbackReason(
      generated,
      `OpenAI 제한 후보 재정렬 실패(${text(message).slice(0, 100)})로 기계 최근접 순서를 유지했습니다.`,
    );
  }

  const decisionById = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const results: ProductCategoryRecommendation[] = [];
  const extraFailures: CategoryFailureLike[] = [];

  for (const recommendation of generated.results) {
    const pool = pools.get(recommendation.itemId);
    const decision = decisionById.get(recommendation.itemId);
    if (!pool?.length || !decision) {
      results.push(recommendation);
      continue;
    }

    const orderedPaths = sanitizeConstrainedOrderedPaths(
      decision.orderedPaths,
      pool,
      3,
    );

    if (!orderedPaths.length) {
      const source = inputById.get(recommendation.itemId);
      extraFailures.push({
        itemId: recommendation.itemId,
        modelNumber: recommendation.modelNumber,
        productName: source?.productName ?? "",
        stage: "recommendation" as const,
        retryable: false,
        code: "AI_INVALID_RESPONSE" as const,
        retryAfterMs: 0,
        message:
          "네이버 카테고리 근거와 샵플링 제한 후보를 OpenAI가 비교했지만 적합한 후보를 확정하지 못했습니다.",
      });
      continue;
    }

    const orderedWithFallback = [
      ...orderedPaths,
      ...pool.map((candidate) => candidate.path),
    ]
      .filter((path, index, array) => array.indexOf(path) === index)
      .slice(0, 3);
    const selectedPath = orderedWithFallback[0];
    const selectedCandidate = pool.find((candidate) => candidate.path === selectedPath);
    const evidenceConfidence = Math.max(
      0,
      Math.min(100, Number(recommendation.marketEvidence?.confidence) || 0),
    );
    const aiConfidence = Math.max(
      0,
      Math.min(100, Math.round(Number(decision.confidence) || 0)),
    );
    const deterministicScore = Math.max(
      0,
      Math.min(100, Number(selectedCandidate?.score) || 0),
    );
    const confidence = Math.min(
      97,
      Math.round(
        aiConfidence * 0.45 +
          evidenceConfidence * 0.35 +
          deterministicScore * 0.2,
      ),
    );

    results.push({
      ...recommendation,
      selectedPath,
      alternatives: orderedWithFallback.slice(1, 3),
      candidatePaths: orderedWithFallback,
      confidence,
      reason:
        `네이버 쇼핑 카테고리 '${selectedCandidate?.sourcePath ?? recommendation.marketEvidence.categoryPaths[0] ?? ""}'를 기준으로 샵플링 실제 후보 ${pool.length}개만 OpenAI에 허용해 의미적으로 재정렬했습니다. ${text(decision.reason).slice(0, 140)}`.trim(),
      marketEvidence: {
        ...recommendation.marketEvidence,
        summary: `${recommendation.marketEvidence.summary} · OpenAI 제한 후보 재정렬 적용`.slice(
          0,
          240,
        ),
      },
    });
  }

  return {
    ...generated,
    status:
      generated.failures.length + extraFailures.length > 0
        ? "partial"
        : "success",
    results,
    failures: [...generated.failures, ...extraFailures],
  };
}

function withRerankFallbackReason(
  generated: RerankableCategoryBatch,
  message: string,
): RerankableCategoryBatch {
  return {
    ...generated,
    results: generated.results.map((recommendation) => ({
      ...recommendation,
      reason: `${recommendation.reason} ${message}`.slice(0, 240),
    })),
  };
}

async function requestConstrainedRerank(
  recommendations: ProductCategoryRecommendation[],
  pools: Map<string, Candidate[]>,
  inputById: Map<string, ProductCategoryInput>,
  options: {
    apiKey: string;
    model: string;
    fetcher: typeof fetch;
    timeoutMs: number;
  },
): Promise<RerankDecision[]> {
  const products = recommendations
    .filter((recommendation) => pools.has(recommendation.itemId))
    .map((recommendation) => ({
      itemId: recommendation.itemId,
      modelName: inputById.get(recommendation.itemId)?.productName ?? "",
      naverCategoryPaths: recommendation.marketEvidence.categoryPaths,
      naverEvidenceSummary: recommendation.marketEvidence.summary,
      candidates: (pools.get(recommendation.itemId) ?? []).map((candidate) => ({
        path: candidate.path,
        deterministicSimilarity: candidate.score,
        matchedNaverPath: candidate.sourcePath,
      })),
    }));

  if (!products.length) return [];

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
        max_output_tokens: Math.min(12_000, 1_500 + products.length * 420),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 네이버 쇼핑 카테고리를 샵플링 표준 카테고리 체계로 번역하는 제한형 재정렬기다.",
                  "네이버에서 실제 확인한 카테고리 경로가 최우선 근거다.",
                  "각 상품마다 candidates에 제공된 path 중에서만 선택해야 한다. 새로운 카테고리 경로를 만들거나 수정하면 안 된다.",
                  "모델명은 후보가 비슷할 때 제품 용도·대상을 구분하는 보조 근거로만 사용한다. 모델명을 근거로 네이버 카테고리를 무시하면 안 된다.",
                  "샵플링 분류체계의 명칭이 네이버와 다르더라도 의미가 가장 가까운 후보를 1~3개 순서대로 고른다.",
                  "후보 중 의미적으로 맞는 것이 하나도 없으면 orderedPaths를 빈 배열로 반환한다.",
                  "deterministicSimilarity는 참고점수일 뿐 최종 선택을 강제하지 않는다.",
                  "반드시 후보 문자열을 원문 그대로 반환한다.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  task:
                    "네이버 실제 카테고리를 근거로 제한된 샵플링 후보만 의미 재정렬",
                  products,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_constrained_category_rerank",
            strict: true,
            schema: rerankSchema(),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        text(payload.error?.message) ||
          `OpenAI 카테고리 재정렬 요청에 실패했습니다. HTTP ${response.status}`,
      );
    }

    const parsed = parseOpenAiStructuredOutput(payload);
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    return rawResults
      .map((row) => normalizeDecision(row))
      .filter((row): row is RerankDecision => Boolean(row));
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDecision(value: unknown): RerankDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const itemId = text(row.itemId);
  if (!itemId) return null;
  return {
    itemId,
    orderedPaths: Array.isArray(row.orderedPaths)
      ? row.orderedPaths.map(text).filter(Boolean).slice(0, 3)
      : [],
    confidence: Math.max(
      0,
      Math.min(100, Math.round(Number(row.confidence) || 0)),
    ),
    reason: text(row.reason).slice(0, 200),
  };
}

function rerankSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: 25,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "orderedPaths", "confidence", "reason"],
          properties: {
            itemId: { type: "string", minLength: 1, maxLength: 120 },
            orderedPaths: {
              type: "array",
              minItems: 0,
              maxItems: 3,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string", minLength: 0, maxLength: 200 },
          },
        },
      },
    },
  };
}
