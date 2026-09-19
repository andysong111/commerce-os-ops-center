import type {
  ProductCategoryInput,
  ProductCategoryRecommendation,
  ShoplingCategorySearchProfile,
} from "./shoplingCategoryCatalog.ts";
import { isOpenAiStructuredOutputIncompleteError } from "./openAiStructuredOutput.ts";

const CATEGORY_BATCH_SIZE = 5;
const CATEGORY_BATCH_CONCURRENCY = 3;
const CATEGORY_RECOMMENDATION_TIMEOUT_MS = 55_000;
const SEARCH_PROFILE_BATCH_SIZE = 5;
const SEARCH_PROFILE_BATCH_CONCURRENCY = 3;
const SEARCH_PROFILE_TIMEOUT_MS = 55_000;
const SEARCH_PROFILE_FALLBACK_RETRY_TIMEOUT_MS = 35_000;
const CATEGORY_RETRY_BASE_DELAY_MS = 900;
const CATEGORY_RETRY_MAX_DELAY_MS = 12_000;

type SearchProfileGenerator = (
  inputs: ProductCategoryInput[],
  options?: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    useWebSearch?: boolean;
  },
) => Promise<ShoplingCategorySearchProfile[]>;

type RecommendationResult = {
  status: "success";
  snapshot: {
    collectedAt: string;
    categoryCount: number;
    hash: string;
  };
  autoApplyConfidence: number;
  results: ProductCategoryRecommendation[];
};

type RecommendationGenerator = (
  inputValue: unknown,
  options?: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    searchProfiles?: ReadonlyMap<string, ShoplingCategorySearchProfile>;
  },
) => Promise<RecommendationResult>;

type RecommendationDependencies = {
  generateSearchProfiles?: SearchProfileGenerator;
  generateRecommendations?: RecommendationGenerator;
};

type RecommendationOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  useWebSearch?: boolean;
  retryFailedIndividually?: boolean;
  skipSearchProfiles?: boolean;
  dependencies?: RecommendationDependencies;
};

export type CategoryRecommendationFailure = {
  itemId: string;
  modelNumber: string;
  productName: string;
  stage: "search_profile" | "recommendation";
  retryable: boolean;
  code:
    | "AI_TIMEOUT"
    | "AI_RATE_LIMIT"
    | "AI_NETWORK"
    | "AI_UPSTREAM"
    | "AI_OUTPUT_INCOMPLETE"
    | "AI_INVALID_RESPONSE"
    | "AI_UNKNOWN";
  retryAfterMs: number;
  message: string;
};

export type ReliableCategoryRecommendationResult = {
  status: "success" | "partial";
  snapshot: RecommendationResult["snapshot"] | null;
  autoApplyConfidence: number | null;
  results: ProductCategoryRecommendation[];
  failures: CategoryRecommendationFailure[];
};

export async function generateReliableShoplingCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: RecommendationOptions = {},
): Promise<ReliableCategoryRecommendationResult> {
  if (!inputs.length) {
    throw new Error("AI 카테고리를 설정할 상품을 선택하세요.");
  }

  const failureById = new Map<string, CategoryRecommendationFailure>();
  const profileById = new Map<string, ShoplingCategorySearchProfile>();

  if (!options.skipSearchProfiles) {
    const profileBatchSize = options.retryFailedIndividually
      ? 1
      : SEARCH_PROFILE_BATCH_SIZE;
    const profileBatches = chunk(inputs, profileBatchSize);
    const profileSettled = await mapWithConcurrencySettled(
      profileBatches,
      SEARCH_PROFILE_BATCH_CONCURRENCY,
      (batch) => generateSearchProfilesWithRecovery(batch, options),
    );

    profileSettled.forEach((settled, index) => {
      const batch = profileBatches[index];
      if (settled.status === "rejected") {
        throwIfFatalCategoryError(settled.reason);
        for (const input of batch) {
          failureById.set(
            input.itemId,
            categoryFailure(input, "search_profile", settled.reason),
          );
        }
        return;
      }
      for (const profile of settled.value) {
        profileById.set(String(profile.itemId ?? ""), profile);
      }
      for (const input of batch) {
        if (profileById.has(input.itemId)) continue;
        failureById.set(
          input.itemId,
          categoryFailure(
            input,
            "search_profile",
            new Error("모델명 핵심명사 분석 결과가 누락되었습니다."),
          ),
        );
      }
    });
  }

  const recommendationInputs = options.skipSearchProfiles
    ? inputs
    : inputs.filter((input) => profileById.has(input.itemId));
  const recommendationBatches = chunk(
    recommendationInputs,
    CATEGORY_BATCH_SIZE,
  );
  const recommendationSettled = await mapWithConcurrencySettled(
    recommendationBatches,
    CATEGORY_BATCH_CONCURRENCY,
    (batch) => generateBatchWithRecovery(batch, options, profileById),
  );
  const completedResults: RecommendationResult[] = [];

  recommendationSettled.forEach((settled, index) => {
    const batch = recommendationBatches[index];
    if (settled.status === "rejected") {
      throwIfFatalCategoryError(settled.reason);
      for (const input of batch) {
        failureById.set(
          input.itemId,
          categoryFailure(input, "recommendation", settled.reason),
        );
      }
      return;
    }
    completedResults.push(settled.value);
  });

  const recommendationById = new Map<string, ProductCategoryRecommendation>();
  for (const result of completedResults) {
    for (const recommendation of result.results) {
      recommendationById.set(recommendation.itemId, recommendation);
    }
  }
  for (const input of recommendationInputs) {
    if (
      recommendationById.has(input.itemId) ||
      failureById.has(input.itemId)
    ) {
      continue;
    }
    failureById.set(
      input.itemId,
      categoryFailure(
        input,
        "recommendation",
        new Error("AI 카테고리 결과가 누락되었습니다."),
      ),
    );
  }

  const first = completedResults[0] ?? null;
  const failures = inputs
    .map((input) => failureById.get(input.itemId))
    .filter((failure): failure is CategoryRecommendationFailure => Boolean(failure));
  return {
    status: failures.length ? "partial" : "success",
    snapshot: first?.snapshot ?? null,
    autoApplyConfidence: first?.autoApplyConfidence ?? null,
    results: inputs
      .map((input) => recommendationById.get(input.itemId))
      .filter(
        (recommendation): recommendation is ProductCategoryRecommendation =>
          Boolean(recommendation),
      ),
    failures,
  };
}

async function generateSearchProfilesWithRecovery(
  batch: ProductCategoryInput[],
  options: RecommendationOptions,
): Promise<ShoplingCategorySearchProfile[]> {
  const generator: SearchProfileGenerator =
    options.dependencies?.generateSearchProfiles ??
    defaultGenerateSearchProfiles;
  const profileOptions = {
    apiKey: options.apiKey,
    model: options.model,
    fetcher: options.fetcher,
    timeoutMs: Math.min(
      options.timeoutMs ?? SEARCH_PROFILE_TIMEOUT_MS,
      SEARCH_PROFILE_TIMEOUT_MS,
    ),
    useWebSearch: options.useWebSearch,
  };
  try {
    return await generator(batch, profileOptions);
  } catch (error) {
    if (!isRetryableCategoryRequestError(error)) throw error;
    if (batch.length === 1) {
      await waitBeforeCategoryRetry(error, options);
      return generator(batch, {
        ...profileOptions,
        timeoutMs: Math.min(
          profileOptions.timeoutMs,
          SEARCH_PROFILE_FALLBACK_RETRY_TIMEOUT_MS,
        ),
        useWebSearch: false,
      });
    }
    const middle = Math.ceil(batch.length / 2);
    const recovered = await Promise.all([
      generateSearchProfilesWithRecovery(batch.slice(0, middle), options),
      generateSearchProfilesWithRecovery(batch.slice(middle), options),
    ]);
    return recovered.flat();
  }
}

async function generateBatchWithRecovery(
  batch: ProductCategoryInput[],
  options: RecommendationOptions,
  searchProfiles: ReadonlyMap<string, ShoplingCategorySearchProfile>,
): Promise<RecommendationResult> {
  const generator: RecommendationGenerator =
    options.dependencies?.generateRecommendations ??
    defaultGenerateRecommendations;
  const recommendationOptions = {
    apiKey: options.apiKey,
    model: options.model,
    fetcher: options.fetcher,
    timeoutMs: Math.min(
      options.timeoutMs ?? CATEGORY_RECOMMENDATION_TIMEOUT_MS,
      CATEGORY_RECOMMENDATION_TIMEOUT_MS,
    ),
    searchProfiles,
  };
  try {
    return await generator({ items: batch }, recommendationOptions);
  } catch (error) {
    if (!isRetryableCategoryOutputError(error)) throw error;
    if (batch.length === 1) {
      await waitBeforeCategoryRetry(error, options);
      try {
        return await generator({ items: batch }, recommendationOptions);
      } catch (retryError) {
        if (!isRetryableCategoryOutputError(retryError)) throw retryError;
        throw new Error(
          `${batch[0].modelNumber || batch[0].productName}의 AI 응답이 두 번 연속 중간에서 잘렸습니다.`,
          { cause: retryError },
        );
      }
    }

    const singleResults = await Promise.all(
      batch.map((input) =>
        generateBatchWithRecovery([input], options, searchProfiles),
      ),
    );
    return mergeRecommendationResults(singleResults, batch);
  }
}

export function isRetryableCategoryOutputError(error: unknown) {
  if (isOpenAiStructuredOutputIncompleteError(error)) return true;
  if (error instanceof SyntaxError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Unterminated string|Unexpected end of JSON|JSON.*(?:잘렸|완성되지)|응답이 비어|output.*incomplete|max_output_tokens/i.test(
    message,
  );
}

export function isRetryableCategoryRequestError(error: unknown) {
  if (isRetryableCategoryOutputError(error)) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const status = categoryErrorNumber(error, "status");
  if (status === 408 || status === 429 || status >= 500) return true;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    name === "AbortError" ||
    /aborted|timeout|timed out|시간[이가을]? .*초과|fetch failed|network|ECONN|HTTP (?:408|429|5\d\d)|\b(?:408|429|5\d\d)\b|temporar/i.test(
      message,
    )
  );
}

function throwIfFatalCategoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /OPENAI_API_KEY|invalid[_ ]api[_ ]key|incorrect api key|insufficient_quota|credit_balance_exhausted|spend_limit|HTTP 401|HTTP 403|카테고리 스냅샷|GITHUB_/i.test(
      message,
    )
  ) {
    throw error;
  }
}

function categoryFailure(
  input: ProductCategoryInput,
  stage: CategoryRecommendationFailure["stage"],
  error: unknown,
): CategoryRecommendationFailure {
  const diagnostic = categoryErrorDiagnostic(error);
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    stage,
    retryable: diagnostic.retryable,
    code: diagnostic.code,
    retryAfterMs: diagnostic.retryAfterMs,
    message: diagnostic.message,
  };
}

function categoryErrorDiagnostic(error: unknown): Pick<
  CategoryRecommendationFailure,
  "retryable" | "code" | "retryAfterMs" | "message"
> {
  const retryAfterMs = Math.min(
    CATEGORY_RETRY_MAX_DELAY_MS,
    Math.max(0, categoryErrorNumber(error, "retryAfterMs")),
  );
  const status = categoryErrorNumber(error, "status");
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isRetryableCategoryOutputError(error)) {
    return {
      retryable: true,
      code: "AI_OUTPUT_INCOMPLETE",
      retryAfterMs,
      message: "AI 응답이 중간에서 잘렸습니다.",
    };
  }
  if (status === 429 || /rate[_ ]limit|too many requests|HTTP 429/i.test(message)) {
    return {
      retryable: true,
      code: "AI_RATE_LIMIT",
      retryAfterMs,
      message:
        "AI 요청이 한꺼번에 몰려 제한되었습니다. 서버가 속도를 낮춰 재시도했지만 완료되지 않았습니다.",
    };
  }
  if (
    status === 408 ||
    name === "AbortError" ||
    /aborted|timeout|timed out|시간[이가을]? .*초과|HTTP 408/i.test(message)
  ) {
    return {
      retryable: true,
      code: "AI_TIMEOUT",
      retryAfterMs,
      message: "AI 기본 분석 제한시간을 초과했습니다.",
    };
  }
  if (status >= 500 || /HTTP 5\d\d|temporar|overloaded|slow down/i.test(message)) {
    return {
      retryable: true,
      code: "AI_UPSTREAM",
      retryAfterMs,
      message: "AI 서비스가 일시적으로 응답하지 않았습니다.",
    };
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return {
      retryable: true,
      code: "AI_NETWORK",
      retryAfterMs,
      message: "AI 연결이 일시적으로 끊겼습니다.",
    };
  }
  if (/형식|누락|비어/.test(message)) {
    return {
      retryable: false,
      code: "AI_INVALID_RESPONSE",
      retryAfterMs: 0,
      message: message.slice(0, 240),
    };
  }
  return {
    retryable: isRetryableCategoryRequestError(error),
    code: "AI_UNKNOWN",
    retryAfterMs,
    message: message.slice(0, 240) || "AI 카테고리 분석을 완료하지 못했습니다.",
  };
}

function categoryErrorNumber(error: unknown, key: "status" | "retryAfterMs") {
  if (!error || typeof error !== "object") return 0;
  const value = Number((error as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : 0;
}

async function waitBeforeCategoryRetry(
  error: unknown,
  options: RecommendationOptions,
) {
  if (options.dependencies) return;
  const retryAfterMs = categoryErrorNumber(error, "retryAfterMs");
  const delayMs = Math.min(
    CATEGORY_RETRY_MAX_DELAY_MS,
    Math.max(
      CATEGORY_RETRY_BASE_DELAY_MS + Math.floor(Math.random() * 300),
      retryAfterMs,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mergeRecommendationResults(
  results: RecommendationResult[],
  expectedInputs: ProductCategoryInput[],
): RecommendationResult {
  if (!results.length) {
    throw new Error("AI 카테고리 결과가 비어 있습니다.");
  }
  const first = results[0];
  const byId = new Map<string, ProductCategoryRecommendation>();
  for (const result of results) {
    for (const recommendation of result.results) {
      byId.set(recommendation.itemId, recommendation);
    }
  }
  const ordered = expectedInputs.map((input) => byId.get(input.itemId));
  if (ordered.some((value) => !value)) {
    throw new Error("일부 상품의 AI 카테고리 결과가 누락되었습니다.");
  }
  return {
    status: "success",
    snapshot: first.snapshot,
    autoApplyConfidence: first.autoApplyConfidence,
    results: ordered as ProductCategoryRecommendation[],
  };
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function defaultGenerateSearchProfiles(
  inputs: ProductCategoryInput[],
  options: Parameters<SearchProfileGenerator>[1],
): Promise<ShoplingCategorySearchProfile[]> {
  const { generateShoplingCategorySearchProfiles } = await import(
    "./shoplingCategoryCatalog.ts"
  );
  return generateShoplingCategorySearchProfiles(inputs, options);
}

async function defaultGenerateRecommendations(
  inputValue: unknown,
  options: Parameters<RecommendationGenerator>[1],
): Promise<RecommendationResult> {
  const { generateShoplingCategoryRecommendations } = await import(
    "./shoplingCategoryCatalog.ts"
  );
  return generateShoplingCategoryRecommendations(
    inputValue,
    options,
  ) as Promise<RecommendationResult>;
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
      const index = cursor;
      cursor += 1;
      try {
        result[index] = { status: "fulfilled", value: await worker(values[index]) };
      } catch (reason) {
        result[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => runWorker(),
    ),
  );
  return result;
}
