import { NextRequest } from "next/server";

import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readResponseJson,
  resolveProductLaunchIdentity,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;
type HealthStatus = "ok" | "link_error" | "temporary_error";

type HealthRow = {
  owner_id: string;
  item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  product_name: string;
  primary_url: string;
  fallback_url: string;
  link_count: number;
  has_fallback: boolean;
  health_status: "ok" | "link_error" | "temporary_error" | "unchecked" | "missing";
  error_code: string;
  error_message: string;
  final_url: string;
  collector_version: string;
  checked_at: string | null;
  item_updated_at: string | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, max = 4000) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeItemIds(value: unknown, limit = 500) {
  const source = Array.isArray(value) ? value : [value];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of source) {
    const itemId = text(entry, 180).replace(/[,()]/g, "");
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    output.push(itemId);
    if (output.length >= limit) break;
  }
  return output;
}

function isHealthStatus(value: string): value is HealthStatus {
  return value === "ok" || value === "link_error" || value === "temporary_error";
}

async function storageRequest<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return body as T;
}

async function readHealthRows(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  itemIds: string[] = [],
) {
  const params = new URLSearchParams({
    select:
      "owner_id,item_id,tracker_row_number,model_number,product_name,primary_url,fallback_url,link_count,has_fallback,health_status,error_code,error_message,final_url,collector_version,checked_at,item_updated_at",
    owner_id: `eq.${ownerId}`,
    order: "tracker_row_number.asc.nullslast,model_number.asc",
    limit: "1000",
  });
  if (itemIds.length) params.set("item_id", `in.(${itemIds.join(",")})`);
  // The legacy view falls through to the detail-page URL when the purchase
  // alias is blank. Ignore that fallback for items with explicit link roles.
  const usageParams = new URLSearchParams({
    select: "item_id,purchase_primary:item_payload->>primaryChinaProductLink",
    owner_id: `eq.${ownerId}`,
    archived_at: "is.null",
    "item_payload->chinaLinkUsage": "not.is.null",
    order: "tracker_row_number.asc.nullslast,model_number.asc",
    limit: "1000",
  });
  if (itemIds.length) usageParams.set("item_id", `in.(${itemIds.join(",")})`);
  const [rows, roleRows] = await Promise.all([
    storageRequest<HealthRow[]>(config, `product_launch_primary_link_health?${params}`),
    storageRequest<Array<{ item_id: string; purchase_primary: string | null }>>(
      config, `product_launch_items?${usageParams}`,
    ),
  ]);
  const missingPurchaseIds = new Set(
    roleRows.filter((row) => !row.purchase_primary).map((row) => row.item_id),
  );
  return (Array.isArray(rows) ? rows : []).map((row): HealthRow =>
    missingPurchaseIds.has(row.item_id)
      ? {
        ...row,
        primary_url: "",
        fallback_url: "",
        link_count: 0,
        has_fallback: false,
        health_status: "missing",
        error_code: "",
        error_message: "",
        final_url: "",
        collector_version: "",
        checked_at: null,
      }
      : row,
  );
}

function healthSummary(rows: HealthRow[]) {
  const lastCheckedAt = rows
    .map((row) => row.checked_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    totalProducts: rows.length,
    withPrimaryLink: rows.filter((row) => Boolean(row.primary_url)).length,
    missingPrimaryLink: rows.filter((row) => row.health_status === "missing").length,
    healthy: rows.filter((row) => row.health_status === "ok").length,
    linkErrors: rows.filter((row) => row.health_status === "link_error").length,
    temporaryErrors: rows.filter((row) => row.health_status === "temporary_error").length,
    unchecked: rows.filter((row) => row.health_status === "unchecked").length,
    linkErrorsWithFallback: rows.filter(
      (row) => row.health_status === "link_error" && row.has_fallback,
    ).length,
    lastCheckedAt,
  };
}

function dueForAudit(row: HealthRow, staleBefore: number) {
  if (!row.primary_url || row.health_status === "missing") return false;
  if (row.health_status === "unchecked" || row.health_status === "temporary_error") {
    return true;
  }
  const checked = Date.parse(row.checked_at || "");
  return !Number.isFinite(checked) || checked < staleBefore;
}

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const rows = await readHealthRows(config.value, identity.value.userId);
    const summary = healthSummary(rows);
    const mode = text(request.nextUrl.searchParams.get("mode"), 40) || "summary";
    if (mode === "summary") {
      return Response.json(
        { ok: true, summary },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const scope = text(request.nextUrl.searchParams.get("scope"), 40) || "due";
    const limit = Math.max(
      1,
      Math.min(500, integer(request.nextUrl.searchParams.get("limit"), 500)),
    );
    const staleDays = Math.max(
      1,
      Math.min(365, integer(request.nextUrl.searchParams.get("staleDays"), 30)),
    );
    const staleBefore = Date.now() - staleDays * 86_400_000;
    const filtered = rows.filter((row) => {
      if (scope === "errors") return row.health_status === "link_error";
      if (scope === "unchecked") return row.health_status === "unchecked";
      if (scope === "temporary") return row.health_status === "temporary_error";
      if (scope === "all") return Boolean(row.primary_url);
      return dueForAudit(row, staleBefore);
    });

    return Response.json(
      {
        ok: true,
        summary,
        scope,
        rows: filtered.slice(0, limit),
        count: filtered.length,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_CHINA_LINK_HEALTH_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "중국 발주용 링크 상태를 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const input = record(await request.json().catch(() => ({})));
  const action = text(input.action, 40);

  try {
    if (action === "clear_items") {
      const itemIds = safeItemIds(input.itemIds);
      if (!itemIds.length) {
        return Response.json(
          { ok: false, code: "CHINA_LINK_ITEM_IDS_REQUIRED", message: "초기화할 상품을 선택하세요." },
          { status: 400 },
        );
      }
      const params = new URLSearchParams({
        owner_id: `eq.${identity.value.userId}`,
        item_id: `in.(${itemIds.join(",")})`,
      });
      await storageRequest<unknown>(
        config.value,
        `product_launch_china_link_audits?${params.toString()}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
      return Response.json({ ok: true, clearedCount: itemIds.length });
    }

    if (action !== "record_batch") {
      return Response.json(
        {
          ok: false,
          code: "CHINA_LINK_HEALTH_ACTION_INVALID",
          message: "지원하지 않는 발주용 링크 상태 작업입니다.",
        },
        { status: 400 },
      );
    }

    const incoming = Array.isArray(input.results)
      ? input.results.slice(0, 50).map(record)
      : [];
    const itemIds = safeItemIds(incoming.map((row) => row.itemId), 50);
    if (!itemIds.length) {
      return Response.json(
        { ok: false, code: "CHINA_LINK_AUDIT_RESULTS_REQUIRED", message: "저장할 링크 검사 결과가 없습니다." },
        { status: 400 },
      );
    }
    const currentRows = await readHealthRows(
      config.value,
      identity.value.userId,
      itemIds,
    );
    const currentById = new Map(currentRows.map((row) => [row.item_id, row]));
    const now = new Date().toISOString();
    const upserts: Array<Record<string, unknown>> = [];
    let staleCount = 0;

    for (const raw of incoming) {
      const itemId = text(raw.itemId, 180);
      const url = text(raw.url, 4000);
      const status = text(raw.status, 40);
      const current = currentById.get(itemId);
      if (!current || !url || current.primary_url !== url) {
        staleCount += 1;
        continue;
      }
      if (!isHealthStatus(status)) continue;
      upserts.push({
        owner_id: identity.value.userId,
        item_id: itemId,
        tracker_row_number: current.tracker_row_number,
        model_number: current.model_number,
        product_name: current.product_name,
        link_slot: 1,
        url,
        status,
        error_code: text(raw.errorCode, 120),
        error_message: text(raw.errorMessage, 500),
        final_url: text(raw.finalUrl, 4000),
        collector_version: text(raw.collectorVersion, 40),
        checked_at: text(raw.checkedAt, 80) || now,
        metadata: {
          detectedText: text(raw.detectedText, 500),
          source: text(raw.source, 80) || "browser_collector",
        },
        updated_at: now,
      });
    }

    if (upserts.length) {
      const params = new URLSearchParams({
        on_conflict: "owner_id,item_id,link_slot",
      });
      await storageRequest<unknown>(
        config.value,
        `product_launch_china_link_audits?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(upserts),
        },
      );
    }

    return Response.json({
      ok: true,
      savedCount: upserts.length,
      staleCount,
      receivedCount: incoming.length,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_CHINA_LINK_HEALTH_WRITE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "중국 발주용 링크 상태를 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
