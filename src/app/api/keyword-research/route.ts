import { NextResponse } from "next/server";
import { researchKeyword } from "@/lib/keywordResearchServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 500;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { keyword?: unknown };
    const result = await researchKeyword(body.keyword);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "키워드 조회 중 오류가 발생했습니다.",
      },
      { status: 400 },
    );
  }
}
