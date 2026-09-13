import { NextResponse } from "next/server";
import { loadKeywordEngineElonLabShoplingContexts } from "@/lib/keywordEngineElonLabShopling";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRM = "APPLY_SUBSTRING_KEYWORD_HOTFIX_20260913_V1";
const GOODS_KEYS = ["122553", "122552", "122551", "122550", "122548", "122546"] as const;
const PROHIBITED = ["한샘", "한샘시스템행거", "동행복권", "스피또", "로또", "동행복권로또"] as const;
const REPLACEMENTS: Record<string, string> = {
  "스피또긁기": "복권긁기칼",
  "스크래퍼헤라로또": "복권스크래퍼",
  "헤라스크래퍼로또": "스크래치긁개",
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function splitKeywords(value: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of String(value ?? "").split(/[,;\n|/]+/)) {
    const term = text(raw);
    const key = term.toLocaleLowerCase("ko-KR");
    if (!term || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }
  return result;
}
function containsProhibited(value: unknown) {
  const term = text(value).toLocaleLowerCase("ko-KR");
  return PROHIBITED.some((blocked) => term.includes(blocked.toLocaleLowerCase("ko-KR")));
}
function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return NextResponse.json({ status: "blocked" }, { status: 403 });
  }
  try {
    const beforeContexts = await loadKeywordEngineElonLabShoplingContexts([...GOODS_KEYS]);
    const beforeMap = new Map(beforeContexts.map((row) => [row.goodsKey, row.currentSiteSearch]));
    const rows = GOODS_KEYS.map((goodsKey) => {
      const before = beforeMap.get(goodsKey) ?? "";
      const beforeKeywords = splitKeywords(before);
      const used = new Set(beforeKeywords.filter((term) => !containsProhibited(term)).map((term) => term.toLocaleLowerCase("ko-KR")));
      const removed: string[] = [];
      const added: string[] = [];
      const after: string[] = [];
      for (const term of beforeKeywords) {
        if (!containsProhibited(term)) {
          after.push(term);
          continue;
        }
        removed.push(term);
        const replacement = REPLACEMENTS[term];
        if (!replacement) throw new Error(`NO_SAFE_REPLACEMENT:${goodsKey}:${term}`);
        if (containsProhibited(replacement)) throw new Error(`UNSAFE_REPLACEMENT:${goodsKey}:${replacement}`);
        const key = replacement.toLocaleLowerCase("ko-KR");
        if (!used.has(key)) {
          used.add(key);
          after.push(replacement);
          added.push(replacement);
        }
      }
      if (after.length !== beforeKeywords.length) throw new Error(`KEYWORD_COUNT_CHANGED:${goodsKey}:${beforeKeywords.length}->${after.length}`);
      if (after.some(containsProhibited)) throw new Error(`PROHIBITED_REMAINS_IN_PLAN:${goodsKey}`);
      return { goodsKey, before, afterPlanned: after.join(","), removed, added };
    });

    const config = shoplingReadConfigFromEnv(env());
    const goodsInfo = rows.map((row) => `<goodsInfo><goods_key>${escapeXml(row.goodsKey)}</goods_key><site_srch>${cdata(row.afterPlanned)}</site_srch></goodsInfo>`).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdMdy><login_id>${cdata(config.loginId)}</login_id><company_id>${escapeXml(config.companyId)}</company_id><api_auth_key>${escapeXml(config.authKey)}</api_auth_key>${goodsInfo}</apiProdMdy></reqst>`;
    const productsUrl = new URL(config.productsUrl);
    const response = await postShoplingXml(`${productsUrl.origin}/prod/prod_modify_api.phtml?mode=2`, xml, {
      headers: { accept: "application/xml, text/xml", "content-type": "application/xml; charset=utf-8", "user-agent": "commerce-os-shopling-keyword-substring-hotfix/20260913" },
      timeoutMs: 45_000,
    });
    await response.text();
    if (!response.ok) return NextResponse.json({ status: "write_http_failed", writeStatus: response.status }, { status: 502 });

    const afterContexts = await loadKeywordEngineElonLabShoplingContexts([...GOODS_KEYS]);
    const afterMap = new Map(afterContexts.map((row) => [row.goodsKey, row.currentSiteSearch]));
    const verifiedRows = rows.map((row) => {
      const afterActual = afterMap.get(row.goodsKey) ?? "";
      const remaining = splitKeywords(afterActual).filter(containsProhibited);
      return { ...row, afterActual, prohibitedRemaining: remaining, verified: splitKeywords(afterActual).join(",") === row.afterPlanned && remaining.length === 0 };
    });
    const failedGoodsKeys = verifiedRows.filter((row) => !row.verified).map((row) => row.goodsKey);
    return NextResponse.json({
      status: failedGoodsKeys.length ? "verification_failed" : "success",
      writeStatus: response.status,
      transportMode: response.transportMode,
      editedGoodsKeys: verifiedRows.filter((row) => row.verified).map((row) => row.goodsKey),
      failedGoodsKeys,
      rows: verifiedRows,
    }, { status: failedGoodsKeys.length ? 409 : 200 });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
