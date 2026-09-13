import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSearchAdStat,
  type KeywordElonSemanticScore,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import {
  normalizeKeywordElonTitleIntentClass,
  type KeywordElonTitleIntentClass,
} from "@/lib/keywordEngineElonTitleExpansion";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 42_000;
const DEFAULT_MODEL = "gpt-5-mini";
const SCORE_CHUNK_SIZE = 12;
const SCORE_CONCURRENCY = 8;
const CATEGORY_MATCH_GATE = 85;

type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

type KeywordElonCategorySemanticScore = KeywordElonSemanticScore & {
  categoryMatch: number;
  intentClass: KeywordElonTitleIntentClass;
};

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_MODEL) ||
    DEFAULT_MODEL
  );
}

function outputText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) {
        return normalizeKeywordElonText(content.text);
      }
    }
  }
  return "";
}

function scoringSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["scores"],
    properties: {
      scores: {
        type: "array",
        minItems: 1,
        maxItems: SCORE_CHUNK_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "keyword",
            "relevance",
            "shoppingIntent",
            "specificity",
            "titleEligible",
            "categoryMatch",
            "intentClass",
          ],
          properties: {
            keyword: { type: "string", minLength: 1, maxLength: 60 },
            relevance: { type: "number", minimum: 0, maximum: 100 },
            shoppingIntent: { type: "number", minimum: 0, maximum: 100 },
            specificity: { type: "number", minimum: 0, maximum: 100 },
            titleEligible: { type: "boolean" },
            categoryMatch: { type: "number", minimum: 0, maximum: 100 },
            intentClass: {
              type: "string",
              enum: [
                "core_synonym",
                "use",
                "context",
                "function",
                "form",
                "category_tail",
                "other",
              ],
            },
          },
        },
      },
    },
  };
}

function scoreRationale(input: {
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  titleEligible: boolean;
  categoryMatch: number;
  intentClass: KeywordElonTitleIntentClass;
}) {
  const title = input.titleEligible ? " · 상품명사용 가능" : "";
  return `관련성 ${input.relevance.toFixed(0)} · 카테고리 ${input.categoryMatch.toFixed(0)} · 쇼핑의도 ${input.shoppingIntent.toFixed(0)} · 구체성 ${input.specificity.toFixed(0)} · 의도 ${input.intentClass}${title}`;
}

async function callScoreOpenAi(input: {
  keywords: string[];
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  shoplingCategory?: string;
}) {
  const apiKey = normalizeKeywordElonText(process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 AI 점수화를 실행할 수 없습니다.");
  }
  const model = openAiModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        // Bound GPT-5 reasoning latency for small structured scoring batches.
        // Unknown/custom models keep their existing request parameters.
        ...(/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
          ? { reasoning: { effort: "low" } }
          : {}),
        max_output_tokens: 3_000,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 한국 이커머스 키워드 품질 심사관이다.",
                  "각 후보를 독립적으로 0~100으로 평가한다.",
                  "relevance: 바로 그 상품을 찾는 표현인지. 다른 상품/너무 넓은 상위개념은 크게 감점한다.",
                  "shoppingIntent: 구매·상품탐색 의도가 강한 명사구인지. 정보성·행동문·증상문은 감점한다.",
                  "specificity: 상품을 식별할 만큼 구체적인지. 의미 없는 옵션코드나 속성 단독은 낮게 준다.",
                  "titleEligible: 실제 상품명에 넣어도 원본 사실을 왜곡하지 않고 자연스러운 표현일 때만 true다.",
                  "categoryMatch: ShoplingCategory가 주어졌다면 후보를 검색했을 때 동일 상품군/동일 카테고리에서 경쟁할 가능성을 평가한다. 인접 카테고리·상위 개념·다른 상품이면 크게 감점한다.",
                  "ShoplingCategory가 비어 있으면 categoryMatch는 relevance와 상품 정체성을 기준으로 평가한다.",
                  "intentClass는 core_synonym(동의어/제품명), use(용도), context(사용상황/장소), function(기능), form(형태), category_tail(동일 카테고리 세부명), other 중 하나다.",
                  "검색량은 여기서 추측하지 않는다. 수요점수와 경쟁기회는 서버가 SearchAd 데이터로 별도 계산한다.",
                  "브랜드, 성별, 재질, 용도, 효능을 원본 근거 없이 새로 만들어내면 안 된다.",
                  "설명문은 생성하지 말고 요청된 점수 필드만 반환한다.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    chineseTitle: input.source.chineseTitle,
                    optionText: input.source.optionText,
                    productIdentity: input.identity.koreanProductIdentity,
                    coreProduct: input.identity.coreProduct,
                    identityAnchor: input.identity.identityAnchor,
                    shoplingCategory: normalizeKeywordElonText(input.shoplingCategory),
                    keywords: input.keywords,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_semantic_scores_v7_category_intent",
            strict: true,
            schema: scoringSchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try {
      payload = JSON.parse(raw) as OpenAiPayload;
    } catch {
      throw new Error(
        `AI_SCORE_INVALID_JSON: ${raw.replace(/\s+/g, " ").slice(0, 180)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `AI_SCORE_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}`,
      );
    }
    const status = normalizeKeywordElonText(payload.status);
    const incompleteReason = normalizeKeywordElonText(
      payload.incomplete_details?.reason,
    );
    if (status === "incomplete") {
      throw new Error(
        `AI_SCORE_INCOMPLETE: ${incompleteReason || "응답이 완료되지 않았습니다."}`,
      );
    }
    const output = outputText(payload);
    if (!output) {
      throw new Error(
        `AI_SCORE_EMPTY_OUTPUT: status=${status || "unknown"}${incompleteReason ? ` reason=${incompleteReason}` : ""}`,
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(output) as Record<string, unknown>;
    } catch {
      throw new Error(
        "AI_SCORE_OUTPUT_PARSE_FAILED: OpenAI 구조화 응답 JSON 파싱에 실패했습니다.",
      );
    }
    const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];
    const byKey = new Map<string, KeywordElonCategorySemanticScore>();
    for (const item of rawScores) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const key = compactKeywordElonKey(row.keyword);
      if (!key) continue;
      const relevance = Math.max(0, Math.min(100, Number(row.relevance) || 0));
      const shoppingIntent = Math.max(
        0,
        Math.min(100, Number(row.shoppingIntent) || 0),
      );
      const specificity = Math.max(
        0,
        Math.min(100, Number(row.specificity) || 0),
      );
      const categoryMatch = Math.max(
        0,
        Math.min(100, Number(row.categoryMatch) || 0),
      );
      const titleEligible = Boolean(row.titleEligible);
      const intentClass = normalizeKeywordElonTitleIntentClass(row.intentClass);
      byKey.set(key, {
        keyword: key,
        relevance,
        shoppingIntent,
        specificity,
        titleEligible,
        categoryMatch,
        intentClass,
        rationale: scoreRationale({
          relevance,
          shoppingIntent,
          specificity,
          titleEligible,
          categoryMatch,
          intentClass,
        }),
      });
    }
    return {
      model,
      scores: input.keywords.map((keyword) => {
        const key = compactKeywordElonKey(keyword);
        return (
          byKey.get(key) ?? {
            keyword: key,
            relevance: 0,
            shoppingIntent: 0,
            specificity: 0,
            titleEligible: false,
            categoryMatch: 0,
            intentClass: "other" as const,
            rationale: "AI 점수 응답 누락",
          }
        );
      }),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI_SCORE_TIMEOUT: OpenAI 점수화가 42초 안에 응답하지 않았습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function scoreChunkOnce(
  keywords: string[],
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
  shoplingCategory?: string,
) {
  try {
    return {
      ok: true as const,
      ...(await callScoreOpenAi({
        keywords,
        source,
        identity,
        shoplingCategory,
      })),
      warning: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 점수화 실패";
    return {
      ok: false as const,
      model: openAiModel(),
      warning: message,
      scores: keywords.map<KeywordElonCategorySemanticScore>((keyword) => ({
        keyword: compactKeywordElonKey(keyword),
        relevance: 0,
        shoppingIntent: 0,
        specificity: 0,
        titleEligible: false,
        categoryMatch: 0,
        intentClass: "other",
        rationale: `AI 점수화 실패 · ${message.slice(0, 120)}`,
      })),
    };
  }
}

function statMap(stats: KeywordElonSearchAdStat[]) {
  return new Map(
    stats.map((row) => [compactKeywordElonKey(row.keyword), row] as const),
  );
}

export async function scoreKeywordElonCandidatesBatched(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  discovery: KeywordElonDiscovery;
  shoplingCategory?: string;
}) {
  const candidates = uniqueKeywordElonCanonical(input.discovery.candidates, 500);
  if (!candidates.length) throw new Error("점수화할 키워드 후보가 없습니다.");
  const chunks: string[][] = [];
  for (let index = 0; index < candidates.length; index += SCORE_CHUNK_SIZE) {
    chunks.push(candidates.slice(index, index + SCORE_CHUNK_SIZE));
  }

  const scored: KeywordElonCategorySemanticScore[] = [];
  const warnings: string[] = [];
  let model = openAiModel();
  let successfulChunks = 0;
  for (let index = 0; index < chunks.length; index += SCORE_CONCURRENCY) {
    const wave = chunks.slice(index, index + SCORE_CONCURRENCY);
    const waveResults = await Promise.all(
      wave.map((chunk) =>
        scoreChunkOnce(
          chunk,
          input.source,
          input.identity,
          input.shoplingCategory,
        ),
      ),
    );
    for (const result of waveResults) {
      scored.push(...result.scores);
      model = result.model || model;
      if (result.ok) successfulChunks += 1;
      else if (result.warning) warnings.push(result.warning);
    }
  }
  if (successfulChunks === 0) {
    throw new Error(
      `AI_SCORE_ALL_CHUNKS_FAILED: ${warnings[0] || "모든 AI 점수화 묶음이 실패했습니다."}`,
    );
  }

  const stats = statMap(input.discovery.searchAdStats);
  const category = normalizeKeywordElonText(input.shoplingCategory);
  const result: KeywordElonCandidate[] = scored.map((row) => {
    const key = compactKeywordElonKey(row.keyword);
    const stat = stats.get(key);
    const calculated = calculateKeywordElonQuality({
      relevance: row.relevance,
      shoppingIntent: row.shoppingIntent,
      specificity: row.specificity,
      totalSearch: stat?.totalSearch ?? null,
      compIdx: stat?.compIdx ?? null,
      plAvgDepth: stat?.plAvgDepth ?? null,
    });
    const categoryAligned = Boolean(
      row.titleEligible &&
        row.relevance >= 85 &&
        (!category || row.categoryMatch >= CATEGORY_MATCH_GATE),
    );
    const safetyPass = Boolean(calculated.safetyPass && categoryAligned);
    const qualityScore = safetyPass ? calculated.qualityScore : 0;
    const sourceTags = input.discovery.sourceTagsByKeyword[key] ?? [];
    const hasDemand = stat?.totalSearch !== null && stat?.totalSearch !== undefined;
    const chunkFailed = row.rationale.startsWith("AI 점수화 실패");
    const dataConfidence: "high" | "medium" | "low" = chunkFailed
      ? "low"
      : hasDemand && sourceTags.length >= 2
        ? "high"
        : hasDemand || sourceTags.length >= 2
          ? "medium"
          : "low";
    const demandLabel =
      stat?.totalSearch === null || stat?.totalSearch === undefined
        ? "월검색 미측정"
        : `월검색 ${stat.totalSearch.toLocaleString()}`;
    const categoryLabel = category
      ? categoryAligned
        ? `카테고리 Gate 통과 ${row.categoryMatch.toFixed(0)}`
        : `카테고리 Gate 탈락 ${row.categoryMatch.toFixed(0)}`
      : "카테고리 Gate 미사용";
    return {
      ...row,
      keyword: key,
      rationale: `${row.rationale} · ${calculated.safetyReason} · ${categoryLabel} · ${demandLabel}`,
      searchKey: key,
      searchKeyword: key,
      sourceTags,
      totalSearch: stat?.totalSearch ?? null,
      pcSearch: stat?.pcSearch ?? null,
      mobileSearch: stat?.mobileSearch ?? null,
      compIdx: stat?.compIdx ?? null,
      plAvgDepth: stat?.plAvgDepth ?? null,
      ...calculated,
      safetyPass,
      qualityScore,
      dataConfidence,
      categoryMatch: row.categoryMatch,
      categoryAligned,
      intentClass: row.intentClass,
    } as KeywordElonCandidate;
  });
  result.sort(
    (a, b) =>
      Number(b.safetyPass) - Number(a.safetyPass) ||
      b.qualityScore - a.qualityScore ||
      (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
  );
  return {
    candidates: result,
    model,
    scoringWarnings: [...new Set(warnings)].slice(0, 10),
    scoringChunkCount: chunks.length,
    scoringConcurrency: SCORE_CONCURRENCY,
    scoringSuccessfulChunks: successfulChunks,
    categoryGate: category || null,
  };
}
