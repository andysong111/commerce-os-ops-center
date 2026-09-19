import { randomBytes } from "node:crypto";
import { dispatchGitHubActionsWorkflow } from "./githubActionsDispatch";
import { readShoplingCategoryCatalogFromSupabase } from "./shoplingCategorySupabaseStore";
import {
  calibrateShoplingCategoryConfidence,
  canAutoApplyShoplingCategory,
  normalizeShoplingCategorySearchProfiles,
  parseProductCategoryInputs,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
import type {
  ProductCategoryInput,
  ShoplingCategorySearchProfile,
} from "./shoplingCategoryScoring";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput";
import {
  mergeGroundedShoplingCategoryProfiles,
  runFallbackFirstCategoryGrounding,
} from "./shoplingCategoryGrounding";
export {
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
export type { CategoryCandidate, ProductCategoryInput } from "./shoplingCategoryScoring";
export type { ShoplingCategorySearchProfile } from "./shoplingCategoryScoring";

export type ShoplingCategoryEntry = {
  depth: number;
  path: string;
  names: string[];
  codes: string[];
  largeCode?: string;
  largeName?: string;
  middleCode?: string;
  middleName?: string;
  smallCode?: string;
  smallName?: string;
  detailCode?: string;
  detailName?: string;
};

export type ShoplingCategorySnapshot = {
  schemaVersion: number;
  source: string;
  status: "success";
  requestId?: string;
  collectedAt: string;
  categoryPageUrl?: string;
  categoryCount: number;
  hash: string;
  categories: ShoplingCategoryEntry[];
};

export type ShoplingCategoryRefreshStatus = {
  schemaVersion?: number;
  source?: string;
  status: string;
  requestId?: string;
  checkedAt?: string | null;
  categoryPageUrl?: string;
  categoryCount?: number;
  hash?: string;
  message?: string;
};

export type ProductCategoryRecommendation = {
  itemId: string;
  modelNumber: string;
  selectedPath: string;
  confidence: number;
  reason: string;
  alternatives: string[];
  autoApply: boolean;
  skippedExisting: boolean;
  candidatePaths: string[];
  matchKind: "intent" | "market" | "core" | "context" | "none";
  marketEvidence: ProductCategoryMarketEvidence;
};

export type ProductCategoryMarketEvidence = {
  status: "web" | "model_fallback";
  confidence: number;
  summary: string;
  categoryPaths: string[];
  sourceDomains: string[];
};

type OpenAiResponse = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    action?: {
      sources?: Array<{ url?: unknown }>;
    };
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

type OpenAiCategoryRequestError = Error & {
  status?: number;
  code?: string;
  retryAfterMs?: number;
};

const DEFAULT_REPO = "andysong111/shopling-product-upload-auto";
const DEFAULT_WORKFLOW = "shopling-category-refresh.yml";
const SNAPSHOT_PATH = "data/shopling_categories/latest.json";
const STATUS_PATH = "data/shopling_categories/status.json";
const AUTO_APPLY_CONFIDENCE = 90;
function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getRepoConfig() {
  const repo = text(
    process.env.SHOPLING_CATEGORY_REPO ||
      process.env.SHOPLING_UPLOAD_REPO ||
      DEFAULT_REPO,
  );
  const workflow = text(
    process.env.SHOPLING_CATEGORY_WORKFLOW || DEFAULT_WORKFLOW,
  );
  const ref = text(
    process.env.SHOPLING_CATEGORY_REF || process.env.SHOPLING_UPLOAD_REF || "main",
  );
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_CATEGORY_REPO는 owner/repo 형식이어야 합니다.");
  }
  const [owner, repoName] = repo.split("/");
  return { repo, owner, repoName, workflow, ref };
}

function getDispatchConfig() {
  const config = getRepoConfig();
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!token) {
    throw new Error(
      "GITHUB_ACTIONS_TOKEN 또는 GITHUB_ENGINE_DISPATCH_TOKEN이 필요합니다.",
    );
  }
  return { ...config, token };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGithubContent(path: string, optional = false) {
  const config = getRepoConfig();
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!token) return optional ? null : Promise.reject(new Error("GitHub 읽기 토큰이 없습니다."));
  const url = `https://api.github.com/repos/${config.owner}/${config.repoName}/contents/${path}?ref=${encodeURIComponent(config.ref)}`;
  const response = await fetch(url, {
    headers: {
      ...githubHeaders(token),
      Accept: "application/vnd.github.raw+json",
    },
    cache: "no-store",
  });
  if (optional && response.status === 404) return null;
  const raw = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      message = text((JSON.parse(raw) as { message?: unknown }).message);
    } catch {
      message = text(raw);
    }
    throw new Error(
      message || `GitHub 파일 조회에 실패했습니다. HTTP ${response.status}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GitHub 카테고리 JSON 형식이 올바르지 않습니다.");
  }
}

function normalizeSnapshot(payload: ShoplingCategorySnapshot | null) {
  if (!payload) return null;
  if (
    payload.status !== "success" ||
    !Array.isArray(payload.categories) ||
    !payload.categories.length
  ) {
    throw new Error("샵플링 카테고리 스냅샷이 비어 있습니다.");
  }
  return {
    ...payload,
    categories: payload.categories
      .filter((entry) => text(entry?.path))
      .map((entry) => ({
        ...entry,
        path: text(entry.path),
        names: Array.isArray(entry.names) ? entry.names.map(text).filter(Boolean) : [],
        codes: Array.isArray(entry.codes) ? entry.codes.map(text).filter(Boolean) : [],
      })),
  };
}

export async function fetchShoplingCategorySnapshot() {
  const supabaseCatalog = await readShoplingCategoryCatalogFromSupabase().catch(
    () => null,
  );
  if (supabaseCatalog?.snapshot) {
    return normalizeSnapshot(supabaseCatalog.snapshot);
  }

  const fallback = (await readGithubContent(SNAPSHOT_PATH, true).catch(() => null)) as
    | ShoplingCategorySnapshot
    | null;
  return normalizeSnapshot(fallback);
}

export async function fetchShoplingCategoryRefreshStatus() {
  const config = getRepoConfig();
  const supabaseCatalog = await readShoplingCategoryCatalogFromSupabase().catch(
    () => null,
  );
  if (supabaseCatalog?.status || supabaseCatalog?.snapshot) {
    const snapshot = normalizeSnapshot(supabaseCatalog.snapshot);
    return {
      status: supabaseCatalog.status ?? {
        status: snapshot ? "success" : "not_initialized",
        message: snapshot
          ? "샵플링 카테고리 업데이트가 완료됐습니다."
          : "샵플링 카테고리 최초 수집 전입니다.",
        categoryCount: snapshot?.categoryCount ?? 0,
      },
      snapshot: snapshot
        ? {
            collectedAt: snapshot.collectedAt,
            categoryCount: snapshot.categoryCount,
            hash: snapshot.hash,
          }
        : null,
      actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
      storage: "supabase" as const,
    };
  }

  const fallbackStatus = (await readGithubContent(STATUS_PATH, true).catch(
    () => null,
  )) as ShoplingCategoryRefreshStatus | null;
  const fallbackSnapshot = await (async () => {
    try {
      const payload = (await readGithubContent(SNAPSHOT_PATH, true)) as
        | ShoplingCategorySnapshot
        | null;
      return normalizeSnapshot(payload);
    } catch {
      return null;
    }
  })();
  return {
    status: fallbackStatus ?? {
      status: "not_initialized",
      message: "샵플링 카테고리 최초 수집 전입니다.",
      categoryCount: 0,
    },
    snapshot: fallbackSnapshot
      ? {
          collectedAt: fallbackSnapshot.collectedAt,
          categoryCount: fallbackSnapshot.categoryCount,
          hash: fallbackSnapshot.hash,
        }
      : null,
    actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
    storage: fallbackSnapshot || fallbackStatus ? ("github_fallback" as const) : ("none" as const),
  };
}

export function generateShoplingCategoryRequestId(now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `shopling-category-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export async function dispatchShoplingCategoryRefresh(requestId: string) {
  const config = getDispatchConfig();
  const categoryPageUrl = text(process.env.SHOPLING_CATEGORY_PAGE_URL);
  return dispatchGitHubActionsWorkflow({
    owner: config.owner,
    repo: config.repoName,
    workflowFile: config.workflow,
    ref: config.ref,
    token: config.token,
    inputs: {
      request_id: requestId,
      category_page_url: categoryPageUrl,
    },
  });
}

function recommendationSchema() {
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
          required: ["itemId", "selectedPath", "confidence", "reason", "alternatives"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            selectedPath: { type: "string", minLength: 1, maxLength: 300 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string", minLength: 1, maxLength: 240 },
            alternatives: {
              type: "array",
              minItems: 0,
              maxItems: 3,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
  };
}

function searchProfileSchema() {
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
          required: [
            "itemId",
            "coreProductTerms",
            "contextTerms",
            "catalogCategoryTerms",
            "productFormTerms",
            "incompatibleCategoryTerms",
            "blockedCategoryTerms",
            "marketCategoryPaths",
            "marketEvidenceSummary",
            "marketEvidenceConfidence",
            "ignoredAttributes",
          ],
          properties: {
            itemId: { type: "string", minLength: 1 },
            coreProductTerms: {
              type: "array",
              minItems: 0,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            contextTerms: {
              type: "array",
              minItems: 0,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            catalogCategoryTerms: {
              type: "array",
              minItems: 0,
              maxItems: 10,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            productFormTerms: {
              type: "array",
              minItems: 0,
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            incompatibleCategoryTerms: {
              type: "array",
              minItems: 0,
              maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            blockedCategoryTerms: {
              type: "array",
              minItems: 0,
              maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            marketCategoryPaths: {
              type: "array",
              minItems: 0,
              maxItems: 4,
              items: { type: "string", minLength: 1, maxLength: 240 },
            },
            marketEvidenceSummary: {
              type: "string",
              minLength: 0,
              maxLength: 240,
            },
            marketEvidenceConfidence: {
              type: "integer",
              minimum: 0,
              maximum: 100,
            },
            ignoredAttributes: {
              type: "array",
              minItems: 0,
              maxItems: 10,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
          },
        },
      },
    },
  };
}

export async function generateShoplingCategorySearchProfiles(
  inputs: ProductCategoryInput[],
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    useWebSearch?: boolean;
  } = {},
): Promise<ShoplingCategorySearchProfile[]> {
  const normalizedInputs = parseProductCategoryInputs({ items: inputs });
  const apiKey = text(options.apiKey ?? process.env.SHOPLING_CATEGORY_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 모델명 핵심명사를 분석할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const totalTimeoutMs = Math.max(15_000, options.timeoutMs ?? 60_000);
  const webSearchEnabled =
    options.useWebSearch ??
    !["0", "false", "off"].includes(
      text(process.env.OPENAI_CATEGORY_WEB_SEARCH).toLocaleLowerCase("en-US"),
    );

  // OpenAI-only Shopling classification intentionally disables web search.
  // In that path this semantic identity pass is not a short fallback: it is
  // the primary evidence used to build the Shopling shortlist, so give it the
  // full caller timeout instead of the legacy 15s fallback budget.
  if (!webSearchEnabled) {
    return requestShoplingCategorySearchProfiles({
      normalizedInputs,
      apiKey,
      model,
      fetcher,
      timeoutMs: totalTimeoutMs,
      useWebSearch: false,
    });
  }

  return runFallbackFirstCategoryGrounding({
    totalTimeoutMs,
    webSearchEnabled,
    requestFallback: (timeoutMs) =>
      requestShoplingCategorySearchProfiles({
        normalizedInputs,
        apiKey,
        model,
        fetcher,
        timeoutMs,
        useWebSearch: false,
      }),
    requestWeb: (timeoutMs) =>
      requestShoplingCategorySearchProfiles({
        normalizedInputs,
        apiKey,
        model,
        fetcher,
        timeoutMs,
        useWebSearch: true,
      }),
    merge: mergeGroundedShoplingCategoryProfiles,
    // The fallback already succeeded with the same key and model. Any error
    // limited to the optional web-evidence call must therefore preserve it.
    isFatalWebError: () => false,
  });
}

async function requestShoplingCategorySearchProfiles(options: {
  normalizedInputs: ProductCategoryInput[];
  apiKey: string;
  model: string;
  fetcher: typeof fetch;
  timeoutMs: number;
  useWebSearch: boolean;
  allowedDomains?: string[];
}): Promise<ShoplingCategorySearchProfile[]> {
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
        max_output_tokens: Math.min(
          10_000,
          1_800 + options.normalizedInputs.length * 700,
        ),
        ...(options.useWebSearch
          ? {
              tools: [
                {
                  type: "web_search",
                  search_context_size: "medium",
                  ...(options.allowedDomains?.length
                    ? {
                        filters: {
                          allowed_domains: options.allowedDomains,
                        },
                      }
                    : {}),
                },
              ],
              tool_choice: "required",
              include: ["web_search_call.action.sources"],
            }
          : {}),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 한국 온라인쇼핑 카테고리 검색어 설계 담당자다.",
                  options.useWebSearch
                    ? "각 모델명마다 최소 한 번씩 웹에서 실제로 검색해 같은 물건의 상품 유형과 카테고리 경로를 확인한다. 모델명 전체 검색 후 색상·규격·A/B형 같은 속성을 뺀 검색도 사용한다."
                    : "웹 검색을 사용할 수 없는 대체 분석이다. 모델명과 옵션만으로 보수적으로 분류하고 웹에서 확인한 것처럼 쓰지 않는다.",
                  options.useWebSearch
                    ? "네이버 쇼핑·스마트스토어·네이버 통합검색에 노출된 동일 상품의 카테고리 경로를 최우선으로 사용한다. 네이버 근거가 없으면 한국 주요 쇼핑몰 여러 결과에서 공통으로 확인되는 분류만 사용한다."
                    : "marketCategoryPaths는 빈 배열로 두고 marketEvidenceConfidence는 49 이하로 제한한다.",
                  "검색 결과 제목의 우연한 단어 일치가 아니라 용도·사용 부위·대상까지 같은 제품인지 확인한다.",
                  "모델명 전체를 하나의 상품명으로 먼저 해석한다. 합성 상품명은 마지막 단어 하나만 떼어 일반 사전 의미로 분류하지 않는다.",
                  "특히 'X안경', 'X트레이', 'X담요', '차량용 X백'처럼 앞말이 실제 상품 정체성을 바꾸는 경우 전체 표현의 유통 의미를 우선한다.",
                  "예: '꿩안경'은 사람용 안경이 아니라 꿩·닭 등 조류 사육에 쓰는 가림/쪼기 방지 액세서리이므로 조류·소동물 사육용품 쪽 용어를 만든다.",
                  "예: '멀티탭 트레이'는 주방 쟁반이 아니라 멀티탭·케이블을 정리/수납하는 전선정리 액세서리로 해석한다.",
                  "예: '은박담요'는 일반 침구 담요보다 비상·보온·응급·야외용 열반사 담요의 정체성을 우선한다.",
                  "예: '차량용 무지 트레블백'은 '차량용'이 상위 정체성이 아니라 여행/수납 가방이 핵심 제품명사이고 차량 사용은 맥락이다.",
                  "모델명에서 실제로 판매하는 물건의 핵심 제품명사를 찾고, 샵플링 원장에서 검색할 한국어 동의어를 만든다.",
                  "동의어에는 카테고리에서 쓰는 표준 표기와 흔한 표기 차이(예: 브러시/브러쉬)를 포함한다.",
                  "색상·재질·크기·수량·형번·스타일·포장 여부는 핵심 제품명사에서 제외하고 ignoredAttributes에 넣는다.",
                  "제품의 사용 영역이나 대상은 contextTerms에 넣되 효능·인증·구성품을 추측하지 않는다.",
                  "catalogCategoryTerms에는 샵플링 원장에서 실제 문자열 검색이 잘 되도록 짧은 분류 앵커를 넣는다. 한 문장처럼 길게 쓰지 말고, 상위 분기 명사 2~3개와 세부 제품군 명사 2~4개를 각각 독립 항목으로 둔다.",
                  "예를 들어 조류 사육 제품이면 ['조류용품','조류','소동물용품','사육용품']처럼, 두피 브러시면 ['두피관리용품','두피','헤어브러시','두피마사지기']처럼 넓은 분기와 세부 후보를 함께 만든다.",
                  "얼굴 세안 도구라면 ['클렌징/필링','클렌징','피부관리기','뷰티소품','세안']처럼 실제 한국 쇼핑 카테고리에 쓰일 법한 짧은 명사를 함께 만든다.",
                  "재봉·수선 도구라면 ['수예용품','수예','재봉틀용품','반짇고리','부자재']처럼 제품명 자체에 없는 상위 분류 앵커도 의미상 타당하면 포함한다.",
                  "'용품', '기타', '액세서리'처럼 단독으로 너무 넓은 말은 넣지 않는다.",
                  "productFormTerms에는 실제 판매되는 물체의 형태/종류를 짧은 명사로 넣는다. 예: 브러시·도구·가방·담요·보호구·용기·거치대·세정제·크림·젤·오일·의류. 용도와 형태를 혼동하지 않는다.",
                  "incompatibleCategoryTerms에는 같은 용도 영역이어도 물체 형태가 달라 절대 선택하면 안 되는 카테고리 명사를 넣는다. 예: 세안 브러시는 클렌징폼·클렌징젤·클렌징오일·클렌징크림·클렌징로션·클렌징워터·클렌징비누·클렌징티슈·리무버 같은 소모성 세정제를 차단한다.",
                  "반대로 액상·크림·폼 같은 소모품이라면 브러시·도구·기기·거치대·용기 같은 하드웨어 후보를 incompatibleCategoryTerms에 넣는다. 가방이면 자동차부품·세차용품처럼 사용 장소만 같은 다른 물체를 차단한다.",
                  "blockedCategoryTerms에는 제품 정체성과 명백히 충돌하는 카테고리 분기만 넣는다. '생활', '용품', '기타' 같은 광범위한 말은 금지한다.",
                  "marketCategoryPaths에는 검색 결과에서 실제로 확인된 카테고리 경로만 넣고, 확인되지 않았으면 빈 배열로 둔다.",
                  "marketEvidenceSummary에는 어떤 물건·용도로 분류됐는지 간결하게 쓰고, marketEvidenceConfidence는 검색 근거의 일관성만 평가한다.",
                  "합성어 안의 색상어는 함부로 분리하지 않는다. 블랙보드와 블랙박스는 각각 완전한 제품명사다.",
                  "예: '걸이형 모공브러쉬 블랙'은 얼굴 모공 세정용 도구다. coreProductTerms ['모공브러쉬','세안브러시','클렌징브러시','페이스브러시'], contextTerms ['얼굴','세안','클렌징','피부관리'], catalogCategoryTerms ['피부관리기','뷰티소품','클렌징','세안'], productFormTerms ['브러시','수동도구'], incompatibleCategoryTerms ['클렌징폼','클렌징젤','클렌징오일','클렌징크림','클렌징로션','클렌징워터','클렌징비누','클렌징티슈','리무버'], blockedCategoryTerms ['헤어','두피','청소','세차','반려동물'], ignoredAttributes ['걸이형','블랙']처럼 분리한다.",
                  "예: '사이드 테이블 블랙' → coreProductTerms ['사이드테이블','테이블'], ignoredAttributes ['블랙'].",
                  "예: '투구골무' → coreProductTerms ['골무','재봉골무'], contextTerms ['수예','바느질'].",
                  "각 배열은 관련성이 높은 순서이며, 근거가 없으면 빈 배열로 둔다.",
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
                  task: "모델명별 카테고리 검색 프로필 생성",
                  evidenceMode: options.useWebSearch
                    ? "web_search_with_naver_priority"
                    : "model_name_fallback",
                  products: options.normalizedInputs.map((input) => ({
                    itemId: input.itemId,
                    modelNumber: input.modelNumber,
                    modelName: input.productName,
                    optionLabels: input.optionLabels,
                    referenceLinks: input.chinaProductLinks,
                  })),
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_category_search_profiles",
            strict: true,
            schema: searchProfileSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw createOpenAiCategoryRequestError(
        response,
        payload,
        "OpenAI 모델명 분석 요청",
      );
    }
    const parsed = parseOpenAiStructuredOutput(payload);
    if (!Array.isArray(parsed.results)) {
      throw new Error("OpenAI 모델명 분석 결과 형식이 올바르지 않습니다.");
    }
    const profiles = normalizeShoplingCategorySearchProfiles(
      parsed.results,
      options.normalizedInputs,
    );
    const searchEvidence = extractWebSearchEvidence(payload);
    return profiles.map((profile) => ({
      ...profile,
      sourceDomains: searchEvidence.sourceDomains,
      groundingStatus:
        options.useWebSearch && searchEvidence.sourceDomains.length > 0
          ? ("web" as const)
          : ("model_fallback" as const),
      marketEvidenceConfidence:
        options.useWebSearch && searchEvidence.sourceDomains.length > 0
          ? profile.marketEvidenceConfidence ?? 0
          : Math.min(49, profile.marketEvidenceConfidence ?? 0),
      ...(!options.useWebSearch || !searchEvidence.sourceDomains.length
        ? { marketCategoryPaths: [] }
        : {}),
    }));
  } finally {
    clearTimeout(timer);
  }
}

function extractWebSearchEvidence(payload: OpenAiResponse) {
  let called = false;
  const domains = new Set<string>();
  for (const output of payload.output ?? []) {
    if (output.type !== "web_search_call") continue;
    called = true;
    for (const source of output.action?.sources ?? []) {
      try {
        const hostname = new URL(text(source.url)).hostname
          .toLocaleLowerCase("en-US")
          .replace(/^www\./, "");
        if (hostname) domains.add(hostname);
      } catch {
        // Ignore malformed source URLs returned by the upstream search tool.
      }
    }
  }
  return { called, sourceDomains: [...domains].slice(0, 8) };
}

export async function generateShoplingCategoryRecommendations(
  inputValue: unknown,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    searchProfiles?: ReadonlyMap<string, ShoplingCategorySearchProfile>;
  } = {},
) {
  const inputs = parseProductCategoryInputs(inputValue);
  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    throw new Error(
      "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 업데이트를 실행하세요.",
    );
  }
  const candidatesByItem = new Map(
    inputs.map((input) => [
      input.itemId,
      shortlistShoplingCategories(
        input,
        snapshot.categories,
        undefined,
        options.searchProfiles?.get(input.itemId),
      ),
    ]),
  );
  const supportedInputs = inputs.filter(
    (input) => (candidatesByItem.get(input.itemId)?.length ?? 0) > 0,
  );
  const unsupportedInputs = inputs.filter(
    (input) => (candidatesByItem.get(input.itemId)?.length ?? 0) === 0,
  );
  const apiKey = text(options.apiKey ?? process.env.SHOPLING_CATEGORY_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 AI 카테고리를 추천할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    if (!supportedInputs.length) {
      return {
        status: "success" as const,
        snapshot: {
          collectedAt: snapshot.collectedAt,
          categoryCount: snapshot.categoryCount,
          hash: snapshot.hash,
        },
        autoApplyConfidence: AUTO_APPLY_CONFIDENCE,
        results: unsupportedInputs.map((input) =>
          noMatchRecommendation(
            input,
            options.searchProfiles?.get(input.itemId),
          ),
        ),
      };
    }
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 2600,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 샵플링 표준카테고리 분류 담당자다.",
                  "각 상품은 제공된 candidatePaths 중 정확히 하나만 선택한다.",
                  "후보에 없는 경로를 새로 만들거나 철자를 바꾸지 않는다.",
                  "모델명·옵션과 categorySearchProfile의 시장 검색 근거가 증명하는 상품 정체성만 사용하고 효능·구성품을 추측하지 않는다.",
                  "marketCategoryPaths와 catalogCategoryTerms는 단순 단어 겹침보다 우선한다. blockedCategoryTerms가 포함된 후보는 선택하지 않는다.",
                  "시장 검색 근거가 model_fallback이거나 신뢰도가 낮으면 최종 confidence도 보수적으로 책정한다.",
                  "애매하면 confidence를 낮게 주고 alternatives에 가까운 후보를 넣는다.",
                  "이미 카테고리가 있는 상품도 추천은 하되 기존값을 존중한다.",
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
                    task: "상품별 샵플링 표준카테고리 선택",
                    snapshotHash: snapshot.hash,
                    products: supportedInputs.map((input) => ({
                      ...input,
                      categorySearchProfile:
                        options.searchProfiles?.get(input.itemId) ?? null,
                      candidatePaths: candidatesByItem
                        .get(input.itemId)!
                        .map((candidate) => candidate.path),
                    })),
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
            name: "shopling_category_recommendations",
            strict: true,
            schema: recommendationSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw createOpenAiCategoryRequestError(
        response,
        payload,
        "OpenAI 카테고리 선택 요청",
      );
    }
    const parsed = parseOpenAiStructuredOutput(payload);
    if (!Array.isArray(parsed.results)) {
      throw new Error("OpenAI 카테고리 결과 형식이 올바르지 않습니다.");
    }
    const inputById = new Map(
      supportedInputs.map((input) => [input.itemId, input]),
    );
    const results: ProductCategoryRecommendation[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.results) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const itemId = text(row.itemId);
      if (!inputById.has(itemId) || seen.has(itemId)) continue;
      const candidatePaths = candidatesByItem
        .get(itemId)!
        .map((candidate) => candidate.path);
      const selectedPath = text(row.selectedPath);
      if (!candidatePaths.includes(selectedPath)) {
        throw new Error(`${itemId}의 AI 결과가 최신 카테고리 후보에 없습니다.`);
      }
      const currentCategory = inputById.get(itemId)!.currentCategory;
      const skippedExisting = Boolean(currentCategory);
      const selectedCandidate = candidatesByItem
        .get(itemId)!
        .find((candidate) => candidate.path === selectedPath)!;
      const matchKind = selectedCandidate.matchKind ?? "context";
      const searchProfile = options.searchProfiles?.get(itemId);
      const confidence = calibrateShoplingCategoryConfidence({
        confidence: Number(row.confidence),
        matchKind,
        profile: searchProfile,
      });
      results.push({
        itemId,
        modelNumber: inputById.get(itemId)!.modelNumber,
        selectedPath,
        confidence,
        reason: text(row.reason).slice(0, 240),
        alternatives: Array.isArray(row.alternatives)
          ? row.alternatives.map(text).filter((path) => candidatePaths.includes(path)).slice(0, 3)
          : [],
        autoApply: canAutoApplyShoplingCategory({
          confidence,
          currentCategory,
          matchKind,
        }),
        skippedExisting,
        candidatePaths,
        matchKind,
        marketEvidence: marketEvidenceFromProfile(searchProfile),
      });
      seen.add(itemId);
    }
    if (results.length !== supportedInputs.length) {
      throw new Error("일부 상품의 AI 카테고리 결과가 누락되었습니다.");
    }
    const resultById = new Map(results.map((result) => [result.itemId, result]));
    for (const input of unsupportedInputs) {
      resultById.set(
        input.itemId,
        noMatchRecommendation(
          input,
          options.searchProfiles?.get(input.itemId),
        ),
      );
    }
    return {
      status: "success",
      snapshot: {
        collectedAt: snapshot.collectedAt,
        categoryCount: snapshot.categoryCount,
        hash: snapshot.hash,
      },
      autoApplyConfidence: AUTO_APPLY_CONFIDENCE,
      results: inputs.map((input) => resultById.get(input.itemId)!),
    };
  } finally {
    clearTimeout(timer);
  }
}

function createOpenAiCategoryRequestError(
  response: Response,
  payload: OpenAiResponse,
  label: string,
): OpenAiCategoryRequestError {
  const status = Number(response.status) || undefined;
  const code = text(payload.error?.code || payload.error?.type);
  const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
  const detail = text(payload.error?.message);
  const suffix = [
    status ? `HTTP ${status}` : "",
    code ? `code=${code}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const error = new Error(
    `${label}이 실패했습니다${suffix ? ` (${suffix})` : ""}${
      detail ? `: ${detail}` : ""
    }`,
  ) as OpenAiCategoryRequestError;
  error.name = "OpenAiCategoryRequestError";
  error.status = status;
  error.code = code;
  error.retryAfterMs = retryAfterMs;
  return error;
}

function parseRetryAfterMs(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(normalized);
  if (!Number.isFinite(date)) return 0;
  return Math.min(30_000, Math.max(0, date - Date.now()));
}

function noMatchRecommendation(
  input: ProductCategoryInput,
  profile?: ShoplingCategorySearchProfile | null,
): ProductCategoryRecommendation {
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    selectedPath: "",
    confidence: 0,
    reason:
      "모델명의 핵심 제품명사 및 용도와 일치하는 샵플링 표준카테고리를 찾지 못했습니다. 엉뚱한 후보는 제시하지 않고 검토 상태로 남겼습니다.",
    alternatives: [],
    autoApply: false,
    skippedExisting: Boolean(input.currentCategory),
    candidatePaths: [],
    matchKind: "none",
    marketEvidence: marketEvidenceFromProfile(profile),
  };
}

function marketEvidenceFromProfile(
  profile?: ShoplingCategorySearchProfile | null,
): ProductCategoryMarketEvidence {
  return {
    status: profile?.groundingStatus === "web" ? "web" : "model_fallback",
    confidence: Math.max(
      0,
      Math.min(100, Math.round(Number(profile?.marketEvidenceConfidence) || 0)),
    ),
    summary: text(profile?.marketEvidenceSummary).slice(0, 240),
    categoryPaths: (profile?.marketCategoryPaths ?? [])
      .map(text)
      .filter(Boolean)
      .slice(0, 4),
    sourceDomains: (profile?.sourceDomains ?? [])
      .map(text)
      .filter(Boolean)
      .slice(0, 8),
  };
}
