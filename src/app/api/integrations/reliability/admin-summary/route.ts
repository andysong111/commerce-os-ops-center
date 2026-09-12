import { NextResponse } from "next/server";
import {
  authorizeReliabilityAdminRead,
} from "@/lib/reliability/reliabilityAdminReadAuth";
import { loadAiSaurusReliabilityAdminSummary } from "@/lib/reliability/aiSaurusAdminSummary";
import { loadAiSaurusReliabilityExactSummaryCounts } from "@/lib/reliability/aiSaurusAdminSummaryCounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = authorizeReliabilityAdminRead(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      {
        status: auth.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const [detailSummary, exactSummary] = await Promise.all([
      loadAiSaurusReliabilityAdminSummary(),
      loadAiSaurusReliabilityExactSummaryCounts(),
    ]);
    const summary = {
      ...detailSummary,
      summary: exactSummary,
    };
    return NextResponse.json(
      { ok: true, summary },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("[reliability/admin-summary] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message:
        error instanceof Error
          ? error.message.slice(0, 240)
          : "Reliability admin summary failed",
    });
    return NextResponse.json(
      {
        ok: false,
        code: "RELIABILITY_ADMIN_SUMMARY_FAILED",
        message: "AI-Saurus 자동개선 현황을 집계하지 못했습니다.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
