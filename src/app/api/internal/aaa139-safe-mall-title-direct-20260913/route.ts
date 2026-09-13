import { NextResponse } from "next/server";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRM = "APPLY_AAA139_SAFE_MALL_TITLES_DIRECT_20260913_V1";
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
const PROHIBITED = ["한샘", "한샘시스템행거", "동행복권", "스피또", "로또", "동행복권로또"];

function env() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}
function cdata(value: string) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
function endpoint(base: string) {
  const url = new URL(base);
  url.pathname = "/prod/prod_each_mall_modify_api.phtml";
  url.search = "?mode=2";
  return url.toString();
}
function codes(xml: string) {
  return [...String(xml).matchAll(/<code>\s*(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?\s*<\/code>/gi)]
    .map((match) => String(match[1] ?? "").trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const confirm = new URL(request.url).searchParams.get("confirm")?.trim() ?? "";
  if (confirm !== CONFIRM) return NextResponse.json({ status: "blocked" }, { status: 400 });
  for (const [, , title] of TARGETS) {
    if (PROHIBITED.some((term) => title.includes(term))) {
      return NextResponse.json({ status: "blocked", reason: "unsafe_title", title }, { status: 400 });
    }
  }
  const config = shoplingReadConfigFromEnv(env());
  const results: Array<Record<string, unknown>> = [];
  const byGoods = new Map<string, Array<[string, string]>>();
  for (const [goodsKey, mallKey, title] of TARGETS) {
    const list = byGoods.get(goodsKey) ?? [];
    list.push([mallKey, title]);
    byGoods.set(goodsKey, list);
  }
  for (const [goodsKey, rows] of byGoods) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdEachMdy>` +
      `<login_id>${cdata(config.loginId)}</login_id><company_id>${cdata(config.companyId)}</company_id><api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
      rows.map(([mallKey, title]) => `<goodsInfo><mall_key>${mallKey}</mall_key><goods_key>${goodsKey}</goods_key><prod_nm>${cdata(title)}</prod_nm></goodsInfo>`).join("") +
      `</apiProdEachMdy></reqst>`;
    const response = await postShoplingXml(endpoint(config.productsUrl), xml, {
      headers: { accept: "application/xml, text/xml", "content-type": "application/xml; charset=utf-8", "user-agent": "commerce-os-aaa139-mall-title-hotfix/1.0" },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    const resultCodes = codes(body);
    results.push({
      goodsKey,
      requestedCount: rows.length,
      httpStatus: response.status,
      transportMode: response.transportMode,
      codes: resultCodes,
      successCodeCount: resultCodes.filter((code) => ["000", "001", "0", "00", "OK", "SUCCESS"].includes(code.toUpperCase())).length,
      responsePreview: body.slice(0, 700),
    });
  }
  const allHttpOk = results.every((row) => row.httpStatus === 200);
  return NextResponse.json({
    status: allHttpOk ? "success" : "partial",
    targetCount: TARGETS.length,
    results,
  }, { status: allHttpOk ? 200 : 207 });
}
