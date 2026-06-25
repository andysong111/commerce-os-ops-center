import { NextResponse } from "next/server";
import { fetchKeywordShoplingApplyActionsResult, isValidKeywordShoplingApplyRequestId } from "@/lib/keywordShoplingApplyRunner";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() || undefined;
  if (requestId && !isValidKeywordShoplingApplyRequestId(requestId)) return NextResponse.json({ status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId }, { status: 400 });
  const result = await fetchKeywordShoplingApplyActionsResult(requestId);
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
