import { NextResponse } from "next/server";
import { dispatchShoplingPriceModifyActions } from "@/lib/shoplingPriceModifyRunner";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let body: { goods_key?: unknown; policy_overrides?: unknown; goods_key_group_json?: unknown; goodsKeyGroupJson?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 }); }
  const result = await dispatchShoplingPriceModifyActions(typeof body.goods_key === "string" ? body.goods_key : "", body.policy_overrides, body.goods_key_group_json ?? body.goodsKeyGroupJson);
  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
