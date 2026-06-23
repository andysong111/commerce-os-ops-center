import { NextResponse } from "next/server";
import { dispatchShoplingPriceModifyActions } from "@/lib/shoplingPriceModifyRunner";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let body: { goods_key?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 }); }
  const result = await dispatchShoplingPriceModifyActions(typeof body.goods_key === "string" ? body.goods_key : "");
  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
