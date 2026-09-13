import { NextResponse } from "next/server";
import { loadKeywordEngineElonLabShoplingContexts } from "@/lib/keywordEngineElonLabShopling";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRM = "APPLY_EXACT_KEYWORD_HOTFIX_20260913_V1";

const TARGETS = {
  "122691": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122690": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122689": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122688": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122687": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122685": { model: "AAA355", replacements: { "한샘": ["시스템행거", "드레스룸행거"], "한샘시스템행거": ["행거옷걸이", "철제행거"] } },
  "122553": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
  "122552": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
  "122551": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
  "122550": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
  "122548": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
  "122546": { model: "AAA139", replacements: { "동행복권": ["복권스크래퍼키링", "복권긁개"], "스피또": ["스크래퍼키링", "복권스크래퍼"], "로또": ["즉석복권긁개", "복권긁기칼"], "동행복권로또": ["복권스크래치도구", "스크래치긁개"] } },
} as const;

const BANNED = new Set(["한샘", "한샘시스템행거", "동행복권", "스피또", "로또", "동행복권로또"]);

type TargetKey = keyof typeof TARGETS;

type PlannedRow = {
  goodsKey: TargetKey;
  model: string;
  before: string;
  afterPlanned: string;
  removed: string[];
  added: string[];
  changed: boolean;
};

function norm(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function splitKeywords(value: unknown) {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const part of String(value ?? "").split(/[,;\n|/]+/)) {
    const keyword = norm(part);
    if (!keyword) continue;
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(keyword);
  }
  return rows;
}

function exactBanned(value: unknown) {
  return BANNED.has(norm(value));
}

function replaceExactKeywords(goodsKey: TargetKey, before: string) {
  const source = splitKeywords(before);
  const config = TARGETS[goodsKey];
  const replacements = config.replacements as Record<string, readonly string[]>;
  const safeExisting = new Set(
    source.filter((keyword) => !exactBanned(keyword)).map((keyword) => norm(keyword).toLocaleLowerCase()),
  );
  const output: string[] = [];
  const outputKeys = new Set<string>();
  const removed: string[] = [];
  const added: string[] = [];

  for (const keyword of source) {
    if (!exactBanned(keyword)) {
      const key = norm(keyword).toLocaleLowerCase();
      if (!outputKeys.has(key)) {
        output.push(keyword);
        outputKeys.add(key);
      }
      continue;
    }

    removed.push(keyword);
    const candidates = replacements[norm(keyword)] ?? [];
    const replacement = candidates.find((candidate) => {
      const key = norm(candidate).toLocaleLowerCase();
      return key && !safeExisting.has(key) && !outputKeys.has(key) && !exactBanned(candidate);
    }) ?? candidates.find((candidate) => !exactBanned(candidate));
    if (!replacement) throw new Error(`REPLACEMENT_NOT_FOUND:${goodsKey}:${keyword}`);
    const replacementKey = norm(replacement).toLocaleLowerCase();
    if (!outputKeys.has(replacementKey)) {
      output.push(replacement);
      outputKeys.add(replacementKey);
      safeExisting.add(replacementKey);
      added.push(replacement);
    }
  }

  if (output.length > 10) throw new Error(`KEYWORD_COUNT_OVER_10:${goodsKey}`);
  if (output.some(exactBanned)) throw new Error(`BANNED_REMAINS_IN_PLAN:${goodsKey}`);
  return { after: output.join(","), removed, added };
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
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

function buildModifyXml(rows: PlannedRow[]) {
  const config = shoplingReadConfigFromEnv(env());
  const goodsInfo = rows
    .filter((row) => row.changed)
    .map((row) => `<goodsInfo><goods_key>${escapeXml(row.goodsKey)}</goods_key><site_srch>${cdata(row.afterPlanned)}</site_srch></goodsInfo>`)
    .join("");
  return {
    config,
    xml: `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdMdy><login_id>${cdata(config.loginId)}</login_id><company_id>${escapeXml(config.companyId)}</company_id><api_auth_key>${escapeXml(config.authKey)}</api_auth_key>${goodsInfo}</apiProdMdy></reqst>`,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return NextResponse.json({ status: "blocked", message: "confirmation required" }, { status: 403 });
  }

  try {
    const goodsKeys = Object.keys(TARGETS) as TargetKey[];
    const beforeContexts = await loadKeywordEngineElonLabShoplingContexts(goodsKeys);
    const beforeMap = new Map(beforeContexts.map((row) => [row.goodsKey, row]));
    const plan: PlannedRow[] = goodsKeys.map((goodsKey) => {
      const context = beforeMap.get(goodsKey);
      if (!context?.found) throw new Error(`SHOPLING_GOODS_KEY_NOT_FOUND:${goodsKey}`);
      const before = context.currentSiteSearch;
      const replacement = replaceExactKeywords(goodsKey, before);
      return {
        goodsKey,
        model: TARGETS[goodsKey].model,
        before,
        afterPlanned: replacement.after,
        removed: replacement.removed,
        added: replacement.added,
        changed: replacement.after !== splitKeywords(before).join(","),
      };
    });

    const changedRows = plan.filter((row) => row.changed);
    let writeStatus = 0;
    let transportMode = "not_needed";
    if (changedRows.length) {
      const { config, xml } = buildModifyXml(plan);
      const productsUrl = new URL(config.productsUrl);
      const modifyUrl = `${productsUrl.origin}/prod/prod_modify_api.phtml?mode=2`;
      const response = await postShoplingXml(modifyUrl, xml, {
        headers: {
          accept: "application/xml, text/xml",
          "content-type": "application/xml; charset=utf-8",
          "user-agent": "commerce-os-shopling-keyword-hotfix/20260913",
        },
        timeoutMs: 45_000,
      });
      writeStatus = response.status;
      transportMode = response.transportMode;
      await response.text();
      if (!response.ok) {
        return NextResponse.json({ status: "write_http_failed", writeStatus, transportMode }, { status: 502 });
      }
    }

    const afterContexts = await loadKeywordEngineElonLabShoplingContexts(goodsKeys);
    const afterMap = new Map(afterContexts.map((row) => [row.goodsKey, row]));
    const rows = plan.map((row) => {
      const actual = afterMap.get(row.goodsKey)?.currentSiteSearch ?? "";
      const actualNormalized = splitKeywords(actual).join(",");
      const bannedRemaining = splitKeywords(actual).filter(exactBanned);
      const verified = actualNormalized === row.afterPlanned && bannedRemaining.length === 0;
      return { ...row, afterActual: actual, bannedRemaining, verified };
    });
    const failedGoodsKeys = rows.filter((row) => !row.verified).map((row) => row.goodsKey);
    const editedGoodsKeys = rows.filter((row) => row.changed && row.verified).map((row) => row.goodsKey);

    return NextResponse.json({
      status: failedGoodsKeys.length ? "verification_failed" : "success",
      targetCount: rows.length,
      writeCount: changedRows.length,
      verifiedCount: rows.filter((row) => row.verified).length,
      editedGoodsKeys,
      unchangedGoodsKeys: rows.filter((row) => !row.changed && row.verified).map((row) => row.goodsKey),
      failedGoodsKeys,
      writeStatus,
      transportMode,
      rows,
    }, { status: failedGoodsKeys.length ? 409 : 200 });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    }, { status: 500 });
  }
}
