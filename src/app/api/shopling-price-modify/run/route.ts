import { NextResponse } from "next/server";
import { dispatchShoplingPriceModifyActions } from "@/lib/shoplingPriceModifyRunner";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let body: { goods_key?: unknown; policy_overrides?: unknown; goods_key_group_json?: unknown; goodsKeyGroupJson?: unknown; base_consumer_price?: unknown; base_sell_price?: unknown; base_purchase_price?: unknown; base_prices_json?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 }); }
  const result = await dispatchShoplingPriceModifyActions(typeof body.goods_key === "string" ? body.goods_key : "", body.policy_overrides, body.goods_key_group_json ?? body.goodsKeyGroupJson, { base_consumer_price: body.base_consumer_price, base_sell_price: body.base_sell_price, base_purchase_price: body.base_purchase_price, base_prices_json: body.base_prices_json });
  return NextResponse.json(result, { status: result.status === "queued" ? 200 : 400 });
}
