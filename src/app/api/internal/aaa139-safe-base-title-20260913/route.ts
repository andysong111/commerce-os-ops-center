import { NextResponse } from "next/server";
import { loadKeywordEngineElonLabShoplingContexts } from "@/lib/keywordEngineElonLabShopling";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRM = "APPLY_AAA139_SAFE_BASE_TITLES_20260913_V1";
const SEARCH = "즉석복권긁개,복권스크래퍼키링,헤라스크래퍼,스크래퍼헤라,복권긁개,긁는도구,복권긁기칼,복권스크래치도구,복권스크래퍼,스크래치긁개";
const TITLES: Record<string, string> = {
  "122546": "긁는도구 복권긁기 복권스크래퍼",
  "122548": "긁는도구 복권긁개 헤라스크래퍼",
  "122550": "복권스크래퍼 복권긁개 스크래퍼헤라",
  "122551": "복권긁기 복권긁개 헤라스크래퍼",
  "122552": "스크래퍼헤라 긁는도구 복권긁개",
  "122553": "복권긁기 스크래퍼 스크래퍼헤라",
};
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
  url.pathname = "/prod/prod_modify_api.phtml";
  url.search = "?mode=2";
  return url.toString();
}

function remaining(value: string) {
  return PROHIBITED.filter((term) => String(value ?? "").includes(term));
}

export async function GET(request: Request) {
  const confirm = new URL(request.url).searchParams.get("confirm")?.trim() ?? "";
  if (confirm !== CONFIRM) {
    return NextResponse.json({ status: "blocked" }, { status: 400 });
  }
  const goodsKeys = Object.keys(TITLES);
  for (const title of Object.values(TITLES)) {
    if (remaining(title).length) {
      return NextResponse.json({ status: "blocked", reason: "unsafe_title", title }, { status: 400 });
    }
  }
  const config = shoplingReadConfigFromEnv(env());
  const xml = `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdMdy>` +
    `<login_id>${cdata(config.loginId)}</login_id><company_id>${cdata(config.companyId)}</company_id><api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
    goodsKeys.map((goodsKey) => `<goodsInfo><goods_key>${goodsKey}</goods_key><prod_nm>${cdata(TITLES[goodsKey])}</prod_nm><site_srch>${cdata(SEARCH)}</site_srch></goodsInfo>`).join("") +
    `</apiProdMdy></reqst>`;
  const response = await postShoplingXml(endpoint(config.productsUrl), xml, {
    headers: { accept: "application/xml, text/xml", "content-type": "application/xml; charset=utf-8", "user-agent": "commerce-os-aaa139-title-hotfix/1.0" },
    timeoutMs: 45_000,
  });
  const body = await response.text();
  const after = await loadKeywordEngineElonLabShoplingContexts(goodsKeys);
  const verification = after.map((row) => ({
    goodsKey: row.goodsKey,
    title: row.productName,
    search: row.currentSiteSearch,
    titleVerified: row.productName === TITLES[row.goodsKey],
    titleRemaining: remaining(row.productName),
    searchRemaining: remaining(row.currentSiteSearch),
  }));
  const verified = verification.every((row) => row.titleVerified && row.titleRemaining.length === 0 && row.searchRemaining.length === 0);
  return NextResponse.json({
    status: verified ? "success" : "partial",
    httpStatus: response.status,
    transportMode: response.transportMode,
    responsePreview: body.slice(0, 800),
    verification,
  }, { status: verified ? 200 : 207 });
}
