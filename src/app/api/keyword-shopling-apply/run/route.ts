import { NextResponse } from "next/server";
import { dispatchKeywordShoplingApplyActions } from "@/lib/keywordShoplingApplyRunner";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let body: { execution_plan_json?: unknown; mode?: unknown; confirmation_text?: unknown; max_items?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 }); }
  const result = await dispatchKeywordShoplingApplyActions(body);
  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
