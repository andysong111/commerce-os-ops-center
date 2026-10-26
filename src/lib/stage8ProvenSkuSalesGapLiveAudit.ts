import { createHash } from "node:crypto";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";
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

const MAX_RANGE_DAYS = 30;
const MAX_GLOBAL_RANGES = 5;

export type ProvenSkuSalesGapState =
  | "IDENTITY_CLEAN"
  | "UNRESOLVED_IDENTITY"
  | "READ_FAILED";

export type ProvenSkuSalesGapRangeResult = {
  range: ShoplingDateRange;
  fetchedRows: number;
  error: string | null;
};

export type ProvenSkuSalesGapTarget = {
  barcode: string;
  modelNo: string;
  productName: string;
  deductionStartDate: string;
  scanEndDate: string;
  latestOrderQuantity: number;
  canonicalSalesAfterGap: number;
  currentIdentityGapUnits: number;
  legacyModelCurrentIdentityGapUnits: number;
  legacyModelWithoutCurrentIdentityRows: number;
  foreignBcodeConflictRows: number;
  unresolvedPackRows: number;
  completedRangeCount: number;
  requiredRangeCount: number;
  state: ProvenSkuSalesGapState;
  adjustedLatestResidualCandidate: number | null;
  diagnosticUseAllowed: boolean;
  confirmedInbound: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
};

export type ProvenSkuSalesGapLiveAudit = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "PARTIAL" | "BLOCKED";
  message: string;
  globalScanStart: string | null;
  globalScanEnd: string | null;
  globalRangeCount: number;
  completedGlobalRangeCount: number;
  fetchedRows: number;
  targetCount: number;
  identityCleanCount: number;
  unresolvedCount: number;
  adjustedResidualCandidateCount: number;
  ranges: ProvenSkuSalesGapRangeResult[];
  targets: ProvenSkuSalesGapTarget[];
  fingerprint: string;
  sourceReadsPerformed: boolean;
  businessWritesPerformed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

type TargetListing = {
  goodsKey: string;
  optionId: string;
  unitsPerOrder: number;
};

type TargetInput = {
  barcode: string;
  modelNo: string;
  productName: string;
  deductionStartDate: string;
  latestOrderQuantity: number;
  canonicalSalesAfterGap: number;
  listings: TargetListing[];
};

type TargetAccumulator = {
  currentIdentityGapUnits: number;
  legacyModelCurrentIdentityGapUnits: number;
  legacyModelWithoutCurrentIdentityRows: number;
  foreignBcodeConflictRows: number;
  unresolvedPackRows: number;
  completedRangeCount: number;
  requiredRangeCount: number;
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

function dayBeforeDate(iso: string) {
  const parsed = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
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

function hasTargetBcode(row: ShoplingRawRow, targetBarcode: string) {
  return structuredCodes(row).some(
    (value) => normalizeShoplingBarcode(value) === targetBarcode,
  );
}

function hasForeignBcode(row: ShoplingRawRow, targetBarcode: string) {
  return structuredCodes(row).some((value) => {
    const normalized = normalizeShoplingBarcode(value);
    return /^B[A-Z]{2}\d+-\d+$/.test(normalized) && normalized !== targetBarcode;
  });
}

function hasLegacyModelCode(row: ShoplingRawRow, modelNo: string) {
  const base = lower(modelNo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${base}(?:$|[^0-9].*)`, "i");
  return structuredCodes(row).some((value) => pattern.test(lower(value)));
}

function intersection(
  range: ShoplingDateRange,
  targetStart: string,
  globalEnd: string,
): ShoplingDateRange | null {
  const start = range.start > targetStart ? range.start : targetStart;
  const end = range.end < globalEnd ? range.end : globalEnd;
  return start <= end ? { start, end } : null;
}

function analyzeTargetRange(
  rows: ShoplingRawRow[],
  range: ShoplingDateRange,
  target: TargetInput,
) {
  const unitsByOption = uniqueUnitsByKey(target.listings, "optionId");
  const unitsByGoods = uniqueUnitsByKey(target.listings, "goodsKey");
  let currentIdentityGapUnits = 0;
  let legacyModelCurrentIdentityGapUnits = 0;
  let legacyModelWithoutCurrentIdentityRows = 0;
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
    const currentIdentity = Boolean(
      optionUnits || goodsUnits || hasTargetBcode(raw, target.barcode),
    );
    const modelMatch = hasLegacyModelCode(raw, target.modelNo);

    if (currentIdentity && hasForeignBcode(raw, target.barcode)) {
      foreignBcodeConflictRows += 1;
      continue;
    }
    if (currentIdentity) {
      if (!unitsPerOrder) {
        unresolvedPackRows += 1;
        continue;
      }
      const baseUnits = Math.round(order.quantity) * unitsPerOrder;
      currentIdentityGapUnits += baseUnits;
      if (modelMatch) legacyModelCurrentIdentityGapUnits += baseUnits;
      continue;
    }
    if (modelMatch) legacyModelWithoutCurrentIdentityRows += 1;
  }

  return {
    currentIdentityGapUnits,
    legacyModelCurrentIdentityGapUnits,
    legacyModelWithoutCurrentIdentityRows,
    foreignBcodeConflictRows,
    unresolvedPackRows,
  };
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

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .slice(0, 300)
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadProvenSkuSalesGapLiveAudit(): Promise<ProvenSkuSalesGapLiveAudit> {
  const [diagnostics, planning] = await Promise.all([
    loadProvisionalInventoryDiagnostics(),
    loadProductPlanningSnapshot(),
  ]);
  const globalScanEnd = diagnostics.canonicalCoverageStartAt
    ? dayBeforeDate(diagnostics.canonicalCoverageStartAt)
    : "";
  const planningIndex = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [normalizeShoplingBarcode(row.barcode), row] as const),
  );
  const targets: TargetInput[] = diagnostics.rows
    .filter(
      (row) =>
        row.state === "LATEST_COVERAGE_GAP" &&
        row.modelNo &&
        row.latestDeductionStartDate &&
        row.latestOrderQuantity !== null,
    )
    .map((row) => {
      const product = planningIndex.get(row.barcode);
      if (!product) throw new Error(`GAP_TARGET_NOT_IN_PLANNING:${row.barcode}`);
      return {
        barcode: row.barcode,
        modelNo: row.modelNo ?? "",
        productName: row.productName,
        deductionStartDate: row.latestDeductionStartDate ?? "",
        latestOrderQuantity: row.latestOrderQuantity ?? 0,
        canonicalSalesAfterGap: row.canonical360SalesQuantity,
        listings: (product.listings ?? [])
          .filter((listing) => listing.active !== false)
          .map((listing) => ({
            goodsKey: text(listing.goodsKey),
            optionId: text(listing.optionId),
            unitsPerOrder: Math.max(1, Math.round(Number(listing.unitsPerOrder) || 1)),
          })),
      };
    });
  const globalScanStart = [...targets]
    .map((target) => target.deductionStartDate)
    .sort()[0] ?? null;

  if (
    diagnostics.state !== "READY_READ_ONLY" ||
    !globalScanStart ||
    !globalScanEnd ||
    globalScanStart > globalScanEnd ||
    !targets.length
  ) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      message: "Canonical exact 판매 시작 전 gap을 가진 증명 SKU가 없거나 선행 진단이 준비되지 않아 live gap 조회를 실행하지 않습니다.",
      globalScanStart,
      globalScanEnd: globalScanEnd || null,
      globalRangeCount: 0,
      completedGlobalRangeCount: 0,
      fetchedRows: 0,
      targetCount: targets.length,
      identityCleanCount: 0,
      unresolvedCount: targets.length,
      adjustedResidualCandidateCount: 0,
      ranges: [],
      targets: [],
      fingerprint: sha256({ state: "BLOCKED", globalScanStart, globalScanEnd }),
      sourceReadsPerformed: false,
      businessWritesPerformed: false,
      inventoryPromotionAllowed: false,
      purchaseWritesEnabled: false,
      inventoryWritesEnabled: false,
    };
  }

  const ranges = splitShoplingDateRange(
    globalScanStart,
    globalScanEnd,
    MAX_RANGE_DAYS,
  );
  if (ranges.length > MAX_GLOBAL_RANGES) {
    throw new Error(`PROVEN_SKU_GAP_RANGE_LIMIT_EXCEEDED:${ranges.length}`);
  }
  const accumulators = new Map<string, TargetAccumulator>(
    targets.map((target) => [
      target.barcode,
      {
        currentIdentityGapUnits: 0,
        legacyModelCurrentIdentityGapUnits: 0,
        legacyModelWithoutCurrentIdentityRows: 0,
        foreignBcodeConflictRows: 0,
        unresolvedPackRows: 0,
        completedRangeCount: 0,
        requiredRangeCount: ranges.filter(
          (range) => intersection(range, target.deductionStartDate, globalScanEnd),
        ).length,
      },
    ]),
  );
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const client = new ShoplingReadClient(config);
  const rangeResults: ProvenSkuSalesGapRangeResult[] = [];

  for (const range of ranges) {
    try {
      const rows = await client.read("orders", range);
      rangeResults.push({ range, fetchedRows: rows.length, error: null });
      for (const target of targets) {
        const targetRange = intersection(range, target.deductionStartDate, globalScanEnd);
        if (!targetRange) continue;
        const result = analyzeTargetRange(rows, targetRange, target);
        const accumulator = accumulators.get(target.barcode);
        if (!accumulator) continue;
        accumulator.currentIdentityGapUnits += result.currentIdentityGapUnits;
        accumulator.legacyModelCurrentIdentityGapUnits +=
          result.legacyModelCurrentIdentityGapUnits;
        accumulator.legacyModelWithoutCurrentIdentityRows +=
          result.legacyModelWithoutCurrentIdentityRows;
        accumulator.foreignBcodeConflictRows += result.foreignBcodeConflictRows;
        accumulator.unresolvedPackRows += result.unresolvedPackRows;
        accumulator.completedRangeCount += 1;
      }
    } catch (error) {
      rangeResults.push({
        range,
        fetchedRows: 0,
        error: safeError(error),
      });
    }
  }

  const targetResults = targets.map((target): ProvenSkuSalesGapTarget => {
    const accumulator = accumulators.get(target.barcode) ?? {
      currentIdentityGapUnits: 0,
      legacyModelCurrentIdentityGapUnits: 0,
      legacyModelWithoutCurrentIdentityRows: 0,
      foreignBcodeConflictRows: 0,
      unresolvedPackRows: 0,
      completedRangeCount: 0,
      requiredRangeCount: 0,
    };
    const readsComplete =
      accumulator.requiredRangeCount > 0 &&
      accumulator.completedRangeCount === accumulator.requiredRangeCount;
    const identityClean =
      readsComplete &&
      accumulator.legacyModelWithoutCurrentIdentityRows === 0 &&
      accumulator.foreignBcodeConflictRows === 0 &&
      accumulator.unresolvedPackRows === 0;
    const state: ProvenSkuSalesGapState = !readsComplete
      ? "READ_FAILED"
      : identityClean
        ? "IDENTITY_CLEAN"
        : "UNRESOLVED_IDENTITY";
    const adjustedLatestResidualCandidate = identityClean
      ? Math.max(
          0,
          target.latestOrderQuantity -
            accumulator.currentIdentityGapUnits -
            target.canonicalSalesAfterGap,
        )
      : null;
    return {
      barcode: target.barcode,
      modelNo: target.modelNo,
      productName: target.productName,
      deductionStartDate: target.deductionStartDate,
      scanEndDate: globalScanEnd,
      latestOrderQuantity: target.latestOrderQuantity,
      canonicalSalesAfterGap: target.canonicalSalesAfterGap,
      currentIdentityGapUnits: accumulator.currentIdentityGapUnits,
      legacyModelCurrentIdentityGapUnits:
        accumulator.legacyModelCurrentIdentityGapUnits,
      legacyModelWithoutCurrentIdentityRows:
        accumulator.legacyModelWithoutCurrentIdentityRows,
      foreignBcodeConflictRows: accumulator.foreignBcodeConflictRows,
      unresolvedPackRows: accumulator.unresolvedPackRows,
      completedRangeCount: accumulator.completedRangeCount,
      requiredRangeCount: accumulator.requiredRangeCount,
      state,
      adjustedLatestResidualCandidate,
      diagnosticUseAllowed: identityClean,
      confirmedInbound: false,
      inventoryUseAllowed: false,
      inventoryPromotionAllowed: false,
    };
  });
  const completedGlobalRangeCount = rangeResults.filter((row) => !row.error).length;
  const identityCleanCount = targetResults.filter(
    (row) => row.state === "IDENTITY_CLEAN",
  ).length;
  const state = completedGlobalRangeCount === ranges.length
    ? "READY_READ_ONLY"
    : completedGlobalRangeCount
      ? "PARTIAL"
      : "BLOCKED";

  return {
    generatedAt: new Date().toISOString(),
    state,
    message:
      state === "READY_READ_ONLY"
        ? "현재 exact Canonical 이벤트 시작 전 판매 gap을 Shopling 주문 API에서 최대 5개 30일 구간으로 읽기 전용 재조회했습니다. 현재 B-code/goods_key/option identity로 직접 해석되는 판매만 차감 후보로 사용하며 모호한 행이 있으면 해당 SKU는 차단합니다."
        : "일부 Shopling gap 구간을 읽지 못해 조정된 최신 잔여후보 사용을 차단합니다.",
    globalScanStart,
    globalScanEnd,
    globalRangeCount: ranges.length,
    completedGlobalRangeCount,
    fetchedRows: rangeResults.reduce((sum, row) => sum + row.fetchedRows, 0),
    targetCount: targetResults.length,
    identityCleanCount,
    unresolvedCount: targetResults.length - identityCleanCount,
    adjustedResidualCandidateCount: targetResults.filter(
      (row) => row.adjustedLatestResidualCandidate !== null,
    ).length,
    ranges: rangeResults,
    targets: targetResults,
    fingerprint: sha256({
      diagnosticsFingerprint: diagnostics.fingerprint,
      planningFingerprint: planning.contentFingerprint,
      globalScanStart,
      globalScanEnd,
      rangeResults,
      targetResults,
    }),
    sourceReadsPerformed: true,
    businessWritesPerformed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}
