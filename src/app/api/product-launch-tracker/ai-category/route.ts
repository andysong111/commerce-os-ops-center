import { NextRequest } from "next/server";
import {
  generateReliableShoplingCategoryRecommendations,
  isRetryableCategoryOutputError,
} from "@/lib/shoplingCategoryRecommendationRunner";
import { generateNaverFirstShoplingCategoryRecommendations } from "@/lib/shoplingCategoryNaverFirst";
import { parseProductCategoryInputs } from "@/lib/shoplingCategoryScoring";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const maxDuration = 300;
const CATEGORY_ENGINE_VERSION = "naver-official-search-v1";


export async function GET() {
  const clientId = String(
    process.env.NAVER_CLIENT_ID ??
      process.env.NAVER_SEARCH_CLIENT_ID ??
      "",
  ).trim();
  const clientSecret = String(
    process.env.NAVER_CLIENT_SECRET ??
      process.env.NAVER_SEARCH_CLIENT_SECRET ??
      "",
  ).trim();
  const clientIdSource = process.env.NAVER_CLIENT_ID
    ? "NAVER_CLIENT_ID"
    : process.env.NAVER_SEARCH_CLIENT_ID
      ? "NAVER_SEARCH_CLIENT_ID"
      : "";
  const clientSecretSource = process.env.NAVER_CLIENT_SECRET
    ? "NAVER_CLIENT_SECRET"
    : process.env.NAVER_SEARCH_CLIENT_SECRET
      ? "NAVER_SEARCH_CLIENT_SECRET"
      : "";

  let probe: Record<string, unknown> | null = null;
  if (clientId && clientSecret) {
    try {
      const url =
        "https://openapi.naver.com/v1/search/shop.json?query=%EC%88%98%EA%B1%B4&display=1&start=1&sort=sim";
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      probe = {
        status: response.status,
        ok: response.ok,
        errorCode:
          body && typeof body === "object" && !Array.isArray(body)
            ? String((body as Record<string, unknown>).errorCode ?? "")
            : "",
        errorMessage:
          body && typeof body === "object" && !Array.isArray(body)
            ? String((body as Record<string, unknown>).errorMessage ?? "").slice(0, 160)
            : "",
      };
    } catch (error) {
      probe = {
        status: 0,
        ok: false,
        errorMessage: error instanceof Error ? error.message.slice(0, 160) : "probe_failed",
      };
    }
  }

  return Response.json(
    {
      ok: true,
      engineVersion: CATEGORY_ENGINE_VERSION,
      provider: "naver_shopping_search_api",
      configured: Boolean(clientId && clientSecret),
      clientIdSource,
      clientSecretSource,
      probe,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const inputs = parseProductCategoryInputs(body);
    const retryFailedIndividually = Boolean(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (body as Record<string, unknown>).retryFailedIndividually,
    );

    const requestedCategoryMode = String(
      process.env.SHOPLING_CATEGORY_MODE || "naver_first",
    )
      .trim()
      .toLocaleLowerCase("en-US");

    // 운영 기본은 의도적으로 단순하게 고정한다.
    // 모델명 그대로 네이버 쇼핑 검색 -> 실제 네이버 쇼핑 카테고리 확인
    // -> 저장된 샵플링 표준 카테고리에서 가장 가까운 경로만 제시.
    // legacy만 긴급 롤백용으로 남기고, shopling_first 같은 과거 값은 모두 naver_first로 수렴한다.
    const categoryMode = requestedCategoryMode === "legacy" ? "legacy" : "naver_first";
    const naverModel =
      process.env.OPENAI_NAVER_CATEGORY_MODEL || "gpt-4.1-mini";

    const generated =
      categoryMode === "legacy"
        ? await generateReliableShoplingCategoryRecommendations(inputs, {
            timeoutMs: 60_000,
            retryFailedIndividually,
          })
        : await generateNaverFirstShoplingCategoryRecommendations(inputs, {
            timeoutMs: 30_000,
            model: naverModel,
          });

    const generatedById = new Map(
      generated.results.map((row) => [row.itemId, row]),
    );

    const results = inputs.flatMap((input) => {
      const row = generatedById.get(input.itemId);
      if (!row) return [];
      const candidateChoices = buildCandidateChoices(
        row.selectedPath,
        row.alternatives,
        row.candidatePaths,
      );
      return [
        {
          ...row,
          autoApply: false,
          reason: normalizeModelNameTerminology(row.reason),
          alternatives: candidateChoices.slice(1, 3),
          candidateChoices,
          engineVersion: CATEGORY_ENGINE_VERSION,
        },
      ];
    });

    const failures = generated.failures.map((failure) => ({
      ...failure,
      message: normalizeModelNameTerminology(failure.message),
    }));

    console.info(
      JSON.stringify({
        event: "shopling_category_batch_complete",
        categoryMode,
        requestedCategoryMode,
        engineVersion: CATEGORY_ENGINE_VERSION,
        inputCount: inputs.length,
        resultCount: results.length,
        failureCount: failures.length,
        durationMs: Date.now() - startedAt,
        retryFailedIndividually,
        failureCodes: failures.reduce<Record<string, number>>(
          (counts, failure) => {
            counts[failure.code] = (counts[failure.code] ?? 0) + 1;
            return counts;
          },
          {},
        ),
      }),
    );

    for (const failure of failures) {
      console.warn(
        JSON.stringify({
          event: "shopling_category_item_failed",
          categoryMode,
          itemId: failure.itemId,
          modelNumber: failure.modelNumber,
          stage: failure.stage,
          code: failure.code,
          retryable: failure.retryable,
          retryAfterMs: failure.retryAfterMs,
        }),
      );
    }

    return Response.json(
      {
        ok: true,
        ...generated,
        categoryMode,
        engineVersion: CATEGORY_ENGINE_VERSION,
        complete: failures.length === 0,
        results,
        failures,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "AI 카테고리 추천에 실패했습니다.";
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "카테고리 검색 제한시간을 초과했습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
        : isRetryableCategoryOutputError(error)
          ? "AI 응답이 중간에서 잘렸습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
          : rawMessage;
    const status = /OPENAI_API_KEY|NAVER_CLIENT_ID|NAVER_CLIENT_SECRET|카테고리 스냅샷|GITHUB_/.test(message)
      ? 503
      : /시간[이가을]? .*초과|AbortError|aborted/i.test(message)
        ? 504
        : 400;

    console.error(
      JSON.stringify({
        event: "shopling_category_batch_failed",
        durationMs: Date.now() - startedAt,
        status,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: rawMessage.slice(0, 240),
      }),
    );

    return Response.json(
      { ok: false, message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function buildCandidateChoices(
  selectedPath: string,
  alternatives: string[],
  candidatePaths: string[],
) {
  return [selectedPath, ...alternatives, ...candidatePaths]
    .map((value) => String(value ?? "").trim())
    .filter((value, index, array) => value && array.indexOf(value) === index)
    .slice(0, 3);
}

function normalizeModelNameTerminology(value: string) {
  return String(value ?? "")
    .replaceAll("상품명이", "모델명이")
    .replaceAll("상품명은", "모델명은")
    .replaceAll("상품명에", "모델명에")
    .replaceAll("상품명", "모델명");
}
