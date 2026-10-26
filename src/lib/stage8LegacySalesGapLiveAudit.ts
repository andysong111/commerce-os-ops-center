import { createHash } from "node:crypto";
import { legacyOrderSurrogateValidationEvidence } from "@/data/stage8LegacyOrderSurrogateValidationEvidence";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  aggregateProductMasterShoplingSalesChunk,
} from "@/lib/productMasterShoplingSalesBackfillEngine";
import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";

const SCAN_START = "2025-04-01";
const TARGET_BARCODE = "BGG1-1";
const MAX_RANGE_DAYS = 30;

export type LegacySalesGapRangeResult = {
  range: ShoplingDateRange;
  fetchedRows: number;
  canonicalTargetUnits: number;
  currentIdentityUnits: number;
  legacyModelCurrentIdentityUnits: number;
  currentIdentityOrderRows: number;
  legacyModelCurrentIdentityOrderRows: number;
  modelNameOnlyOrderRows: number;
  foreignBcodeConflictRows: number;
  unresolvedPackRows: number;
  error: string | null;
};

export type LegacySalesGapLiveAudit = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  message: string;
  targetBarcode: string;
  modelNumber: string;
  productName: string;
  scanStart: string;
  scanEnd: string;
  canonicalWindowStart: string;
  canonicalWindowEnd: string;
  rangeCount: number;
  completedRangeCount: number;
  fetchedRows: number;
  canonicalResolvedUnits: number;
  currentIdentityUnits: number;
  legacyModelCurrentIdentityUnits: number;
  modelNameOnlyOrderRows: number;
  foreignBcodeConflictRows: number;
  unresolvedPackRows: number;
  ranges: LegacySalesGapRangeResult[];
  fingerprint: string;
  sourceReadsPerformed: true;
  businessWritesPerformed: false;
  inventoryUseAllowed: false;
  operationalEstimatePromotionAllowed: false;
};

type TargetListing = {
  goodsKey: string;
  optionId: string;
  unitsPerOrder: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") return text(direct);
    const matched = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (matched && row[matched] !== undefined && row[matched] !== null) {
      return text(row[matched]);
    }
  }
  return "";
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function dayBefore(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

function targetListings(
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
) {
  const product = planning.products.find(
    (row) => normalizeShoplingBarcode(row.barcode) === TARGET_BARCODE,
  );
  if (!product) throw new Error("LEGACY_GAP_TARGET_NOT_IN_PLANNING");
  const listings: TargetListing[] = (product.listings ?? []).map((listing) => ({
    goodsKey: text(listing.goodsKey),
    optionId: text(listing.optionId),
    unitsPerOrder: Math.max(1, Math.round(Number(listing.unitsPerOrder) || 1)),
  }));
  return { product, listings };
}

function uniqueUnitsByKey(listings: TargetListing[], key: "goodsKey" | "optionId") {
  const values = new Map<string, Set<number>>();
  for (const listing of listings) {
    const identity = listing[key];
    if (!identity) continue;
    const units = values.get(identity) ?? new Set<number>();
    units.add(listing.unitsPerOrder);
    values.set(identity, units);
  }
  const output = new Map<string, number>();
  for (const [identity, units] of values) {
    if (units.size === 1) output.set(identity, [...units][0] ?? 1);
  }
  return output;
}

function structuredCodes(row: ShoplingRawRow) {
  return [
    rawValue(row, ["optPtnOptCd"]),
    rawValue(row, ["opt_ptn_opt_cd"]),
    rawValue(row, ["ptn_opt_cd"]),
    rawValue(row, ["mall_ptn_opt_cd"]),
    rawValue(row, ["mall_opt_cd"]),
    rawValue(row, ["optBarcode", "opt_barcode", "barcode"]),
    rawValue(row, ["ptn_goods_cd"]),
    rawValue(row, ["mall_ptn_goods_cd"]),
    rawValue(row, ["buying_cd"]),
  ].filter(Boolean);
}

function hasTargetBcode(row: ShoplingRawRow) {
  return structuredCodes(row).some(
    (value) => normalizeShoplingBarcode(value) === TARGET_BARCODE,
  );
}

function hasForeignBcode(row: ShoplingRawRow) {
  return structuredCodes(row).some((value) => {
    const normalized = normalizeShoplingBarcode(value);
    return /^B[A-Z]{2}\d+-\d+$/.test(normalized) && normalized !== TARGET_BARCODE;
  });
}

function hasLegacyModelCode(row: ShoplingRawRow, modelNumber: string) {
  const base = lower(modelNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${base}(?:$|[^0-9].*)`, "i");
  return structuredCodes(row).some((value) => pattern.test(lower(value)));
}

function nameMatches(row: ShoplingRawRow, productName: string) {
  const needle = lower(productName).replace(/\s+/g, "");
  if (!needle) return false;
  return [
    rawValue(row, ["t_prod_nm"]),
    rawValue(row, ["mall_prod_nm"]),
  ].some((value) => lower(value).replace(/\s+/g, "").includes(needle));
}

function analyzeRawRange(
  rows: ShoplingRawRow[],
  range: ShoplingDateRange,
  listings: TargetListing[],
  modelNumber: string,
  productName: string,
) {
  const unitsByOption = uniqueUnitsByKey(listings, "optionId");
  const unitsByGoods = uniqueUnitsByKey(listings, "goodsKey");
  let currentIdentityUnits = 0;
  let legacyModelCurrentIdentityUnits = 0;
  let currentIdentityOrderRows = 0;
  let legacyModelCurrentIdentityOrderRows = 0;
  let modelNameOnlyOrderRows = 0;
  let foreignBcodeConflictRows = 0;
  let unresolvedPackRows = 0;
  const seen = new Set<string>();

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) continue;
    seen.add(order.id);
    if (!validSaleStatus(order.status) || order.quantity <= 0) continue;
    const orderedAt = Date.parse(order.orderedAt);
    if (!Number.isFinite(orderedAt)) continue;
    const date = new Date(orderedAt).toISOString().slice(0, 10);
    if (date < range.start || date > range.end) continue;

    const optionId = text(order.optionId);
    const productId = text(order.productId);
    const mallProductKey = text(order.mallProductKey);
    const optionUnits = optionId ? unitsByOption.get(optionId) ?? null : null;
    const goodsUnits =
      (productId ? unitsByGoods.get(productId) : null) ??
      (mallProductKey ? unitsByGoods.get(mallProductKey) : null) ??
      null;
    const unitsPerOrder = optionUnits ?? goodsUnits;
    const currentIdentity = Boolean(optionUnits || goodsUnits || hasTargetBcode(raw));
    const modelMatch = hasLegacyModelCode(raw, modelNumber);
    const productNameMatch = nameMatches(raw, productName);

    if (hasForeignBcode(raw) && currentIdentity) {
      foreignBcodeConflictRows += 1;
      continue;
    }
    if (currentIdentity) {
      currentIdentityOrderRows += 1;
      if (unitsPerOrder) {
        const baseUnits = Math.round(order.quantity) * unitsPerOrder;
        currentIdentityUnits += baseUnits;
        if (modelMatch) {
          legacyModelCurrentIdentityOrderRows += 1;
          legacyModelCurrentIdentityUnits += baseUnits;
        }
      } else {
        unresolvedPackRows += 1;
      }
      continue;
    }
    if (modelMatch && productNameMatch) modelNameOnlyOrderRows += 1;
  }

  return {
    currentIdentityUnits,
    legacyModelCurrentIdentityUnits,
    currentIdentityOrderRows,
    legacyModelCurrentIdentityOrderRows,
    modelNameOnlyOrderRows,
    foreignBcodeConflictRows,
    unresolvedPackRows,
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .slice(0, 300)
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
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

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadLegacySalesGapLiveAudit(): Promise<LegacySalesGapLiveAudit> {
  const [canonical, planning] = await Promise.all([
    loadProductMasterCanonicalSalesAudit(),
    loadProductPlanningSnapshot(),
  ]);
  const source = legacyOrderSurrogateValidationEvidence().find(
    (row) => normalizeShoplingBarcode(row.barcode) === TARGET_BARCODE,
  );
  if (!source || !canonical.ready || !canonical.analysisAsOf) {
    throw new Error("LEGACY_GAP_PREREQUISITE_BLOCKED");
  }
  const canonicalWindowStart = new Date(
    Date.parse(canonical.analysisAsOf) - 360 * 86_400_000,
  ).toISOString();
  const scanEnd = dayBefore(canonicalWindowStart);
  if (!scanEnd || scanEnd < SCAN_START) {
    throw new Error("LEGACY_GAP_RANGE_INVALID");
  }
  const { listings } = targetListings(planning);
  const ranges = splitShoplingDateRange(SCAN_START, scanEnd, MAX_RANGE_DAYS);
  if (ranges.length > 5) throw new Error("LEGACY_GAP_RANGE_LIMIT_EXCEEDED");
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const client = new ShoplingReadClient(config);
  const results: LegacySalesGapRangeResult[] = [];

  for (const range of ranges) {
    try {
      const rows = await client.read("orders", range);
      const canonicalChunk = aggregateProductMasterShoplingSalesChunk(
        rows,
        planning,
        range,
      );
      const canonicalTargetUnits = canonicalChunk.monthlyRows
        .filter((row) => normalizeShoplingBarcode(row.barcode) === TARGET_BARCODE)
        .reduce((total, row) => total + Math.max(0, Math.round(row.quantity)), 0);
      const diagnostic = analyzeRawRange(
        rows,
        range,
        listings,
        source.modelNumber,
        source.productName,
      );
      results.push({
        range,
        fetchedRows: rows.length,
        canonicalTargetUnits,
        ...diagnostic,
        error: null,
      });
    } catch (error) {
      results.push({
        range,
        fetchedRows: 0,
        canonicalTargetUnits: 0,
        currentIdentityUnits: 0,
        legacyModelCurrentIdentityUnits: 0,
        currentIdentityOrderRows: 0,
        legacyModelCurrentIdentityOrderRows: 0,
        modelNameOnlyOrderRows: 0,
        foreignBcodeConflictRows: 0,
        unresolvedPackRows: 0,
        error: safeError(error),
      });
    }
  }

  const completed = results.filter((row) => !row.error);
  const state = completed.length === results.length
    ? "READY"
    : completed.length
      ? "PARTIAL"
      : "BLOCKED";
  const totals = {
    fetchedRows: results.reduce((total, row) => total + row.fetchedRows, 0),
    canonicalResolvedUnits: results.reduce((total, row) => total + row.canonicalTargetUnits, 0),
    currentIdentityUnits: results.reduce((total, row) => total + row.currentIdentityUnits, 0),
    legacyModelCurrentIdentityUnits: results.reduce((total, row) => total + row.legacyModelCurrentIdentityUnits, 0),
    modelNameOnlyOrderRows: results.reduce((total, row) => total + row.modelNameOnlyOrderRows, 0),
    foreignBcodeConflictRows: results.reduce((total, row) => total + row.foreignBcodeConflictRows, 0),
    unresolvedPackRows: results.reduce((total, row) => total + row.unresolvedPackRows, 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    state,
    message:
      state === "READY"
        ? "Canonical 360일 시작 전 구간을 Shopling에서 읽기 전용으로 다시 조회했습니다. 현재 B-code/goods_key/option identity와 과거 aaa316 모델코드 증거를 분리해 수량을 비교하며 어느 값도 재고로 승격하지 않습니다."
        : "일부 과거 Shopling 구간 조회가 완료되지 않아 결과를 진단용으로만 보존합니다. 재고 추정 승격은 계속 차단됩니다.",
    targetBarcode: TARGET_BARCODE,
    modelNumber: source.modelNumber,
    productName: source.productName,
    scanStart: SCAN_START,
    scanEnd,
    canonicalWindowStart,
    canonicalWindowEnd: canonical.analysisAsOf,
    rangeCount: results.length,
    completedRangeCount: completed.length,
    ...totals,
    ranges: results,
    fingerprint: sha256({
      targetBarcode: TARGET_BARCODE,
      scanStart: SCAN_START,
      scanEnd,
      planningFingerprint: planning.contentFingerprint,
      canonicalFingerprint: canonical.snapshot?.contentFingerprint ?? null,
      results,
    }),
    sourceReadsPerformed: true,
    businessWritesPerformed: false,
    inventoryUseAllowed: false,
    operationalEstimatePromotionAllowed: false,
  };
}
