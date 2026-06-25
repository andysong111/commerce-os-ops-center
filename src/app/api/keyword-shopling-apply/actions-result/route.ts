import { NextResponse } from "next/server";
import { fetchKeywordShoplingApplyActionsResult, isValidKeywordShoplingApplyRequestId } from "@/lib/keywordShoplingApplyRunner";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestId = params.get("request_id")?.trim() || undefined;
  const mode = params.get("mode")?.trim() || undefined;
  if (requestId && !isValidKeywordShoplingApplyRequestId(requestId)) return NextResponse.json({ status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId }, { status: 400 });
  if (mode && mode !== "dry_run" && mode !== "apply") return NextResponse.json({ status: "error", message: "mode는 dry_run 또는 apply여야 합니다.", requestId }, { status: 400 });
  const result = await fetchKeywordShoplingApplyActionsResult(requestId, mode as "dry_run" | "apply" | undefined);
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
