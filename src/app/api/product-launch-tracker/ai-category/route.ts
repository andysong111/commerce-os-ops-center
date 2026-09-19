import { NextRequest } from "next/server";
import {
  generateReliableShoplingCategoryRecommendations,
  isRetryableCategoryOutputError,
} from "@/lib/shoplingCategoryRecommendationRunner";
import { parseProductCategoryInputs } from "@/lib/shoplingCategoryScoring";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const maxDuration = 300;
const CATEGORY_ENGINE_VERSION = "openai-shopling-constrained-v4";

export async function GET() {
  const configured = Boolean(
    String(process.env.SHOPLING_CATEGORY_OPENAI_API_KEY ?? "").trim(),
  );
  return Response.json(
    {
      ok: true,
      engineVersion: CATEGORY_ENGINE_VERSION,
      provider: "openai_shopling_constrained_catalog",
      configured,
      webSearchEnabled: false,
      naverDependency: false,
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
    const model =
      process.env.OPENAI_CATEGORY_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5-mini";

    // 운영 기본:
    // 모델명·옵션 -> OpenAI 의미 분석(외부 웹검색 없음)
    // -> 실제 샵플링 카탈로그에서 후보 shortlist
    // -> OpenAI가 실제 후보 안에서만 최종 1~3순위 선택
    // -> 사람 검토. 후보 밖 경로는 기존 카탈로그 검증에서 거부된다.
    const generated = await generateReliableShoplingCategoryRecommendations(
      inputs,
      {
        timeoutMs: 60_000,
        retryFailedIndividually,
        useWebSearch: false,
        model,
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
        categoryMode: "openai_only",
        engineVersion: CATEGORY_ENGINE_VERSION,
        model,
        inputCount: inputs.length,
        resultCount: results.length,
        failureCount: failures.length,
        durationMs: Date.now() - startedAt,
        retryFailedIndividually,
        webSearchEnabled: false,
        naverDependency: false,
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
          categoryMode: "openai_only",
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
        categoryMode: "openai_only",
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
        ? "AI 카테고리 분석 제한시간을 초과했습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
        : isRetryableCategoryOutputError(error)
          ? "AI 응답이 중간에서 잘렸습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
          : rawMessage;
    const status = /SHOPLING_CATEGORY_OPENAI_API_KEY|OPENAI_API_KEY|카테고리 스냅샷|GITHUB_/.test(
      message,
    )
      ? 503
      : /시간[이가을]? .*초과|AbortError|aborted/i.test(message)
        ? 504
        : 400;

    console.error(
      JSON.stringify({
        event: "shopling_category_batch_failed",
        categoryMode: "openai_only",
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
