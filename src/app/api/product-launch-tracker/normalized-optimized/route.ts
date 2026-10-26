import { after, NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { loadFreshProductLaunchNormalized } from "@/lib/productLaunchTrackerNormalizedAvailability";
import {
  readProductLaunchNormalizedItem,
  readProductLaunchNormalizedItems,
  readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";
import { queryProductLaunchStockAwareNormalizedPage } from "@/lib/productLaunchStockAwarePage";
import {
  disableProductLaunchNormalizedRead,
  syncProductLaunchNormalizedAfterMutation,
} from "@/lib/productLaunchTrackerNormalizedWriteBridge";
import { GET as legacyGet, PATCH as legacyPatch } from "../optimized/route";

const PAGE_CACHE_TTL_MS = 10_000;
const PAGE_CACHE_STALE_MS = 60_000;
const PAGE_CACHE_MAX_KEYS = 80;

type CachedPage = {
  body: Record<string, unknown>;
  expiresAt: number;
  staleUntil: number;
  refreshing?: boolean;
};

const pageCache = new Map<string, CachedPage>();

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (!new Set(["page", "item", "items"]).has(mode)) return legacyGet(request);

  if (mode === "page") {
    return getNormalizedPage(request);
  }

  const loaded = await loadFreshProductLaunchNormalized(request);
  if (loaded.response) return loaded.response;
  if (!loaded.value) return legacyGet(request);

  const { config, identity, workspace, updatedAt, schemaVersion } = loaded.value;

  try {
    if (mode === "item") {
      const itemId = request.nextUrl.searchParams.get("id")?.trim() || "";
      if (!itemId) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_ID_REQUIRED",
            message: "불러올 상품 ID가 필요합니다.",
          },
          { status: 400 },
        );
      }

      const item = await readProductLaunchNormalizedItem(
        config,
        identity.userId,
        itemId,
      );
      if (!item) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
            message: "상품 기록을 찾지 못했습니다.",
          },
          { status: 404 },
        );
      }

      return Response.json({
        ok: true,
        stateExists: true,
        item,
        policy: isRecord(workspace.policy) ? workspace.policy : null,
        updatedAt,
        schemaVersion,
        itemSource: "normalized",
      });
    }

    const requestedIds = readRequestedIds(request);
    if (!requestedIds.length) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEM_IDS_REQUIRED",
          message: "불러올 상품 ID가 필요합니다.",
        },
        { status: 400 },
      );
    }
    if (requestedIds.length > 100) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEM_LIMIT_EXCEEDED",
          message: "한 번에 최대 100개 상품까지 불러올 수 있습니다.",
        },
        { status: 400 },
      );
    }

    const items = await readProductLaunchNormalizedItems(
      config,
      identity.userId,
      requestedIds,
    );
    const foundIds = new Set(
      items.map((item) => text(asRecord(item).id)).filter(Boolean),
    );
    const missingIds = requestedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEMS_NOT_FOUND",
          message: "일부 상품 기록을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
          missingIds,
        },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      stateExists: true,
      items,
      updatedAt,
      schemaVersion,
      itemSource: "normalized",
    });
  } catch (error) {
    console.error("[product-launch-normalized-read] detailed read fallback", error);
    return legacyGet(request);
  }
}

async function getNormalizedPage(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const ownerId = identity.value.userId;
  const query = pageQuery(request);
  const cacheKey = `${ownerId}:${request.nextUrl.searchParams.toString()}`;
  const now = Date.now();
  const cached = pageCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return pageResponse(cached.body, "memory-fresh");
  }

  if (cached && cached.staleUntil > now) {
    schedulePageRefresh(
      cacheKey,
      cached,
      config.value,
      ownerId,
      query,
    );
    return pageResponse(cached.body, "stale-while-revalidate");
  }

  try {
    const body = await loadNormalizedPageBody(
      config.value,
      ownerId,
      query,
    );
    if (!body) return legacyGet(request);
    setPageCache(cacheKey, body);
    return pageResponse(body, "fresh");
  } catch (error) {
    console.error("[product-launch-normalized-page] read failed", error);
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_LIST_TEMPORARILY_UNAVAILABLE",
        message:
          "상품 목록 저장소 응답이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
      },
      {
        status: 503,
        headers: {
          "Retry-After": "2",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

async function loadNormalizedPageBody(
  config: Parameters<typeof queryProductLaunchStockAwareNormalizedPage>[0],
  ownerId: string,
  query: ReturnType<typeof pageQuery>,
) {
  const workspace = await readProductLaunchNormalizedWorkspace(config, ownerId);
  if (!workspace || workspace.normalized_read_enabled !== true) return null;

  const page = await queryProductLaunchStockAwareNormalizedPage(
    config,
    ownerId,
    workspace,
    query,
  );

  return {
    ok: true,
    stateExists: true,
    ...page,
    policy: isRecord(workspace.policy) ? workspace.policy : null,
    sourceImportedAt: nullableText(workspace.source_imported_at),
    updatedAt:
      nullableText(workspace.source_state_updated_at) ??
      nullableText(workspace.updated_at),
    schemaVersion: numberOrNull(workspace.schema_version),
    listSource: "normalized",
  } satisfies Record<string, unknown>;
}

function schedulePageRefresh(
  cacheKey: string,
  cached: CachedPage,
  config: Parameters<typeof queryProductLaunchStockAwareNormalizedPage>[0],
  ownerId: string,
  query: ReturnType<typeof pageQuery>,
) {
  if (cached.refreshing) return;
  pageCache.set(cacheKey, { ...cached, refreshing: true });

  after(async () => {
    try {
      const body = await loadNormalizedPageBody(config, ownerId, query);
      if (!body) {
        pageCache.delete(cacheKey);
        return;
      }
      setPageCache(cacheKey, body);
    } catch (error) {
      console.error("[product-launch-normalized-page] background refresh failed", error);
      const latest = pageCache.get(cacheKey);
      if (latest) pageCache.set(cacheKey, { ...latest, refreshing: false });
    }
  });
}

function setPageCache(cacheKey: string, body: Record<string, unknown>) {
  if (pageCache.size >= PAGE_CACHE_MAX_KEYS && !pageCache.has(cacheKey)) {
    const oldest = pageCache.keys().next().value;
    if (oldest) pageCache.delete(oldest);
  }
  const now = Date.now();
  pageCache.set(cacheKey, {
    body,
    expiresAt: now + PAGE_CACHE_TTL_MS,
    staleUntil: now + PAGE_CACHE_STALE_MS,
    refreshing: false,
  });
}

function pageResponse(body: Record<string, unknown>, cacheStatus: string) {
  return Response.json(
    { ...body, listCache: cacheStatus },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Commerce-List-Cache": cacheStatus,
      },
    },
  );
}

function pageQuery(request: NextRequest) {
  return {
    page: request.nextUrl.searchParams.get("page"),
    pageSize: request.nextUrl.searchParams.get("pageSize"),
    search: request.nextUrl.searchParams.get("search"),
    batch: request.nextUrl.searchParams.get("batch"),
    assignee: request.nextUrl.searchParams.get("assignee"),
    overall: request.nextUrl.searchParams.get("overall"),
    unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
    stock: request.nextUrl.searchParams.get("stock"),
    sort: request.nextUrl.searchParams.get("sort"),
    direction: request.nextUrl.searchParams.get("direction"),
  };
}

export async function PATCH(request: NextRequest) {
  const inputPromise = request.clone().json().catch(() => null as unknown);
  const response = await legacyPatch(request);
  if (!response.ok) return response;

  pageCache.clear();
  const input = await inputPromise;
  const payload = await response.clone().json().catch(() => null as unknown);
  try {
    await syncProductLaunchNormalizedAfterMutation(request, input, payload);
  } catch (error) {
    console.error("[product-launch-normalized-write] legacy write kept", error);
    await disableProductLaunchNormalizedRead(request);
  }
  return response;
}

function readRequestedIds(request: NextRequest) {
  return [
    ...new Set(
      request.nextUrl.searchParams
        .getAll("id")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
