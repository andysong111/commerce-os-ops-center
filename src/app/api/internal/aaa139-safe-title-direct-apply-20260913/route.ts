import { NextResponse } from "next/server";
import {
  dispatchKeywordShoplingDirectApply,
  KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
} from "@/lib/keywordShoplingDirectApplyRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM = "DISPATCH_AAA139_SAFE_TITLES_20260913_V1";
const SEARCH = "즉석복권긁개,복권스크래퍼키링,헤라스크래퍼,스크래퍼헤라,복권긁개,긁는도구,복권긁기칼,복권스크래치도구,복권스크래퍼,스크래치긁개";

const TARGETS: Array<[string, string, string]> = [
  ["122546", "SMALL_00014", "긁는도구 복권긁기 복권스크래퍼"],
  ["122546", "SMALL_00069", "긁는도구 복권긁기 복권스크래퍼"],
  ["122546", "SMALL_00107", "긁는도구 복권긁기 복권스크래퍼"],
  ["122546", "SMALL_00116", "긁는도구 복권긁기 복권스크래퍼"],
  ["122546", "SMALL_00179", "긁는도구 복권긁기 복권스크래퍼"],
  ["122548", "SMALL_00069", "긁는도구 복권긁개 헤라스크래퍼"],
  ["122548", "SMALL_00107", "긁는도구 복권긁개 헤라스크래퍼"],
  ["122548", "SMALL_00116", "긁는도구 복권긁개 헤라스크래퍼"],
  ["122550", "SMALL_00069", "복권스크래퍼 복권긁개 스크래퍼헤라"],
  ["122550", "SMALL_00107", "복권스크래퍼 복권긁개 스크래퍼헤라"],
  ["122550", "SMALL_00116", "복권스크래퍼 복권긁개 스크래퍼헤라"],
  ["122551", "SMALL_00069", "복권긁기 복권긁개 헤라스크래퍼"],
  ["122552", "SMALL_00001", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00002", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00003", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00004", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00005", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00012", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00019", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00101", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00112", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00130", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00168", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122552", "SMALL_00194", "스크래퍼헤라 긁는도구 복권긁개"],
  ["122553", "SMALL_00001", "복권긁기 스크래퍼 스크래퍼헤라"],
  ["122553", "SMALL_00002", "복권긁기 스크래퍼 스크래퍼헤라"],
  ["122553", "SMALL_00003", "복권긁기 스크래퍼 스크래퍼헤라"],
  ["122553", "SMALL_00012", "복권긁기 스크래퍼 스크래퍼헤라"],
  ["122553", "SMALL_00194", "복권긁기 스크래퍼 스크래퍼헤라"],
];

export async function GET(request: Request) {
  const confirm = new URL(request.url).searchParams.get("confirm")?.trim() ?? "";
  if (confirm !== CONFIRM) {
    return NextResponse.json({ status: "blocked" }, { status: 400 });
  }
  const plan = TARGETS.map(([goods_key, mall_key, final_title]) => ({
    goods_key,
    mall_key,
    final_title,
    final_site_srch: SEARCH,
  }));
  const result = await dispatchKeywordShoplingDirectApply({
    execution_plan_json: JSON.stringify(plan),
    confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
    max_items: plan.length,
  });
  return NextResponse.json({ ...result, planCount: plan.length }, {
    status: result.status === "queued" ? 200 : 400,
  });
}
