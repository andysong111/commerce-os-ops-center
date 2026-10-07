import { NextResponse } from "next/server";
import {
  getEngineRunnerConfig,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";
import { loadKeywordOpportunityHistory } from "@/lib/keywordOpportunityHistoryBackfill";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const runner = getEngineRunnerConfig("keyword_engine");
  if (!runner) {
    return NextResponse.json(
      { ok: false, message: "키워드 엔진 설정을 찾을 수 없습니다." },
      { status: 500 },
    );
  }
  if (!isEngineDispatchTokenConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        status: "not_configured",
        message: "과거 키워드 산출물을 읽을 GitHub 설정이 필요합니다.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await loadKeywordOpportunityHistory({
      ...runner,
      token: process.env.GITHUB_ENGINE_DISPATCH_TOKEN!.trim(),
    });
    return NextResponse.json({ ok: true, status: "ready", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "history_backfill_error",
        message:
          error instanceof Error
            ? error.message
            : "과거 키워드 이력을 불러오지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
