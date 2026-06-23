import { NextResponse } from "next/server";
import { fetchShoplingProductUploadActionsResult, isValidShoplingRequestId } from "@/lib/shoplingProductUploadRunner";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() || undefined;
  if (requestId && !isValidShoplingRequestId(requestId)) {
    return NextResponse.json({ status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId }, { status: 400 });
  }
  const result = await fetchShoplingProductUploadActionsResult(requestId);
  const statusCode = result.status === "pending" ? 200 : result.status === "error" ? 400 : 200;
  return NextResponse.json(result, { status: statusCode });
}
