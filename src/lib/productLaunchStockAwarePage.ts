import {
  buildProductLaunchStockStatusIndex,
  classifyProductLaunchStockAvailability,
  loadProductLaunchShoplingStockSnapshot,
  productLaunchStockMatchesFilter,
} from "./productLaunchStockAvailability.ts";
import {
  queryProductLaunchNormalizedPage,
  queryProductLaunchNormalizedStockCandidates,
  readProductLaunchNormalizedSummaries,
  type ProductLaunchNormalizedWorkspace,
} from "./productLaunchTrackerNormalizedStore.ts";
import {
  PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE,
  PRODUCT_LAUNCH_MAX_PAGE_SIZE,
  type ProductLaunchTrackerPageQuery,
} from "./productLaunchTrackerOptimized.ts";

type Config = { supabaseUrl: string; secretKey: string };
type UnknownRecord = Record<string, unknown>;

export async function queryProductLaunchStockAwareNormalizedPage(
  config: Config,
  ownerId: string,
  workspace: ProductLaunchNormalizedWorkspace,
  query: ProductLaunchTrackerPageQuery,
) {
  const seoReadyOnly = booleanValue(query.seoReadyOnly, false);
  let stockIndex;
  try {
    stockIndex = buildProductLaunchStockStatusIndex(
      await loadProductLaunchShoplingStockSnapshot({ maxAgeMs: 3_000 }),
    );
  } catch (error) {
    const page = await queryProductLaunchNormalizedPage(
      config,
      ownerId,
      workspace,
      query,
    );
    const items = page.items.map((item) => ({
      ...record(item),
      stockAvailability: unavailableStock(error),
    }));
    const filter = text(query.stock).toUpperCase() || "SELLABLE";
    const showUnknown = !seoReadyOnly && (filter === "ALL" || filter === "UNKNOWN");
    return {
      ...page,
      page: showUnknown ? page.page : 1,
      pageCount: showUnknown ? page.pageCount : 1,
      total: showUnknown ? page.total : 0,
      items: showUnknown ? items : [],
      stockAvailabilityMeta: {
        ok: false,
        message: "품절·판매중 전송 기록을 확인하지 못해 등록을 안전하게 차단했습니다.",
      },
    };
  }

  const stockFilter = text(query.stock).toUpperCase() || "SELLABLE";
  if (stockFilter === "ALL" && !seoReadyOnly) {
    const page = await queryProductLaunchNormalizedPage(
      config,
      ownerId,
      workspace,
      query,
    );
    return {
      ...page,
      items: page.items.map((item) => enrichStock(record(item), stockIndex)),
      stockAvailabilityMeta: stockMeta(stockIndex),
    };
  }

  const candidates = await queryProductLaunchNormalizedStockCandidates(
    config,
    ownerId,
    query,
  );
  const filtered = candidates
    .map((item) => enrichStock(item, stockIndex))
    .filter((item) =>
      productLaunchStockMatchesFilter(item.stockAvailability, stockFilter),
    )
    .filter((item) => !seoReadyOnly || isProductLaunchSeoBulkReady(item));
  const pageSize = clamp(
    query.pageSize,
    PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE,
    1,
    PRODUCT_LAUNCH_MAX_PAGE_SIZE,
  );
  const requestedPage = clamp(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;
  const pageCandidates = filtered.slice(offset, offset + pageSize);
  const summaries = await readProductLaunchNormalizedSummaries(
    config,
    ownerId,
    pageCandidates.map((item) => text(item.id)).filter(Boolean),
  );
  const summaryById = new Map(
    summaries.map((item) => [text(item.id), item]),
  );
  return {
    page,
    pageSize,
    pageCount,
    total,
    items: pageCandidates.map((candidate) =>
      enrichStock(summaryById.get(text(candidate.id)) ?? candidate, stockIndex),
    ),
    counts: isRecord(workspace.counts) ? workspace.counts : {},
    filterOptions: isRecord(workspace.filter_options)
      ? workspace.filter_options
      : { batches: [], assignees: [] },
    stockAvailabilityMeta: stockMeta(stockIndex),
  };
}

export function isProductLaunchSeoBulkReady(item: UnknownRecord) {
  const stock = isRecord(item.stockAvailability) ? item.stockAvailability : {};
  const readiness = isRecord(item.readiness) ? item.readiness : {};
  const exclusion = isRecord(item.seoExclusion) ? item.seoExclusion : {};
  return (
    exclusion.excluded !== true &&
    stock.selectable === true &&
    item.receiptPending !== true &&
    readiness.ready === true
  );
}

function enrichStock(
  item: UnknownRecord,
  stockIndex: ReturnType<typeof buildProductLaunchStockStatusIndex>,
): UnknownRecord & {
  stockAvailability: ReturnType<typeof classifyProductLaunchStockAvailability>;
} {
  return {
    ...item,
    stockAvailability: classifyProductLaunchStockAvailability(item, stockIndex),
  };
}

function stockMeta(stockIndex: ReturnType<typeof buildProductLaunchStockStatusIndex>) {
  return {
    ok: true,
    checkedAt: stockIndex.checkedAt,
    sourceFingerprint: stockIndex.sourceFingerprint,
  };
}

function unavailableStock(error: unknown) {
  return {
    status: "UNKNOWN",
    label: "재고 확인 필요",
    reason:
      error instanceof Error
        ? `품절·판매중 전송 기록 연결 실패: ${error.message}`
        : "품절·판매중 전송 기록 연결 실패",
    selectable: false,
    enforced: true,
    checkedAt: new Date().toISOString(),
    sourceFingerprint: "",
    options: [],
  };
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(text(value).toLowerCase());
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
