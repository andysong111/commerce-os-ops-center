import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONFIRMATION = "REINCREASE_676_10PCT";
const TOKEN_SHA256 = "9eafa2948e3f6bc76149bc8023ec17fd3b389c689e61468e62c571fc0a93297e";
const PLAN_SHA256 = "ab2ee2a5f26b09da1f530e36a2e143ae5814deb46a25a326aea9e4e7ec7355d0";
const EXPECTED_COUNT = 676;
const MALL_KEY = "SMALL_00069";
const MALL_NAME = "도매꾹";
const BATCH_SIZE = 20;
const OPERATION_TYPE = "ONEOFF_DOMEMAE_676_REINCREASE10_20260923";
const SOURCE_EVENT_ID = "oneoff:domemae:676:reincrease10:20260923:v1";
const SHOPLING_URL =
  "https://api.shopling.co.kr/prod/prod_each_mall_modify_api.phtml?mode=2";

const PLAN_GZIP_B64 =
  "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";

type PlanRow = {
  goods_key: string;
  mall_goods_cd: string;
  before: number;
  target: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function authorized(token: string) {
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodePlan(): PlanRow[] {
  const raw = gunzipSync(Buffer.from(PLAN_GZIP_B64, "base64")).toString("utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== PLAN_SHA256) throw new Error("PLAN_HASH_MISMATCH");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== EXPECTED_COUNT) {
    throw new Error("PLAN_COUNT_MISMATCH");
  }
  const rows = parsed.map((value) => {
    const row = value as Record<string, unknown>;
    const goodsKey = text(row.goods_key);
    const mallGoodsCd = text(row.mall_goods_cd);
    const before = Number(row.before);
    const target = Number(row.target);
    if (
      !/^\d{5,9}$/.test(goodsKey) ||
      !/^SE\d+$/.test(mallGoodsCd) ||
      !Number.isSafeInteger(before) ||
      before <= 0 ||
      !Number.isSafeInteger(target) ||
      target <= before ||
      target !== Math.floor((before * 110 + 50) / 100)
    ) {
      throw new Error(`PLAN_ROW_INVALID:${goodsKey || mallGoodsCd}`);
    }
    return { goods_key: goodsKey, mall_goods_cd: mallGoodsCd, before, target };
  });
  if (new Set(rows.map((row) => row.goods_key)).size !== EXPECTED_COUNT) {
    throw new Error("PLAN_DUPLICATE_GOODS_KEY");
  }
  if (new Set(rows.map((row) => row.mall_goods_cd)).size !== EXPECTED_COUNT) {
    throw new Error("PLAN_DUPLICATE_MALL_GOODS_CD");
  }
  return rows;
}

function cdata(value: unknown) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function buildXml(
  rows: PlanRow[],
  config: { loginId: string; companyId: string; authKey: string },
) {
  const blocks = rows
    .map(
      (row) =>
        `<goodsInfo><mall_key>${MALL_KEY}</mall_key><goods_key>${row.goods_key}</goods_key><sale_price>${cdata(row.target)}</sale_price></goodsInfo>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdEachMdy>` +
    `<login_id>${cdata(config.loginId)}</login_id>` +
    `<company_id>${config.companyId}</company_id>` +
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
    blocks +
    `</apiProdEachMdy></reqst>`
  );
}

function cleanTagValue(value: string) {
  const trimmed = value.trim();
  const cdataMatch = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdataMatch?.[1] ?? trimmed)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

function tagValue(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? cleanTagValue(match[1]) : "";
}

function parseResponse(body: string, requested: PlanRow[]) {
  const blocks = [...body.matchAll(/<goodsRst(?:\s[^>]*)?>([\s\S]*?)<\/goodsRst>/gi)].map(
    (match) => match[1],
  );
  const byGoodsKey = new Map<string, { code: string; message: string }>();
  for (const block of blocks) {
    const goodsKey = tagValue(block, "goods_key");
    if (!goodsKey) continue;
    byGoodsKey.set(goodsKey, {
      code: tagValue(block, "code"),
      message: tagValue(block, "msg"),
    });
  }

  return requested.map((row, index) => {
    const block = blocks[index] ?? "";
    const matched = byGoodsKey.get(row.goods_key);
    const code = matched?.code || tagValue(block, "code");
    const message = matched?.message || tagValue(block, "msg");
    return {
      goodsKey: row.goods_key,
      mallGoodsCd: row.mall_goods_cd,
      before: row.before,
      target: row.target,
      code,
      message: message.slice(0, 240),
      success: code === "000",
    };
  });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function safeResult(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(request: Request) {
  if (!["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) {
    return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const url = new URL(request.url);
  if (
    url.searchParams.get("confirm") !== CONFIRMATION ||
    !authorized(url.searchParams.get("token") ?? "")
  ) {
    return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const config = {
    loginId: text(process.env.SHOPLING_LOGIN_ID),
    companyId: text(process.env.SHOPLING_COMPANY_ID),
    authKey: text(process.env.SHOPLING_API_AUTH_KEY),
  };
  if (!config.loginId || !config.companyId || !config.authKey) {
    return Response.json(
      { ok: false, error: "SHOPLING_CREDENTIALS_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  let plan: PlanRow[];
  try {
    plan = decodePlan();
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "PLAN_INVALID",
      },
      { status: 500 },
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return Response.json(
      { ok: false, error: "SUPABASE_ADMIN_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const existing = await admin
    .from("commerce_operation_runs")
    .select("status,result_snapshot,error_message,started_at,finished_at")
    .eq("source_event_id", SOURCE_EVENT_ID)
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return Response.json(
      { ok: false, error: "IDEMPOTENCY_READ_FAILED", message: existing.error.message },
      { status: 503 },
    );
  }
  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    const status = text(row.status);
    if (status === "SUCCEEDED") {
      return Response.json({
        ok: true,
        duplicate: true,
        result: safeResult(row.result_snapshot),
      });
    }
    return Response.json(
      {
        ok: false,
        duplicate: true,
        error: "PREVIOUS_ATTEMPT_REQUIRES_REVIEW",
        status,
        result: safeResult(row.result_snapshot),
        message: text(row.error_message),
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const reserved = await admin.from("commerce_operation_runs").insert({
    operation_type: OPERATION_TYPE,
    status: "RUNNING",
    source: "ops-center-preview-oneoff",
    source_event_id: SOURCE_EVENT_ID,
    correlation_id: SOURCE_EVENT_ID,
    actor_type: "USER",
    actor_id: "ops-center",
    input_snapshot: {
      mallKey: MALL_KEY,
      mallName: MALL_NAME,
      requestedCount: EXPECTED_COUNT,
      batchSize: BATCH_SIZE,
      planSha256: PLAN_SHA256,
      policy: "CURRENT_DOMEMAE_VISIBLE_PRICE_PLUS_10_PERCENT",
      writes: ["mall_key", "goods_key", "sale_price"],
    },
    result_snapshot: {},
    error_message: null,
    started_at: now,
    finished_at: null,
    updated_at: now,
  });
  if (reserved.error) {
    return Response.json(
      {
        ok: false,
        error: "IDEMPOTENCY_RESERVATION_FAILED",
        message: reserved.error.message,
      },
      { status: reserved.error.code === "23505" ? 409 : 503 },
    );
  }

  const results: Array<{
    goodsKey: string;
    mallGoodsCd: string;
    before: number;
    target: number;
    code: string;
    message: string;
    success: boolean;
  }> = [];
  let ambiguousFailure = "";
  let ambiguousBatchStart = -1;

  for (let offset = 0; offset < plan.length; offset += BATCH_SIZE) {
    const batch = plan.slice(offset, offset + BATCH_SIZE);
    try {
      const response = await postShoplingXml(SHOPLING_URL, buildXml(batch, config), {
        headers: {
          accept: "application/xml, text/xml",
          "content-type": "application/xml; charset=utf-8",
          "user-agent": "commerce-os-oneoff-domemae-reincrease10/1.0",
        },
        timeoutMs: 60_000,
      });
      const body = await response.text();
      if (!response.ok) {
        ambiguousFailure = `SHOPLING_HTTP_${response.status}`;
        ambiguousBatchStart = offset;
        break;
      }
      results.push(...parseResponse(body, batch));
    } catch (error) {
      ambiguousFailure =
        error instanceof Error ? error.message : "SHOPLING_TRANSPORT_FAILED";
      ambiguousBatchStart = offset;
      break;
    }
    if (offset + BATCH_SIZE < plan.length) await wait(350);
  }

  const apiSuccessCount = results.filter((row) => row.success).length;
  const apiFailureRows = results.filter((row) => !row.success);
  const processedCount = results.length;
  const complete =
    !ambiguousFailure &&
    processedCount === EXPECTED_COUNT &&
    apiSuccessCount === EXPECTED_COUNT;
  const finishedAt = new Date().toISOString();
  const resultSnapshot = {
    mallKey: MALL_KEY,
    mallName: MALL_NAME,
    requestedCount: EXPECTED_COUNT,
    processedCount,
    apiSuccessCount,
    apiFailureCount: apiFailureRows.length,
    ambiguousFailure: ambiguousFailure || null,
    ambiguousBatchStart: ambiguousBatchStart >= 0 ? ambiguousBatchStart : null,
    batchSize: BATCH_SIZE,
    planSha256: PLAN_SHA256,
    writeFields: ["mall_key", "goods_key", "sale_price"],
    sampleChanges: plan.slice(0, 20).map((row) => ({
      goodsKey: row.goods_key,
      mallGoodsCd: row.mall_goods_cd,
      before: row.before,
      target: row.target,
    })),
    failures: apiFailureRows.slice(0, 100),
  };

  const stored = await admin
    .from("commerce_operation_runs")
    .update({
      status: complete ? "SUCCEEDED" : "FAILED",
      result_snapshot: resultSnapshot,
      error_message: complete
        ? null
        : ambiguousFailure ||
          `Shopling explicit failures: ${apiFailureRows.length}`,
      finished_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq("source_event_id", SOURCE_EVENT_ID)
    .eq("status", "RUNNING");

  return Response.json(
    {
      ok: complete,
      result: resultSnapshot,
      evidenceStored: !stored.error,
      evidenceStoreError: stored.error?.message ?? null,
      note:
        "Shopling API acceptance is not proof of Domeggook propagation; verify with a fresh Domeggook export.",
    },
    {
      status: complete ? 200 : 502,
      headers: { "cache-control": "no-store" },
    },
  );
}
