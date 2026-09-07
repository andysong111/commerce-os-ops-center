import type { InventoryStockControlReport } from "@/lib/inventoryStockControl";
import {
  INVENTORY_STOCK_SALES_TAIL_OPERATION_TYPE,
  loadLatestInventoryStockSalesTailSnapshots,
  type InventoryStockSalesTailSnapshot,
} from "@/lib/inventoryStockSalesTail";
import { storeInventoryOperation } from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE =
  "SHOPLING_STOCK_CANARY_PREPARATION";
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;
const TAIL_CHUNK_DAYS = 7;
const TAIL_MAX_WINDOW_DAYS = 31;
const TAIL_REFRESH_AFTER_MS = 2 * 60 * 1000;
const SHOPLING_KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_UNMAPPED_SAMPLES = 20;
const EXACT_PREPARATION_LEDGER_STATUSES = new Set(["SUCCEEDED", "PENDING"]);

type UnknownRecord = Record<string, unknown>;
type Identity = { barcode: string; unitsPerOrder: number };
type IdentityIndex = {
  byOptionId: Map<string, Identity>;
  byGoodsKey: Map<string, Identity>;
  byBarcode: Map<string, Identity>;
  knownBarcodes: Set<string>;
};

type PreparationRow = {
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
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
  const normalized = normalizeShoplingBarcode(value);
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function numericKey(value: unknown) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeUnits(value: unknown) {
  const parsed = Math.round(Number(value));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function truthy(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function shoplingCalendarDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("SHOPLING_TAIL_DATE_INVALID");
  return new Date(parsed + SHOPLING_KST_OFFSET_MS).toISOString().slice(0, 10);
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") {
      return text(direct);
    }
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null) {
      return text(row[match]);
    }
  }
  return "";
}

function rawOptionManagedCode(row: ShoplingRawRow) {
  for (const key of ["optBarcode", "opt_barcode", "barcode"]) {
    const code = barcode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function rawPartnerManagedCode(row: ShoplingRawRow) {
  for (const key of [
    "ptn_goods_cd",
    "buying_cd",
    "mall_ptn_goods_cd",
    "mall_opt_cd",
  ]) {
    const code = barcode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function registerUnique(
  target: Map<string, Identity>,
  ambiguous: Set<string>,
  key: string,
  identity: Identity,
) {
  if (!key || ambiguous.has(key)) return;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, identity);
    return;
  }
  if (
    existing.barcode !== identity.barcode ||
    existing.unitsPerOrder !== identity.unitsPerOrder
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

async function preparationRows() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return [] as PreparationRow[];
  const result = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot")
    .eq("operation_type", SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE)
    .in("status", [...EXACT_PREPARATION_LEDGER_STATUSES])
    .order("started_at", { ascending: true })
    .limit(2_000);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as PreparationRow[];
}

function exactPreparation(row: PreparationRow) {
  const ledgerStatus = text(row.status).toUpperCase();
  if (!EXACT_PREPARATION_LEDGER_STATUSES.has(ledgerStatus)) return null;

  const input = object(row.input_snapshot);
  const root = object(row.result_snapshot);
  const nested = object(root.snapshot);
  const output = Object.keys(nested).length ? nested : root;
  const code = barcode(input.barcode || output.barcode);
  const exact =
    truthy(input.preparationOnly) &&
    text(output.state).toUpperCase() === "A6_UNIQUENESS_CONFIRMED" &&
    Number(output.a6SearchResultCount) === 1 &&
    text(output.externalBarcodeCollisionCheck).toUpperCase() ===
      "EXACT_ONE_ROW_CONFIRMED";
  if (!code || !exact) return null;
  const optionIds = [
    input.shoplingOptionId,
    output.shoplingOptionId,
    output.a6MatchedShoplingOptionId,
  ]
    .map(numericKey)
    .filter(Boolean);
  const goodsKeys = [
    input.goodsKey,
    input.shoplingGoodsKey,
    input.shoplingProductId,
    output.goodsKey,
    output.shoplingGoodsKey,
    output.shoplingProductId,
    output.a6MatchedShoplingProductId,
  ]
    .map(numericKey)
    .filter(Boolean);
  if (!optionIds.length && !goodsKeys.length) return null;
  return { barcode: code, optionIds, goodsKeys };
}

async function buildIdentityIndex() {
  const [planning, preparations] = await Promise.all([
    loadProductPlanningSnapshot(),
    preparationRows(),
  ]);
  const byOptionId = new Map<string, Identity>();
  const byGoodsKey = new Map<string, Identity>();
  const byBarcode = new Map<string, Identity>();
  const ambiguousOptionIds = new Set<string>();
  const ambiguousGoodsKeys = new Set<string>();
  const ambiguousBarcodes = new Set<string>();
  const knownBarcodes = new Set<string>();

  for (const product of planning.products ?? []) {
    const code = barcode(product.barcode);
    if (!code || product.skuActive === false) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const identity = {
        barcode: code,
        unitsPerOrder: safeUnits(listing.unitsPerOrder),
      };
      const optionId = numericKey(listing.optionId);
      const goodsKey = numericKey(listing.goodsKey);
      if (optionId || goodsKey) knownBarcodes.add(code);
      registerUnique(byOptionId, ambiguousOptionIds, optionId, identity);
      registerUnique(byGoodsKey, ambiguousGoodsKeys, goodsKey, identity);
      registerUnique(byBarcode, ambiguousBarcodes, code, identity);
    }
  }

  for (const row of preparations) {
    const prepared = exactPreparation(row);
    if (!prepared) continue;
    const identity = { barcode: prepared.barcode, unitsPerOrder: 1 };
    knownBarcodes.add(prepared.barcode);
    registerUnique(byBarcode, ambiguousBarcodes, prepared.barcode, identity);
    for (const optionId of prepared.optionIds) {
      registerUnique(byOptionId, ambiguousOptionIds, optionId, identity);
    }
    for (const goodsKey of prepared.goodsKeys) {
      registerUnique(byGoodsKey, ambiguousGoodsKeys, goodsKey, identity);
    }
  }

  return { byOptionId, byGoodsKey, byBarcode, knownBarcodes } satisfies IdentityIndex;
}

function resolveIdentity(
  index: IdentityIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const directCode = rawOptionManagedCode(raw) || rawPartnerManagedCode(raw);
  if (directCode && index.byBarcode.has(directCode)) {
    return index.byBarcode.get(directCode)!;
  }
  const optionId = numericKey(order.optionId);
  if (optionId && index.byOptionId.has(optionId)) {
    return index.byOptionId.get(optionId)!;
  }
  for (const key of [numericKey(order.productId), numericKey(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function potentialTargetManagedOrder(
  index: IdentityIndex,
  targetBarcodes: Set<string>,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const directCode = rawOptionManagedCode(raw) || rawPartnerManagedCode(raw);
  if (directCode) return targetBarcodes.has(directCode);

  const optionId = numericKey(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) : null;
  if (optionIdentity && targetBarcodes.has(optionIdentity.barcode)) return true;

  for (const key of [numericKey(order.productId), numericKey(order.mallProductKey)]) {
    const identity = key ? index.byGoodsKey.get(key) : null;
    if (identity && targetBarcodes.has(identity.barcode)) return true;
  }
  return false;
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

function freshSnapshot(
  snapshot: InventoryStockSalesTailSnapshot | undefined,
  resetAt: string,
  nowIso: string,
) {
  if (!snapshot || snapshot.resetAt !== resetAt) return false;
  const endMs = Date.parse(snapshot.coverageEndAt);
  const resetMs = Date.parse(resetAt);
  const nowMs = Date.parse(nowIso);
  return Boolean(
    Number.isFinite(endMs) &&
      Number.isFinite(resetMs) &&
      Number.isFinite(nowMs) &&
      endMs >= resetMs &&
      nowMs - endMs <= TAIL_REFRESH_AFTER_MS,
  );
}

export async function ensureExactInventoryStockSalesTailCoverage(
  report: InventoryStockControlReport,
) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const snapshots = await loadLatestInventoryStockSalesTailSnapshots();
  const recentTargets = report.rows.filter((row) => {
    const resetMs = Date.parse(row.resetAt);
    return (
      Number.isFinite(resetMs) &&
      nowMs >= resetMs &&
      nowMs - resetMs <= TAIL_MAX_WINDOW_DAYS * DAY_MS
    );
  });
  const staleTargets = recentTargets.filter(
    (row) =>
      !freshSnapshot(snapshots.get(row.resetEventId), row.resetAt, nowIso),
  );
  if (!staleTargets.length) {
    return {
      ok: true as const,
      refreshed: false,
      reused: true,
      targetCount: 0,
      unmappedBarcodes: [] as string[],
      managedUnmappedRows: 0,
      message: "재고 기준점 Tail 판매 범위가 이미 최신입니다.",
    };
  }

  try {
    const index = await buildIdentityIndex();
    const targets = staleTargets.filter((row) => index.knownBarcodes.has(row.barcode));
    const unmappedBarcodes = staleTargets
      .filter((row) => !index.knownBarcodes.has(row.barcode))
      .map((row) => row.barcode)
      .sort();
    if (!targets.length) {
      return {
        ok: false as const,
        refreshed: false,
        reused: false,
        targetCount: 0,
        unmappedBarcodes,
        managedUnmappedRows: 0,
        message: `TAIL_IDENTITY_REQUIRED:${unmappedBarcodes.join(",")}`,
      };
    }

    const oldestResetAt = [...targets]
      .sort((left, right) => left.resetAt.localeCompare(right.resetAt))[0]!.resetAt;
    const oldestResetMs = Date.parse(oldestResetAt);
    const config = shoplingReadConfigFromEnv(shoplingEnvironment());
    const ranges = splitShoplingDateRange(
      shoplingCalendarDate(oldestResetAt),
      shoplingCalendarDate(nowIso),
      TAIL_CHUNK_DAYS,
    );
    const client = new ShoplingReadClient(config);
    const rawRows: UnknownRecord[] = [];
    for (const range of ranges) {
      rawRows.push(...(await client.read("orders", range)));
    }

    const targetBarcodes = new Set(targets.map((row) => row.barcode));
    const seen = new Set<string>();
    const resolvedEvents: Array<{
      externalId: string;
      barcode: string;
      occurredAt: string;
      quantity: number;
      validSale: boolean;
    }> = [];
    const managedUnmappedSamples: Array<{
      orderNo: string;
      occurredAt: string;
      optionId: string | null;
      productId: string | null;
      mallProductKey: string | null;
      directCode: string | null;
    }> = [];
    let managedUnmappedRows = 0;

    for (const raw of rawRows) {
      const shoplingRaw = raw as ShoplingRawRow;
      const order = normalizeShoplingOrder(shoplingRaw);
      const occurredAt = iso(order.orderedAt);
      if (!order.id || !order.orderNo || !occurredAt || seen.has(order.id)) continue;
      seen.add(order.id);
      const occurredMs = Date.parse(occurredAt);
      if (
        !Number.isFinite(occurredMs) ||
        occurredMs < oldestResetMs ||
        occurredMs >= nowMs
      ) {
        continue;
      }

      const identity = resolveIdentity(index, order, shoplingRaw);
      if (!identity) {
        if (potentialTargetManagedOrder(index, targetBarcodes, order, shoplingRaw)) {
          managedUnmappedRows += 1;
          if (managedUnmappedSamples.length < MAX_UNMAPPED_SAMPLES) {
            managedUnmappedSamples.push({
              orderNo: order.orderNo,
              occurredAt,
              optionId: order.optionId || null,
              productId: order.productId,
              mallProductKey: order.mallProductKey,
              directCode:
                rawOptionManagedCode(shoplingRaw) ||
                rawPartnerManagedCode(shoplingRaw) ||
                null,
            });
          }
        }
        continue;
      }
      const orderedQuantity = Math.max(0, Math.round(Number(order.quantity) || 0));
      resolvedEvents.push({
        externalId: order.id,
        barcode: identity.barcode,
        occurredAt,
        quantity: orderedQuantity * identity.unitsPerOrder,
        validSale: validSaleStatus(order.status) && orderedQuantity > 0,
      });
    }

    if (managedUnmappedRows > 0) {
      return {
        ok: false as const,
        refreshed: false,
        reused: false,
        targetCount: targets.length,
        unmappedBarcodes,
        managedUnmappedRows,
        managedUnmappedSamples,
        rangeCount: ranges.length,
        fetchedRows: rawRows.length,
        resolvedRows: resolvedEvents.length,
        message: `TAIL_MANAGED_ORDER_UNMAPPED:${managedUnmappedRows}: 대상 B코드 후보 주문을 정확히 연결하지 못해 Tail 성공 판정을 차단하고 Canonical fallback을 유지합니다.`,
      };
    }

    for (const target of targets) {
      const events = resolvedEvents
        .filter(
          (event) =>
            event.barcode === target.barcode &&
            event.occurredAt >= target.resetAt &&
            event.occurredAt < nowIso,
        )
        .sort((left, right) =>
          `${left.occurredAt}\u0000${left.externalId}`.localeCompare(
            `${right.occurredAt}\u0000${right.externalId}`,
          ),
        );
      const snapshot: InventoryStockSalesTailSnapshot = {
        resetEventId: target.resetEventId,
        barcode: target.barcode,
        resetAt: target.resetAt,
        analysisAsOf: nowIso,
        coverageStartAt: target.resetAt,
        coverageEndAt: nowIso,
        planningContentFingerprint: "exact-identity-tail-v2-kst-safe",
        fetchedRows: rawRows.length,
        matchedRows: events.length,
        events,
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
      unmappedBarcodes,
      managedUnmappedRows: 0,
      rangeCount: ranges.length,
      fetchedRows: rawRows.length,
      resolvedRows: resolvedEvents.length,
      analysisAsOf: nowIso,
      message: unmappedBarcodes.length
        ? `정확 identity가 있는 ${targets.length}개 기준점의 KST Tail 판매범위를 확인했습니다. 미연결 ${unmappedBarcodes.length}개는 Canonical fallback을 유지합니다.`
        : `재고 0 기준점 이후 KST Tail 판매범위를 ${ranges.length}개 구간으로 확인했습니다.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      refreshed: false,
      reused: false,
      targetCount: staleTargets.length,
      unmappedBarcodes: [] as string[],
      managedUnmappedRows: 0,
      message:
        error instanceof Error
          ? error.message
          : "재고 기준점 이후 Tail 판매범위를 확인하지 못했습니다.",
    };
  }
}
