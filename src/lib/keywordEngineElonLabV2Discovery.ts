import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { buildKeywordElonMarketRecall, type KeywordElonMarketRecall } from "@/lib/keywordEngineElonLabV2MarketRecall";
import { discoverKeywordElonSearchAd } from "@/lib/keywordEngineElonLabV2SearchAd";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const AI_DISCOVERY_TIMEOUT_MS = 48_000;
const DEFAULT_MODEL = "gpt-5-mini";

type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
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
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) return normalizeKeywordElonText(content.text);
    }
  }
  return "";
}

function generationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 0,
        maxItems: 24,
        items: { type: "string", minLength: 2, maxLength: 30 },
      },
    },
  };
}

async function discoverAiCandidates(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
  market: KeywordElonMarketRecall,
) {
  const apiKey = normalizeKeywordElonText(process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  if (!apiKey) return { keywords: [] as string[], model: openAiModel(), warning: "AI_DISCOVERY_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_DISCOVERY_TIMEOUT_MS);
  const model = openAiModel();
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1_500,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 Market Recall의 보조 후보 생성기다.",
                "시장어를 50개씩 발명하지 않는다. API HUB Evidence Miner가 놓칠 수 있는 짧은 상품명·통용 별칭·문제/욕구어만 최대 24개 보완한다.",
                "API HUB 증거어가 있으면 그것을 우선 신뢰하고 의미적으로 가까운 짧은 검색어만 보완한다.",
                "제조사식 장문, 색상·규격 조합, 문장형 표현, 브랜드 발명, 근거 없는 효능은 금지한다.",
                "한국 검색창에 입력할 법한 1~3어절 명사구를 우선하며 같은 어근의 변형을 반복하지 않는다.",
                "최종 적합성은 AI 안전 Gate와 SearchAd가 검증하므로 recall 보조 역할만 한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                chineseTitle: source.chineseTitle,
                optionText: source.optionText,
                productIdentity: identity.koreanProductIdentity,
                coreProduct: identity.coreProduct,
                identityAnchor: identity.identityAnchor,
                marketBridgeSeeds: market.bridgeSeeds,
                evidenceMarketTerms: market.evidenceTerms.slice(0, 24).map((row) => ({ term: row.term, score: row.score, sources: row.sources })),
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_candidate_pool_v6_evidence_first",
            strict: true,
            schema: generationSchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try { payload = JSON.parse(raw) as OpenAiPayload; } catch { return { keywords: [] as string[], model, warning: "AI_DISCOVERY_INVALID_JSON" }; }
    if (!response.ok) return { keywords: [] as string[], model, warning: `AI_DISCOVERY_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}` };
    if (normalizeKeywordElonText(payload.status) === "incomplete") {
      return { keywords: [] as string[], model, warning: `AI_DISCOVERY_INCOMPLETE: ${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"} · 증거어/Bridge/SearchAd로 계속 진행` };
    }
    const text = outputText(payload);
    if (!text) return { keywords: [] as string[], model, warning: "AI_DISCOVERY_EMPTY_OUTPUT" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { return { keywords: [] as string[], model, warning: "AI_DISCOVERY_OUTPUT_PARSE_FAILED" }; }
    const keywords = uniqueKeywordElonCanonical(Array.isArray(parsed.keywords) ? parsed.keywords as unknown[] : [], 24)
      .filter((keyword) => keyword.length >= 2 && keyword.length <= 16);
    return { keywords, model, warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? `AI_DISCOVERY_TIMEOUT: ${AI_DISCOVERY_TIMEOUT_MS / 1000}초 내 응답 없음 · 증거어/Bridge/SearchAd로 계속 진행`
      : `AI_DISCOVERY_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    return { keywords: [] as string[], model, warning };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackMarket(identity: KeywordElonIdentity, warning: string): KeywordElonMarketRecall {
  const bridgeSeeds = uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10);
  return {
    bridgeSeeds,
    marketTerms: [],
    evidenceTerms: [],
    searchSeeds: bridgeSeeds,
    apiHubQueries: [],
    apiHubDocumentCount: 0,
    apiHubActiveSources: [],
    apiHubConfigured: false,
    warnings: [warning],
    model: openAiModel(),
  };
}

function shortAiSearchSeeds(keywords: string[]) {
  return keywords.filter((keyword) => keyword.length >= 2 && keyword.length <= 10).slice(0, 6);
}

export async function discoverKeywordElonCandidatesResilient(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonDiscovery> {
  const seeds = uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds, identity.identityAnchor, ...identity.conditionalSeeds], 8);
  if (!seeds.length) throw new Error("DISCOVERY_NO_SEED: STEP 1 Seed가 없습니다.");

  const marketSettled = await Promise.allSettled([buildKeywordElonMarketRecall(source, identity)]);
  const market = marketSettled[0].status === "fulfilled"
    ? marketSettled[0].value
    : fallbackMarket(identity, `MARKET_RECALL_FAILED: ${marketSettled[0].reason instanceof Error ? marketSettled[0].reason.message : String(marketSettled[0].reason)}`);

  const aiSettled = await Promise.allSettled([discoverAiCandidates(source, identity, market)]);
  const ai = aiSettled[0].status === "fulfilled"
    ? aiSettled[0].value
    : { keywords: [] as string[], model: openAiModel(), warning: `AI_DISCOVERY_FAILED: ${aiSettled[0].reason instanceof Error ? aiSettled[0].reason.message : String(aiSettled[0].reason)}` };

  const searchAdSeeds = uniqueKeywordElonCanonical([
    ...seeds,
    ...market.marketTerms,
    ...market.searchSeeds,
    ...market.bridgeSeeds,
    ...shortAiSearchSeeds(ai.keywords),
    ...seeds,
  ], 30);

  const searchAdSettled = await Promise.allSettled([discoverKeywordElonSearchAd(searchAdSeeds)]);
  const searchAd = searchAdSettled[0].status === "fulfilled"
    ? searchAdSettled[0].value
    : {
        configured: Boolean(process.env.NAVER_SEARCHAD_API_KEY?.trim() && process.env.NAVER_SEARCHAD_SECRET_KEY?.trim() && process.env.NAVER_SEARCHAD_CUSTOMER_ID?.trim()),
        rows: [],
        warnings: [`SEARCHAD_DISCOVERY_FAILED: ${searchAdSettled[0].reason instanceof Error ? searchAdSettled[0].reason.message : String(searchAdSettled[0].reason)}`],
        expansionSeeds: [] as string[],
        explorationDepth: 1,
      };

  const relatedKeywords = searchAd.rows.map((row) => row.keyword);
  const candidates = uniqueKeywordElonCanonical([
    ...seeds,
    ...market.bridgeSeeds,
    ...market.marketTerms,
    ...ai.keywords,
    ...relatedKeywords,
  ], 500);

  const sourceTagsByKeyword: Record<string, string[]> = {};
  const addTag = (keyword: string, tag: string) => {
    const key = compactKeywordElonKey(keyword);
    if (!key) return;
    sourceTagsByKeyword[key] = [...new Set([...(sourceTagsByKeyword[key] ?? []), tag])];
  };
  const demandExpansionKeys = new Set(searchAd.expansionSeeds.map(compactKeywordElonKey));
  for (const seed of identity.primarySeeds) addTag(seed, "primary_seed");
  for (const seed of identity.conditionalSeeds) addTag(seed, "conditional_seed");
  for (const seed of market.bridgeSeeds) addTag(seed, "market_bridge_seed");
  for (const row of market.evidenceTerms) {
    addTag(row.term, "api_hub_evidence_term");
    for (const source of row.sources) addTag(row.term, `api_hub_${source}`);
  }
  for (const keyword of ai.keywords) addTag(keyword, "ai_recall_support");
  for (const row of searchAd.rows) {
    addTag(row.keyword, "searchad_related");
    if (row.sourceSeeds.some((seed) => demandExpansionKeys.has(compactKeywordElonKey(seed)))) addTag(row.keyword, "searchad_demand_depth2");
    for (const seed of row.sourceSeeds) addTag(row.keyword, `related:${compactKeywordElonKey(seed)}`);
  }

  const warnings = [
    ...market.warnings,
    ...searchAd.warnings,
    ai.warning,
    `MARKET_RECALL_V6_SUMMARY: Bridge ${market.bridgeSeeds.length}개 · API HUB 증거어 ${market.marketTerms.length}개 · 문서 ${market.apiHubDocumentCount}건 · 활성소스 ${market.apiHubActiveSources.join("/") || "없음"} · SearchAd Seed ${searchAdSeeds.slice(0, 10).join(", ")}`,
  ].filter(Boolean);
  if (searchAd.expansionSeeds.length) warnings.push(`DEMAND_DEPTH2_USED: 월검색량 상위 관련어 ${searchAd.expansionSeeds.length}개를 2차 Seed로 재탐색 (${searchAd.expansionSeeds.join(", ")})`);
  if (candidates.length < 10) warnings.push(`DISCOVERY_LOW_RECALL: 후보 ${candidates.length}개 · 최소 목표 10개 미만`);

  return {
    candidates,
    sourceTagsByKeyword,
    searchAdStats: searchAd.rows,
    searchAdConfigured: searchAd.configured,
    searchAdWarnings: [...new Set(warnings)].slice(0, 30),
    aiGeneratedCount: ai.keywords.length,
    relatedKeywordCount: relatedKeywords.length,
    demandExpansionSeeds: searchAd.expansionSeeds,
    demandExpansionSeedCount: searchAd.expansionSeeds.length,
    demandExplorationDepth: searchAd.explorationDepth,
    marketBridgeSeeds: market.bridgeSeeds,
    marketTerms: market.marketTerms,
    apiHubConfigured: market.apiHubConfigured,
    apiHubQueries: market.apiHubQueries,
    apiHubDocumentCount: market.apiHubDocumentCount,
    apiHubActiveSources: market.apiHubActiveSources,
    apiHubEvidenceTerms: market.evidenceTerms,
    marketRecallVersion: "v6",
    model: ai.model || market.model,
  };
}
