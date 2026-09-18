import { NextRequest } from "next/server";
import {
  generateReliableShoplingCategoryRecommendations,
  isRetryableCategoryOutputError,
} from "@/lib/shoplingCategoryRecommendationRunner";
import { generateNaverFirstShoplingCategoryRecommendations } from "@/lib/shoplingCategoryNaverFirst";
import { rerankNaverGroundedShoplingRecommendations } from "@/lib/shoplingCategoryOpenAiReranker";
import { parseProductCategoryInputs } from "@/lib/shoplingCategoryScoring";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const maxDuration = 300;
const CATEGORY_ENGINE_VERSION = "naver-openai-constrained-v3";


export async function GET() {
  const hasClientId = Boolean(
    String(
      process.env.NAVER_CLIENT_ID ??
        process.env.NAVER_SEARCH_CLIENT_ID ??
        "",
    ).trim(),
  );
  const hasClientSecret = Boolean(
    String(
      process.env.NAVER_CLIENT_SECRET ??
        process.env.NAVER_SEARCH_CLIENT_SECRET ??
        "",
    ).trim(),
  );
  const openAiRerankerConfigured = Boolean(
    String(
      process.env.SHOPLING_CATEGORY_OPENAI_API_KEY ??
        "",
    ).trim(),
  );
  return Response.json(
    {
      ok: true,
      engineVersion: CATEGORY_ENGINE_VERSION,
      provider: "naver_shopping_grounding_plus_openai_constrained_rerank",
      configured: hasClientId && hasClientSecret,
      openAiRerankerConfigured,
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

    // 운영 기본:
    // 모델명 -> 네이버 쇼핑 실제 카테고리 근거 -> 샵플링 실제 후보 shortlist
    // -> OpenAI가 후보 안에서만 의미 재정렬 -> 사람 검토.
    // OpenAI는 새 카테고리 경로를 만들 수 없고, legacy만 긴급 롤백용으로 남긴다.
    const categoryMode = requestedCategoryMode === "legacy" ? "legacy" : "naver_first";
    const rerankModel =
      process.env.OPENAI_CATEGORY_RERANK_MODEL ||
      process.env.OPENAI_CATEGORY_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5-mini";

    const generatedBase =
      categoryMode === "legacy"
        ? await generateReliableShoplingCategoryRecommendations(inputs, {
            timeoutMs: 60_000,
            retryFailedIndividually,
          })
        : await generateNaverFirstShoplingCategoryRecommendations(inputs, {
            timeoutMs: 30_000,
          });

    const generated =
      categoryMode === "legacy"
        ? generatedBase
        : await rerankNaverGroundedShoplingRecommendations(
            inputs,
            generatedBase,
            {
              model: rerankModel,
              timeoutMs: 45_000,
            },
          );

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
        constrainedOpenAiRerank: categoryMode === "naver_first",
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
    const status = /OPENAI_API_KEY|카테고리 스냅샷|GITHUB_/.test(message)
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
