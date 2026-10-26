import { NextRequest } from "next/server";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  getProductLaunchAdminConfig,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { readProductLaunchNormalizedWorkspace } from "@/lib/productLaunchTrackerNormalizedStore";
import { queryProductLaunchStockAwareNormalizedPage } from "@/lib/productLaunchStockAwarePage";
import { GET as legacyGet, PATCH as legacyPatch } from "../normalized-optimized/route";

const CACHE_TAG_PREFIX = "product-launch-page";
const PAGE_REVALIDATE_SECONDS = 10;

type PageQuery = {
  page: string | null;
  pageSize: string | null;
  search: string | null;
  batch: string | null;
  assignee: string | null;
  overall: string | null;
  unfinishedOnly: string | null;
  stock: string | null;
  sort: string | null;
  direction: string | null;
};

type CachedPageResult =
  | { kind: "page"; body: Record<string, unknown> }
  | { kind: "legacy" }
  | { kind: "unavailable"; message: string };

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (mode !== "page") return legacyGet(request);

  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const result = await readCachedPage(
    identity.value.userId,
    JSON.stringify(readPageQuery(request)),
  );
  if (result.kind === "legacy") return legacyGet(request);
  if (result.kind === "unavailable") {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_LIST_TEMPORARILY_UNAVAILABLE",
        message:
          "상품 목록 저장소가 일시적으로 혼잡합니다. 잠시 후 자동으로 다시 불러옵니다.",
      },
      {
        status: 503,
        headers: {
          "Retry-After": String(PAGE_REVALIDATE_SECONDS),
          "Cache-Control": "private, no-store",
          "X-Commerce-List-Cache": "cached-backpressure",
        },
      },
    );
  }

  return Response.json(
    { ...result.body, listCache: "next-data-cache" },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Commerce-List-Cache": "data-cache",
      },
    },
  );
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  const response = await legacyPatch(request);
  if (response.ok && identity.ok) {
    revalidateTag(cacheTagFor(identity.value.userId), "max");
  }
  return response;
}

function readCachedPage(ownerId: string, queryJson: string) {
  return unstable_cache(
    async (): Promise<CachedPageResult> => {
      try {
        const config = getProductLaunchAdminConfig();
        if (!config.ok) {
          return {
            kind: "unavailable",
            message: "상품출시진행관리 저장소 설정을 읽지 못했습니다.",
          };
        }

        const workspace = await readProductLaunchNormalizedWorkspace(
          config.value,
          ownerId,
        );
        if (!workspace || workspace.normalized_read_enabled !== true) {
          return { kind: "legacy" };
        }

        const query = JSON.parse(queryJson) as PageQuery;
        const page = await queryProductLaunchStockAwareNormalizedPage(
          config.value,
          ownerId,
          workspace,
          query,
        );

        return {
          kind: "page",
          body: {
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
          },
        };
      } catch (error) {
        console.error("[product-launch-page-cache] store read failed", error);
        return {
          kind: "unavailable",
          message:
            error instanceof Error
              ? error.message
              : "상품 목록 저장소를 읽지 못했습니다.",
        };
      }
    },
    ["product-launch-page-v3-backpressure", ownerId, queryJson],
    {
      revalidate: PAGE_REVALIDATE_SECONDS,
      tags: [cacheTagFor(ownerId)],
    },
  )();
}

function readPageQuery(request: NextRequest): PageQuery {
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

function cacheTagFor(ownerId: string) {
  return `${CACHE_TAG_PREFIX}:${ownerId}`;
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
