import { createHash } from "node:crypto";
import { CHINA_ORDER_EVENT_OPERATION_TYPE } from "@/lib/chinaOrderLedger";
import {
  type ExactInventoryAfterReset,
  type InventoryStockControlReport,
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  loadInventoryStockControlReport,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { normalizeShoplingOrder } from "@/lib/shopling/shoplingNormalize";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_STOCK_SALES_TAIL_OPERATION_TYPE =
  "INVENTORY_STOCK_SALES_TAIL_EVENT";

const LATEST_TAIL_SNAPSHOT_VIEW =
  "commerce_inventory_latest_tail_snapshots";
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;
const TAIL_CHUNK_DAYS = 7;
const TAIL_MAX_WINDOW_DAYS = 31;
const TAIL_REFRESH_AFTER_MS = 2 * 60 * 1000;
const TAIL_REPORT_FRESH_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_LIMIT = 10_000;

type UnknownRecord = Record<string, unknown>;
type ListingIdentity = { barcode: string; unitsPerOrder: number };
type TailSaleEvent = {
  externalId: string;
  barcode: string;
  occurredAt: string;
  quantity: number;
  validSale: boolean;
};

export type InventoryStockSalesTailSnapshot = {
  resetEventId: string;
  barcode: string;
  resetAt: string;
  analysisAsOf: string;
  coverageStartAt: string;
  coverageEndAt: string;
  planningContentFingerprint: string;
  fetchedRows: number;
  matchedRows: number;
  events: TailSaleEvent[];
};

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  status?: unknown;
};

type ReceiptPoint = {
  barcode: string;
  occurredAt: string;
  delta: number;
  sourceLineId: string;
};

type SyncPoint = {
  barcode: string;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  outcome: "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
  occurredAt: string;
};

type TimelinePoint = {
  occurredAt: string;
  delta: number;
  order: number;
};

function object(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function safeUnits(value: unknown) {
  const parsed = Math.round(number(value));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function registerUnique(
  target: Map<string, ListingIdentity>,
  ambiguous: Set<string>,
  key: string,
  value: ListingIdentity,
) {
  if (!key || ambiguous.has(key)) return;
  const current = target.get(key);
  if (!current) {
    target.set(key, value);
    return;
  }
  if (
    current.barcode !== value.barcode ||
    current.unitsPerOrder !== value.unitsPerOrder
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

function buildIdentityIndex(
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
) {
  const byOptionId = new Map<string, ListingIdentity>();
  const byGoodsKey = new Map<string, ListingIdentity>();
  const ambiguousOptionIds = new Set<string>();
  const ambiguousGoodsKeys = new Set<string>();

  for (const product of planning.products ?? []) {
    const code = barcode(product.barcode);
    if (!code || product.skuActive === false) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const identity = {
        barcode: code,
        unitsPerOrder: safeUnits(listing.unitsPerOrder),
      };
      registerUnique(
        byOptionId,
        ambiguousOptionIds,
        text(listing.optionId),
        identity,
      );
      registerUnique(
        byGoodsKey,
        ambiguousGoodsKeys,
        text(listing.goodsKey),
        identity,
      );
    }
  }
  return { byOptionId, byGoodsKey };
}

function resolveIdentity(
  index: ReturnType<typeof buildIdentityIndex>,
  order: ReturnType<typeof normalizeShoplingOrder>,
) {
  const optionId = text(order.optionId);
  if (optionId && index.byOptionId.has(optionId)) {
    return index.byOptionId.get(optionId)!;
  }
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function buildTailEvents(
  rows: UnknownRecord[],
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
  analysisAsOf: string,
) {
  const index = buildIdentityIndex(planning);
  const seen = new Set<string>();
  const events: TailSaleEvent[] = [];
  const endMs = Date.parse(analysisAsOf);

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) continue;
    seen.add(order.id);
    const occurredAt = iso(order.orderedAt);
    if (!order.orderNo || !occurredAt) continue;
    const occurredMs = Date.parse(occurredAt);
    if (!Number.isFinite(occurredMs) || occurredMs >= endMs) continue;
    const identity = resolveIdentity(index, order);
    if (!identity) continue;
    const baseQuantity = quantity(order.quantity);
    events.push({
      externalId: order.id,
      barcode: identity.barcode,
      occurredAt,
      quantity: baseQuantity * identity.unitsPerOrder,
      validSale: validSaleStatus(order.status) && baseQuantity > 0,
    });
  }

  events.sort((left, right) =>
    `${left.occurredAt}\u0000${left.externalId}`.localeCompare(
      `${right.occurredAt}\u0000${right.externalId}`,
    ),
  );
  return events;
}

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

async function readOperationRows(operationType: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,status")
    .eq("operation_type", operationType)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as StoredOperationRow[];
}

async function readLatestTailOperationRows() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  // The Tail ledger is append-only and can contain hundreds of historical
  // snapshots for only a handful of reset events. Pulling the entire history on
  // every 30-second queue poll amplified PostgREST latency enough to cross the
  // bounded admin timeout. The database projection returns exactly the latest
  // successful row per reset event while preserving the underlying ledger.
  const result = await admin
    .from(LATEST_TAIL_SNAPSHOT_VIEW)
    .select("source_event_id,result_snapshot,started_at,status")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(
      `INVENTORY_STOCK_TAIL_LATEST_VIEW_READ_FAILED:${result.error?.message ?? "NON_ARRAY_DATA"}`,
    );
  }
  if (result.data.length >= READ_LIMIT) {
    throw new Error("INVENTORY_STOCK_TAIL_LATEST_VIEW_TRUNCATED");
  }
  return result.data as StoredOperationRow[];
}

function tailSnapshotFrom(row: StoredOperationRow) {
  const root = object(row.result_snapshot);
  const source = Object.keys(object(root.snapshot)).length
    ? object(root.snapshot)
    : root;
  const resetEventId = text(source.resetEventId);
  const code = barcode(source.barcode);
  const resetAt = iso(source.resetAt);
  const analysisAsOf = iso(source.analysisAsOf);
  if (!resetEventId || !code || !resetAt || !analysisAsOf) return null;
  const events = Array.isArray(source.events)
    ? source.events
        .map(object)
        .map((event) => ({
          externalId: text(event.externalId),
          barcode: barcode(event.barcode),
          occurredAt: iso(event.occurredAt) ?? "",
          quantity: quantity(event.quantity),
          validSale: event.validSale === true,
        }))
        .filter(
          (event) => event.externalId && event.barcode && event.occurredAt,
        )
    : [];
  return {
    resetEventId,
    barcode: code,
    resetAt,
    analysisAsOf,
    coverageStartAt: iso(source.coverageStartAt) ?? resetAt,
    coverageEndAt: iso(source.coverageEndAt) ?? analysisAsOf,
    planningContentFingerprint: text(source.planningContentFingerprint),
    fetchedRows: quantity(source.fetchedRows),
    matchedRows: quantity(source.matchedRows),
    events,
  } satisfies InventoryStockSalesTailSnapshot;
}

export async function loadLatestInventoryStockSalesTailSnapshots() {
  const latest = new Map<string, InventoryStockSalesTailSnapshot>();
  for (const row of await readLatestTailOperationRows()) {
    const snapshot = tailSnapshotFrom(row);
    if (!snapshot) continue;
    const current = latest.get(snapshot.resetEventId);
    if (!current || snapshot.analysisAsOf >= current.analysisAsOf) {
      latest.set(snapshot.resetEventId, snapshot);
    }
  }
  return latest;
}

function snapshotFresh(
  snapshot: InventoryStockSalesTailSnapshot | undefined,
  resetAt: string,
  nowIso: string,
  maxAgeMs: number,
) {
  if (!snapshot || snapshot.resetAt !== resetAt) return false;
  const nowMs = Date.parse(nowIso);
  const endMs = Date.parse(snapshot.coverageEndAt);
  const resetMs = Date.parse(resetAt);
  return Boolean(
    Number.isFinite(nowMs) &&
      Number.isFinite(endMs) &&
      Number.isFinite(resetMs) &&
      endMs >= resetMs &&
      nowMs - endMs <= maxAgeMs,
  );
}

function recentTailTarget(row: ExactInventoryAfterReset, nowIso: string) {
  const nowMs = Date.parse(nowIso);
  const resetMs = Date.parse(row.resetAt);
  return (
    Number.isFinite(nowMs) &&
    Number.isFinite(resetMs) &&
    nowMs >= resetMs &&
    nowMs - resetMs <= TAIL_MAX_WINDOW_DAYS * DAY_MS
  );
}

export async function ensureInventoryStockSalesTailCoverage(
  report: InventoryStockControlReport,
) {
  const nowIso = new Date().toISOString();
  const snapshots = await loadLatestInventoryStockSalesTailSnapshots();
  const targets = report.rows
    .filter((row) => recentTailTarget(row, nowIso))
    .filter(
      (row) =>
        !snapshotFresh(
          snapshots.get(row.resetEventId),
          row.resetAt,
          nowIso,
          TAIL_REFRESH_AFTER_MS,
        ),
    )
    .sort((left, right) => left.resetAt.localeCompare(right.resetAt));

  if (!targets.length) {
    return {
      ok: true as const,
      refreshed: false,
      reused: true,
      targetCount: 0,
      message: "재고 기준점 Tail 판매 범위가 이미 최신입니다.",
    };
  }

  const oldestResetAt = targets[0]!.resetAt;
  const oldestMs = Date.parse(oldestResetAt);
  const nowMs = Date.parse(nowIso);
  if (nowMs - oldestMs > TAIL_MAX_WINDOW_DAYS * DAY_MS) {
    return {
      ok: false as const,
      refreshed: false,
      reused: false,
      targetCount: targets.length,
      message: "Tail 판매 범위가 31일을 초과해 전체 Canonical 확인이 필요합니다.",
    };
  }

  try {
    const planning = await loadProductPlanningSnapshot();
    const config = shoplingReadConfigFromEnv(shoplingEnvironment());
    const ranges = splitShoplingDateRange(
      oldestResetAt.slice(0, 10),
      nowIso.slice(0, 10),
      TAIL_CHUNK_DAYS,
    );
    const client = new ShoplingReadClient(config);
    const rawRows: UnknownRecord[] = [];
    for (const range of ranges) {
      rawRows.push(...(await client.read("orders", range)));
    }
    const events = buildTailEvents(rawRows, planning, nowIso);

    for (const target of targets) {
      const targetEvents = events.filter(
        (event) =>
          event.barcode === target.barcode &&
          event.occurredAt >= target.resetAt &&
          event.occurredAt < nowIso,
      );
      const snapshot: InventoryStockSalesTailSnapshot = {
        resetEventId: target.resetEventId,
        barcode: target.barcode,
        resetAt: target.resetAt,
        analysisAsOf: nowIso,
        coverageStartAt: target.resetAt,
        coverageEndAt: nowIso,
        planningContentFingerprint: planning.contentFingerprint,
        fetchedRows: rawRows.length,
        matchedRows: targetEvents.length,
        events: targetEvents,
      };
      await storeInventoryOperation({
        operationType: INVENTORY_STOCK_SALES_TAIL_OPERATION_TYPE,
        sourceEventId: `inventory-stock-sales-tail:${encodeURIComponent(
          target.resetEventId,
        )}:${nowIso}`,
        correlationId: `inventory-stock:${target.barcode}`,
        snapshot,
      });
    }

    return {
      ok: true as const,
      refreshed: true,
      reused: false,
      targetCount: targets.length,
      rangeCount: ranges.length,
      fetchedRows: rawRows.length,
      matchedRows: events.length,
      analysisAsOf: nowIso,
      message: `재고 0 기준점 이후 Tail 판매범위를 ${ranges.length}개 구간으로 확인했습니다.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      refreshed: false,
      reused: false,
      targetCount: targets.length,
      message:
        error instanceof Error
          ? error.message
          : "재고 기준점 이후 Tail 판매범위를 확인하지 못했습니다.",
    };
  }
}

function receiptPointsFromRows(rows: StoredOperationRow[]) {
  const byLine = new Map<
    string,
    Array<{
      barcode: string;
      occurredAt: string;
      status: string;
      requested: number;
      ordered: number;
      received: number | null;
    }>
  >();
  for (const row of rows) {
    const source = object(row.input_snapshot);
    const code = barcode(source.barcode);
    const sourceSystem = text(source.sourceSystem);
    const sourceLineId = text(source.sourceLineId);
    const occurredAt = iso(source.occurredAt) || iso(row.started_at);
    if (!code || !sourceSystem || !sourceLineId || !occurredAt) continue;
    const receivedRaw = source.receivedQuantity;
    const received =
      receivedRaw === null || receivedRaw === undefined || receivedRaw === ""
        ? null
        : quantity(receivedRaw);
    const key = `${sourceSystem}\u0000${sourceLineId}`;
    const values = byLine.get(key) ?? [];
    values.push({
      barcode: code,
      occurredAt,
      status: text(source.status).toUpperCase(),
      requested: quantity(source.requestedQuantity),
      ordered: quantity(source.orderedQuantity),
      received,
    });
    byLine.set(key, values);
  }

  const points: ReceiptPoint[] = [];
  for (const [sourceLineId, values] of byLine) {
    values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    let previousReceived = 0;
    let committed = 0;
    for (const value of values) {
      committed = Math.max(committed, value.requested, value.ordered);
      const cumulativeReceived =
        value.received !== null
          ? value.received
          : value.status === "RECEIVED"
            ? committed
            : previousReceived;
      const boundedReceived = Math.min(
        committed || cumulativeReceived,
        cumulativeReceived,
      );
      const delta = Math.max(0, boundedReceived - previousReceived);
      if (delta > 0) {
        points.push({
          barcode: value.barcode,
          occurredAt: value.occurredAt,
          delta,
          sourceLineId,
        });
      }
      previousReceived = Math.max(previousReceived, boundedReceived);
    }
  }
  return points;
}

function syncPointFrom(row: StoredOperationRow): SyncPoint | null {
  const root = object(row.result_snapshot);
  const nested = object(root.snapshot);
  const source = Object.keys(nested).length ? nested : object(row.input_snapshot);
  const code = barcode(source.barcode);
  const desired = text(source.desiredStatus).toUpperCase();
  const outcome = text(source.outcome).toUpperCase();
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (
    !code ||
    !occurredAt ||
    !["SOLD_OUT", "ON_SALE"].includes(desired) ||
    !["STARTED", "SUCCEEDED", "FAILED", "UNCERTAIN"].includes(outcome)
  ) {
    return null;
  }
  return {
    barcode: code,
    desiredStatus: desired as SyncPoint["desiredStatus"],
    outcome: outcome as SyncPoint["outcome"],
    occurredAt,
  };
}

function stateTransition(resetAt: string, timeline: TimelinePoint[]) {
  let quantityOnHand = 0;
  let desiredStatus: "SOLD_OUT" | "ON_SALE" = "SOLD_OUT";
  let desiredSince = resetAt;
  for (const point of timeline) {
    quantityOnHand = Math.max(0, quantityOnHand + point.delta);
    const next = quantityOnHand > 0 ? "ON_SALE" : "SOLD_OUT";
    if (next !== desiredStatus) {
      desiredStatus = next;
      desiredSince = point.occurredAt;
    }
  }
  return { quantityOnHand, desiredStatus, desiredSince };
}

function recent30ZeroDays(
  resetAt: string,
  timeline: TimelinePoint[],
  nowIso: string,
) {
  const nowMs = Date.parse(nowIso);
  const windowStartMs = nowMs - 30 * DAY_MS;
  let quantityOnHand = 0;
  let cursorMs = Date.parse(resetAt);
  let zeroMs = 0;
  for (const point of timeline) {
    const pointMs = Date.parse(point.occurredAt);
    if (!Number.isFinite(pointMs) || pointMs < cursorMs) continue;
    if (quantityOnHand <= 0) {
      const start = Math.max(cursorMs, windowStartMs);
      const end = Math.min(pointMs, nowMs);
      if (end > start) zeroMs += end - start;
    }
    quantityOnHand = Math.max(0, quantityOnHand + point.delta);
    cursorMs = pointMs;
  }
  if (quantityOnHand <= 0) {
    const start = Math.max(cursorMs, windowStartMs);
    if (nowMs > start) zeroMs += nowMs - start;
  }
  return Math.min(30, Math.max(0, Math.round(zeroMs / DAY_MS)));
}

function reportFingerprint(rows: ExactInventoryAfterReset[]) {
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    resetAt: row.resetAt,
    exactInventoryQuantity: row.exactInventoryQuantity,
    desiredStatus: row.desiredStatus,
    desiredSince: row.desiredSince,
    salesCoverageReady: row.salesCoverageReady,
    latestSyncOutcome: row.latestSyncOutcome,
    syncNeeded: row.syncNeeded,
    syncBlocked: row.syncBlocked,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

export async function overlayInventoryStockControlReportWithTail(
  baseReport?: InventoryStockControlReport,
) {
  const report = baseReport ?? (await loadInventoryStockControlReport());
  const [snapshots, receiptRows, syncRows] = await Promise.all([
    loadLatestInventoryStockSalesTailSnapshots(),
    readOperationRows(CHINA_ORDER_EVENT_OPERATION_TYPE),
    readOperationRows(SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE),
  ]);
  const receiptPoints = receiptPointsFromRows(receiptRows);
  const syncPoints = syncRows.map(syncPointFrom).filter(Boolean) as SyncPoint[];
  const nowIso = new Date().toISOString();

  const rows = report.rows.map((row) => {
    const tail = snapshots.get(row.resetEventId);
    if (!snapshotFresh(tail, row.resetAt, nowIso, TAIL_REPORT_FRESH_MS)) {
      return row;
    }

    const receipts = receiptPoints.filter(
      (point) =>
        point.barcode === row.barcode && point.occurredAt >= row.resetAt,
    );
    const sales = (tail?.events ?? []).filter(
      (event) =>
        event.barcode === row.barcode &&
        event.validSale &&
        event.occurredAt >= row.resetAt,
    );
    const timeline: TimelinePoint[] = [
      ...receipts.map((point) => ({
        occurredAt: point.occurredAt,
        delta: point.delta,
        order: 0,
      })),
      ...sales.map((event) => ({
        occurredAt: event.occurredAt,
        delta: -event.quantity,
        order: 1,
      })),
    ].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.order - right.order,
    );
    const transition = stateTransition(row.resetAt, timeline);
    const relatedSync = syncPoints
      .filter((event) => event.barcode === row.barcode)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latestSync = relatedSync.at(-1) ?? null;
    const succeededForDesired = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          event.desiredStatus === transition.desiredStatus &&
          event.outcome === "SUCCEEDED" &&
          event.occurredAt >= transition.desiredSince,
      );
    const unresolved = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          event.occurredAt >= transition.desiredSince &&
          (event.outcome === "STARTED" || event.outcome === "UNCERTAIN"),
      );

    let syncBlockReason: string | null = null;
    if (row.productKind === "SINGLE" && !row.modelNo) {
      syncBlockReason = "단품 A21 검색에 필요한 모델번호가 없습니다.";
    } else if (unresolved) {
      syncBlockReason =
        "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.";
    }

    return {
      ...row,
      receivedSinceReset: receipts.reduce((sum, point) => sum + point.delta, 0),
      soldSinceReset: sales.reduce((sum, event) => sum + event.quantity, 0),
      exactInventoryQuantity: transition.quantityOnHand,
      recent30StockoutDays: recent30ZeroDays(row.resetAt, timeline, nowIso),
      desiredStatus: transition.desiredStatus,
      desiredSince: transition.desiredSince,
      salesCoverageReady: true,
      receiptEvidenceCount: receipts.length,
      salesEvidenceCount: sales.length,
      latestSyncOutcome: latestSync?.outcome ?? null,
      latestSyncAt: latestSync?.occurredAt ?? null,
      syncNeeded: !succeededForDesired,
      syncBlocked: Boolean(syncBlockReason),
      syncBlockReason,
    } satisfies ExactInventoryAfterReset;
  });

  const exactRows = rows.filter((row) => row.salesCoverageReady);
  const pendingRows = rows.filter(
    (row) => row.salesCoverageReady && row.syncNeeded && !row.syncBlocked,
  );
  const uncertainRows = rows.filter(
    (row) =>
      row.latestSyncOutcome === "STARTED" ||
      row.latestSyncOutcome === "UNCERTAIN",
  );

  return {
    ...report,
    generatedAt: nowIso,
    fingerprint: reportFingerprint(rows),
    resetCount: rows.length,
    exactCount: exactRows.length,
    soldOutCount: exactRows.filter((row) => row.desiredStatus === "SOLD_OUT")
      .length,
    onSaleCount: exactRows.filter((row) => row.desiredStatus === "ON_SALE")
      .length,
    pendingSyncCount: pendingRows.length,
    uncertainSyncCount: uncertainRows.length,
    rows,
  } satisfies InventoryStockControlReport;
}
