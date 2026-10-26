import {
  buildProductLaunchInventoryIndex,
  classifyProductLaunchStockAvailability,
  loadProductLaunchInventorySnapshot,
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
  let inventory;
  try {
    inventory = buildProductLaunchInventoryIndex(
      await loadProductLaunchInventorySnapshot(),
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
    const showUnknown = filter === "ALL" || filter === "UNKNOWN";
    return {
      ...page,
      page: showUnknown ? page.page : 1,
      pageCount: showUnknown ? page.pageCount : 1,
      total: showUnknown ? page.total : 0,
      items: showUnknown ? items : [],
      stockAvailabilityMeta: {
        ok: false,
        message: "재고 확인 서버에 연결하지 못해 등록을 안전하게 차단했습니다.",
      },
    };
  }

  const stockFilter = text(query.stock).toUpperCase() || "SELLABLE";
  if (stockFilter === "ALL") {
    const page = await queryProductLaunchNormalizedPage(
      config,
      ownerId,
      workspace,
      query,
    );
    return {
      ...page,
      items: page.items.map((item) => enrichStock(record(item), inventory)),
      stockAvailabilityMeta: stockMeta(inventory),
    };
  }

  const candidates = await queryProductLaunchNormalizedStockCandidates(
    config,
    ownerId,
    query,
  );
  const filtered = candidates
    .map((item) => enrichStock(item, inventory))
    .filter((item) =>
      productLaunchStockMatchesFilter(item.stockAvailability, stockFilter),
    );
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
      enrichStock(summaryById.get(text(candidate.id)) ?? candidate, inventory),
    ),
    counts: isRecord(workspace.counts) ? workspace.counts : {},
    filterOptions: isRecord(workspace.filter_options)
      ? workspace.filter_options
      : { batches: [], assignees: [] },
    stockAvailabilityMeta: stockMeta(inventory),
  };
}

function enrichStock(
  item: UnknownRecord,
  inventory: ReturnType<typeof buildProductLaunchInventoryIndex>,
): UnknownRecord & {
  stockAvailability: ReturnType<typeof classifyProductLaunchStockAvailability>;
} {
  return {
    ...item,
    stockAvailability: classifyProductLaunchStockAvailability(item, inventory),
  };
}

function stockMeta(inventory: ReturnType<typeof buildProductLaunchInventoryIndex>) {
  return {
    ok: true,
    checkedAt: inventory.checkedAt,
    sourceFingerprint: inventory.sourceFingerprint,
  };
}

function unavailableStock(error: unknown) {
  return {
    status: "UNKNOWN",
    label: "재고 확인 필요",
    reason:
      error instanceof Error
        ? `재고 확인 서버 연결 실패: ${error.message}`
        : "재고 확인 서버 연결 실패",
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
