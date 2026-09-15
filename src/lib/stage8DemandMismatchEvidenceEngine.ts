import { createHash } from "node:crypto";
import {
  aggregateProductMasterShoplingSalesEventChunk,
  type ProductMasterSalesEventRow,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  aggregateShoplingOrderChunk,
  type ProductPlanningSnapshot,
  type ShoplingOrderProductAggregate,
} from "@/lib/shopling/shoplingLiveAggregation";
import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const STRUCTURED_BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_EVIDENCE_PER_CHUNK = 500;

export type DemandMismatchCategory =
  | "LEGACY_ACCEPTS_CANONICAL_IGNORES"
  | "LEGACY_ACCEPTS_CANONICAL_UNMAPPED"
  | "CANONICAL_ONLY_LEGACY_IGNORES"
  | "CANONICAL_ONLY_LEGACY_UNMAPPED"
  | "LEGACY_SKU_DIFFERS_FROM_CANONICAL"
  | "LEGACY_QTY_DIFFERS_FROM_CANONICAL"
  | "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL";

export type DemandMismatchReason =
  | "CANONICAL_ORDER_DATE_OUTSIDE_FETCH_RANGE"
  | "CANONICAL_EXCLUDES_STRUCTURED_NON_MANAGED_OPTION_BARCODE"
  | "CANONICAL_MANAGED_SCOPE_FALSE"
  | "CANONICAL_OTHER_SCOPE_EXCLUSION"
  | "CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY"
  | "LEGACY_ACTIVE_IDENTITY_MISSING"
  | "RESOLVER_SKU_PRECEDENCE_DIFFERENCE"
  | "RESOLVER_QUANTITY_RULE_DIFFERENCE"
  | "RESOLVER_REVENUE_RULE_DIFFERENCE";

export type CanonicalScopeDecisionPath =
  | "OPTION_CODE_MANAGED"
  | "OPTION_CODE_NON_MANAGED"
  | "ACTIVE_OPTION_ID"
  | "PARTNER_CODE_MANAGED"
  | "PARTNER_CODE_NON_MANAGED"
  | "ACTIVE_GOODS_KEY"
  | "NO_MANAGED_EVIDENCE";

export type DemandMismatchEvidenceRow = {
  category: DemandMismatchCategory;
  reason: DemandMismatchReason;
  externalId: string;
  orderNo: string;
  orderedAt: string;
  status: string;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  sourceRangeStart: string;
  sourceRangeEnd: string;
  rawIDt: string | null;
  orderedLocalDate: string | null;
  canonicalUtcOrderedDate: string | null;
  canonicalDateInsideFetchRange: boolean;
  canonicalScopeWouldBeManaged: boolean;
  canonicalScopeDecisionPath: CanonicalScopeDecisionPath;
  canonicalScopeOptionStructuredCode: string | null;
  canonicalScopePartnerStructuredCode: string | null;
  rawOptionBarcode: string | null;
  rawOptionBarcodeStructured: boolean;
  rawOptionBarcodeManaged: boolean;
  rawPartnerCode: string | null;
  rawMallOrderCount: string | null;
  rawQuantity: string | null;
  normalizedQuantity: number;
  normalizedUnitPrice: number;
  normalizedPaidAmount: number;
  canonicalState: "VALID" | "TOMBSTONE" | "UNMAPPED" | "IGNORED";
  canonicalBarcode: string | null;
  canonicalUnits: number;
  canonicalRevenue: number;
  legacyState: "VALID" | "UNMAPPED" | "IGNORED";
  legacyBarcode: string | null;
  legacyUnits: number;
  legacyRevenue: number;
  unitDeltaLegacyMinusCanonical: number;
  revenueDeltaLegacyMinusCanonical: number;
};

export type DemandMismatchEvidenceChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  candidateRows: number;
  evidenceRows: number;
  truncatedEvidenceRows: number;
  evidence: DemandMismatchEvidenceRow[];
  categoryCounts: Record<DemandMismatchCategory, number>;
  reasonCounts: Record<DemandMismatchReason, number>;
};

export type DemandMismatchEvidenceSummary = {
  generatedAt: string;
  fetchedRows: number;
  candidateRows: number;
  evidenceRows: number;
  truncatedEvidenceRows: number;
  affectedBarcodes: string[];
  categoryCounts: Record<DemandMismatchCategory, number>;
  categoryUnitDelta: Record<DemandMismatchCategory, number>;
  categoryRevenueDelta: Record<DemandMismatchCategory, number>;
  reasonCounts: Record<DemandMismatchReason, number>;
  reasonUnitDelta: Record<DemandMismatchReason, number>;
  reasonRevenueDelta: Record<DemandMismatchReason, number>;
  topEvidence: DemandMismatchEvidenceRow[];
  evidenceFingerprint: string;
};

type TargetIndex = {
  barcodes: Set<string>;
  optionIds: Set<string>;
  goodsKeys: Set<string>;
};

type CanonicalScopeIndex = {
  managedOptionIds: Set<string>;
  managedGoodsKeys: Set<string>;
};

type CanonicalScopeProbe = {
  wouldBeManaged: boolean;
  decisionPath: CanonicalScopeDecisionPath;
  optionStructuredCode: string | null;
  partnerStructuredCode: string | null;
};

const CATEGORIES: DemandMismatchCategory[] = [
  "LEGACY_ACCEPTS_CANONICAL_IGNORES",
  "LEGACY_ACCEPTS_CANONICAL_UNMAPPED",
  "CANONICAL_ONLY_LEGACY_IGNORES",
  "CANONICAL_ONLY_LEGACY_UNMAPPED",
  "LEGACY_SKU_DIFFERS_FROM_CANONICAL",
  "LEGACY_QTY_DIFFERS_FROM_CANONICAL",
  "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL",
];

const REASONS: DemandMismatchReason[] = [
  "CANONICAL_ORDER_DATE_OUTSIDE_FETCH_RANGE",
  "CANONICAL_EXCLUDES_STRUCTURED_NON_MANAGED_OPTION_BARCODE",
  "CANONICAL_MANAGED_SCOPE_FALSE",
  "CANONICAL_OTHER_SCOPE_EXCLUSION",
  "CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY",
  "LEGACY_ACTIVE_IDENTITY_MISSING",
  "RESOLVER_SKU_PRECEDENCE_DIFFERENCE",
  "RESOLVER_QUANTITY_RULE_DIFFERENCE",
  "RESOLVER_REVENUE_RULE_DIFFERENCE",
];

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") return text(direct);
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null && row[match] !== "") {
      return text(row[match]);
    }
  }
  return "";
}

function managedBarcode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function normalizedBarcodeText(value: unknown) {
  return normalizeShoplingBarcode(value);
}

function structuredBarcode(value: unknown) {
  const barcode = normalizedBarcodeText(value);
  return STRUCTURED_BARCODE.test(barcode) ? barcode : "";
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function localDate(value: unknown) {
  const normalized = text(value);
  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : null;
}

function dateInsideRange(date: string | null, range: ShoplingDateRange) {
  return Boolean(date && date >= range.start && date <= range.end);
}

function emptyCategoryCounts() {
  return Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<
    DemandMismatchCategory,
    number
  >;
}

function emptyReasonCounts() {
  return Object.fromEntries(REASONS.map((reason) => [reason, 0])) as Record<
    DemandMismatchReason,
    number
  >;
}

function buildTargetIndex(
  planning: ProductPlanningSnapshot,
  targetBarcodes: string[],
): TargetIndex {
  const barcodes = new Set(targetBarcodes.map(managedBarcode).filter(Boolean));
  const optionIds = new Set<string>();
  const goodsKeys = new Set<string>();
  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    if (!barcodes.has(barcode)) continue;
    for (const listing of product.listings ?? []) {
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      if (optionId) optionIds.add(optionId);
      if (goodsKey) goodsKeys.add(goodsKey);
    }
  }
  return { barcodes, optionIds, goodsKeys };
}

function buildCanonicalScopeIndex(
  planning: ProductPlanningSnapshot,
): CanonicalScopeIndex {
  const managedOptionIds = new Set<string>();
  const managedGoodsKeys = new Set<string>();
  for (const product of planning.products ?? []) {
    if (!managedBarcode(product.barcode) || product.skuActive === false) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      if (optionId) managedOptionIds.add(optionId);
      if (goodsKey) managedGoodsKeys.add(goodsKey);
    }
  }
  return { managedOptionIds, managedGoodsKeys };
}

function inactiveManagedBarcodes(planning: ProductPlanningSnapshot) {
  return new Set(
    (planning.products ?? [])
      .filter((product) => product.skuActive === false)
      .map((product) => managedBarcode(product.barcode))
      .filter(Boolean),
  );
}

function rawOptionBarcodeText(raw: ShoplingRawRow) {
  return normalizedBarcodeText(
    rawValue(raw, ["optBarcode", "opt_barcode", "barcode"]),
  );
}

function rawPartnerCodeText(raw: ShoplingRawRow) {
  return normalizedBarcodeText(
    rawValue(raw, [
      "ptn_goods_cd",
      "buying_cd",
      "mall_ptn_goods_cd",
      "mall_opt_cd",
    ]),
  );
}

function canonicalScopeProbe(
  raw: ShoplingRawRow,
  planningIndex: CanonicalScopeIndex,
): CanonicalScopeProbe {
  const order = normalizeShoplingOrder(raw);
  const optionStructuredCode =
    structuredBarcode(rawOptionBarcodeText(raw)) || structuredBarcode(order.barcode);
  if (optionStructuredCode) {
    return {
      wouldBeManaged: MANAGED_BARCODE.test(optionStructuredCode),
      decisionPath: MANAGED_BARCODE.test(optionStructuredCode)
        ? "OPTION_CODE_MANAGED"
        : "OPTION_CODE_NON_MANAGED",
      optionStructuredCode,
      partnerStructuredCode: null,
    };
  }

  const optionId = text(order.optionId);
  if (optionId && planningIndex.managedOptionIds.has(optionId)) {
    return {
      wouldBeManaged: true,
      decisionPath: "ACTIVE_OPTION_ID",
      optionStructuredCode: null,
      partnerStructuredCode: null,
    };
  }

  const partnerStructuredCode = structuredBarcode(rawPartnerCodeText(raw));
  if (partnerStructuredCode) {
    return {
      wouldBeManaged: MANAGED_BARCODE.test(partnerStructuredCode),
      decisionPath: MANAGED_BARCODE.test(partnerStructuredCode)
        ? "PARTNER_CODE_MANAGED"
        : "PARTNER_CODE_NON_MANAGED",
      optionStructuredCode: null,
      partnerStructuredCode,
    };
  }

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && planningIndex.managedGoodsKeys.has(key)) {
      return {
        wouldBeManaged: true,
        decisionPath: "ACTIVE_GOODS_KEY",
        optionStructuredCode: null,
        partnerStructuredCode: null,
      };
    }
  }

  return {
    wouldBeManaged: false,
    decisionPath: "NO_MANAGED_EVIDENCE",
    optionStructuredCode: null,
    partnerStructuredCode: null,
  };
}

function candidateRow(raw: ShoplingRawRow, targets: TargetIndex) {
  const order = normalizeShoplingOrder(raw);
  const optionBarcode = managedBarcode(rawOptionBarcodeText(raw)) || managedBarcode(order.barcode);
  const partnerCode = managedBarcode(rawPartnerCodeText(raw));
  if (optionBarcode && targets.barcodes.has(optionBarcode)) return true;
  if (partnerCode && targets.barcodes.has(partnerCode)) return true;
  if (order.optionId && targets.optionIds.has(text(order.optionId))) return true;
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && targets.goodsKeys.has(key)) return true;
  }
  return false;
}

function canonicalContribution(
  event: ProductMasterSalesEventRow | undefined,
  unmappedRows: number,
) {
  if (event) {
    return {
      state: event.validSale ? ("VALID" as const) : ("TOMBSTONE" as const),
      barcode: event.barcode || null,
      units: event.validSale ? event.quantity : 0,
      revenue: event.validSale ? event.revenue : 0,
    };
  }
  return {
    state: unmappedRows ? ("UNMAPPED" as const) : ("IGNORED" as const),
    barcode: null,
    units: 0,
    revenue: 0,
  };
}

function legacyContribution(
  product: ShoplingOrderProductAggregate | undefined,
  acceptedRows: number,
  unmappedRows: number,
) {
  if (acceptedRows > 0 && product) {
    return {
      state: "VALID" as const,
      barcode: product.barcode || null,
      units: product.units.reduce((sum, value) => sum + Math.round(Number(value) || 0), 0),
      revenue: product.revenue.reduce((sum, value) => sum + Math.round(Number(value) || 0), 0),
    };
  }
  return {
    state: unmappedRows ? ("UNMAPPED" as const) : ("IGNORED" as const),
    barcode: null,
    units: 0,
    revenue: 0,
  };
}

function mismatchCategory(
  canonical: ReturnType<typeof canonicalContribution>,
  legacy: ReturnType<typeof legacyContribution>,
): DemandMismatchCategory | null {
  const canonicalValid = canonical.state === "VALID";
  const legacyValid = legacy.state === "VALID";
  if (!canonicalValid && legacyValid) {
    return canonical.state === "UNMAPPED"
      ? "LEGACY_ACCEPTS_CANONICAL_UNMAPPED"
      : "LEGACY_ACCEPTS_CANONICAL_IGNORES";
  }
  if (canonicalValid && !legacyValid) {
    return legacy.state === "UNMAPPED"
      ? "CANONICAL_ONLY_LEGACY_UNMAPPED"
      : "CANONICAL_ONLY_LEGACY_IGNORES";
  }
  if (!canonicalValid || !legacyValid) return null;
  if (canonical.barcode !== legacy.barcode) {
    return "LEGACY_SKU_DIFFERS_FROM_CANONICAL";
  }
  if (canonical.units !== legacy.units) {
    return "LEGACY_QTY_DIFFERS_FROM_CANONICAL";
  }
  if (canonical.revenue !== legacy.revenue) {
    return "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL";
  }
  return null;
}

function mismatchReason(
  category: DemandMismatchCategory,
  rawActualOptionBarcode: string,
  canonical: ReturnType<typeof canonicalContribution>,
  inactiveBarcodes: Set<string>,
  canonicalDateInsideFetchRange: boolean,
  scopeProbe: CanonicalScopeProbe,
): DemandMismatchReason {
  if (category === "LEGACY_ACCEPTS_CANONICAL_IGNORES") {
    // This is the exact first collector gate after order identity/date validity.
    // If it fires, scope resolution was never reached by the canonical collector.
    if (!canonicalDateInsideFetchRange) {
      return "CANONICAL_ORDER_DATE_OUTSIDE_FETCH_RANGE";
    }
    if (
      rawActualOptionBarcode &&
      STRUCTURED_BARCODE.test(rawActualOptionBarcode) &&
      !MANAGED_BARCODE.test(rawActualOptionBarcode)
    ) {
      return "CANONICAL_EXCLUDES_STRUCTURED_NON_MANAGED_OPTION_BARCODE";
    }
    if (!scopeProbe.wouldBeManaged) {
      return "CANONICAL_MANAGED_SCOPE_FALSE";
    }
    return "CANONICAL_OTHER_SCOPE_EXCLUSION";
  }
  if (
    category === "CANONICAL_ONLY_LEGACY_UNMAPPED" ||
    category === "CANONICAL_ONLY_LEGACY_IGNORES"
  ) {
    if (canonical.barcode && inactiveBarcodes.has(canonical.barcode)) {
      return "CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY";
    }
    return "LEGACY_ACTIVE_IDENTITY_MISSING";
  }
  if (category === "LEGACY_SKU_DIFFERS_FROM_CANONICAL") {
    return "RESOLVER_SKU_PRECEDENCE_DIFFERENCE";
  }
  if (category === "LEGACY_QTY_DIFFERS_FROM_CANONICAL") {
    return "RESOLVER_QUANTITY_RULE_DIFFERENCE";
  }
  return "RESOLVER_REVENUE_RULE_DIFFERENCE";
}

function evidenceImpact(row: DemandMismatchEvidenceRow) {
  return (
    Math.abs(row.unitDeltaLegacyMinusCanonical) * 1_000_000_000 +
    Math.abs(row.revenueDeltaLegacyMinusCanonical)
  );
}

export function compileDemandMismatchEvidenceChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  analysisAsOf: string,
  range: ShoplingDateRange,
  targetBarcodes: string[],
): DemandMismatchEvidenceChunk {
  const targets = buildTargetIndex(planning, targetBarcodes);
  // The fast raw-identity prefilter is intentionally incomplete: historical or
  // otherwise canonical-only identities may not exist in the current Product
  // Master lookup keys. Build a bounded canonical backstop once per Shopling
  // chunk so a row that the canonical collector actually assigns to a mismatch
  // target can never disappear from evidence before the resolvers are compared.
  const canonicalTargetExternalIds = new Set(
    aggregateProductMasterShoplingSalesEventChunk(rows, planning, range, {
      syncedAt: analysisAsOf,
      analysisAsOf,
    }).events
      .filter((event) => targets.barcodes.has(event.barcode))
      .map((event) => event.externalId),
  );
  const scopeIndex = buildCanonicalScopeIndex(planning);
  const inactiveBarcodes = inactiveManagedBarcodes(planning);
  const evidence: DemandMismatchEvidenceRow[] = [];
  const categoryCounts = emptyCategoryCounts();
  const reasonCounts = emptyReasonCounts();
  let candidateRows = 0;
  let truncatedEvidenceRows = 0;

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (
      !candidateRow(raw, targets) &&
      !canonicalTargetExternalIds.has(order.id)
    ) {
      continue;
    }
    candidateRows += 1;
    const canonicalOrderedAt = validIso(order.orderedAt);
    const orderedLocalDate = localDate(order.orderedAt);
    const canonicalUtcOrderedDate = canonicalOrderedAt?.slice(0, 10) ?? null;
    const canonicalDateInsideFetchRange = dateInsideRange(
      canonicalUtcOrderedDate,
      range,
    );
    const scopeProbe = canonicalScopeProbe(raw, scopeIndex);
    const canonicalChunk = aggregateProductMasterShoplingSalesEventChunk(
      [raw],
      planning,
      range,
      { syncedAt: analysisAsOf, analysisAsOf },
    );
    const legacyChunk = aggregateShoplingOrderChunk(
      [raw],
      planning,
      analysisAsOf,
      range,
    );
    const canonical = canonicalContribution(
      canonicalChunk.events[0],
      canonicalChunk.unmappedRows,
    );
    const legacy = legacyContribution(
      legacyChunk.products[0],
      legacyChunk.acceptedRows,
      legacyChunk.unmappedRows,
    );
    const involvesTarget =
      (canonical.barcode ? targets.barcodes.has(canonical.barcode) : false) ||
      (legacy.barcode ? targets.barcodes.has(legacy.barcode) : false);
    if (!involvesTarget) continue;
    const category = mismatchCategory(canonical, legacy);
    if (!category) continue;
    const actualOptionBarcode = rawOptionBarcodeText(raw);
    const reason = mismatchReason(
      category,
      actualOptionBarcode,
      canonical,
      inactiveBarcodes,
      canonicalDateInsideFetchRange,
      scopeProbe,
    );
    categoryCounts[category] += 1;
    reasonCounts[reason] += 1;
    if (evidence.length >= MAX_EVIDENCE_PER_CHUNK) {
      truncatedEvidenceRows += 1;
      continue;
    }
    evidence.push({
      category,
      reason,
      externalId: order.id,
      orderNo: order.orderNo,
      orderedAt: order.orderedAt,
      status: order.status,
      optionId: order.optionId || null,
      productId: order.productId,
      mallProductKey: order.mallProductKey,
      sourceRangeStart: range.start,
      sourceRangeEnd: range.end,
      rawIDt: rawValue(raw, ["i_dt"]) || null,
      orderedLocalDate,
      canonicalUtcOrderedDate,
      canonicalDateInsideFetchRange,
      canonicalScopeWouldBeManaged: scopeProbe.wouldBeManaged,
      canonicalScopeDecisionPath: scopeProbe.decisionPath,
      canonicalScopeOptionStructuredCode: scopeProbe.optionStructuredCode,
      canonicalScopePartnerStructuredCode: scopeProbe.partnerStructuredCode,
      rawOptionBarcode: actualOptionBarcode || null,
      rawOptionBarcodeStructured: STRUCTURED_BARCODE.test(actualOptionBarcode),
      rawOptionBarcodeManaged: MANAGED_BARCODE.test(actualOptionBarcode),
      rawPartnerCode: rawPartnerCodeText(raw) || null,
      rawMallOrderCount: rawValue(raw, ["mall_ord_cnt"]) || null,
      rawQuantity: rawValue(raw, ["quantity"]) || null,
      normalizedQuantity: Number(order.quantity) || 0,
      normalizedUnitPrice: Number(order.unitPrice) || 0,
      normalizedPaidAmount: Number(order.paidAmount) || 0,
      canonicalState: canonical.state,
      canonicalBarcode: canonical.barcode,
      canonicalUnits: canonical.units,
      canonicalRevenue: canonical.revenue,
      legacyState: legacy.state,
      legacyBarcode: legacy.barcode,
      legacyUnits: legacy.units,
      legacyRevenue: legacy.revenue,
      unitDeltaLegacyMinusCanonical: legacy.units - canonical.units,
      revenueDeltaLegacyMinusCanonical: legacy.revenue - canonical.revenue,
    });
  }

  evidence.sort((left, right) => evidenceImpact(right) - evidenceImpact(left));
  return {
    range,
    fetchedRows: rows.length,
    candidateRows,
    evidenceRows: evidence.length + truncatedEvidenceRows,
    truncatedEvidenceRows,
    evidence,
    categoryCounts,
    reasonCounts,
  };
}

export function combineDemandMismatchEvidenceChunks(
  chunks: DemandMismatchEvidenceChunk[],
): DemandMismatchEvidenceSummary {
  const categoryCounts = emptyCategoryCounts();
  const categoryUnitDelta = emptyCategoryCounts();
  const categoryRevenueDelta = emptyCategoryCounts();
  const reasonCounts = emptyReasonCounts();
  const reasonUnitDelta = emptyReasonCounts();
  const reasonRevenueDelta = emptyReasonCounts();
  const allEvidence: DemandMismatchEvidenceRow[] = [];
  const affected = new Set<string>();
  let fetchedRows = 0;
  let candidateRows = 0;
  let evidenceRows = 0;
  let truncatedEvidenceRows = 0;

  for (const chunk of chunks) {
    fetchedRows += chunk.fetchedRows;
    candidateRows += chunk.candidateRows;
    evidenceRows += chunk.evidenceRows;
    truncatedEvidenceRows += chunk.truncatedEvidenceRows;
    for (const category of CATEGORIES) {
      categoryCounts[category] += chunk.categoryCounts[category] || 0;
    }
    for (const reason of REASONS) {
      reasonCounts[reason] += chunk.reasonCounts?.[reason] || 0;
    }
    for (const row of chunk.evidence) {
      allEvidence.push(row);
      categoryUnitDelta[row.category] += row.unitDeltaLegacyMinusCanonical;
      categoryRevenueDelta[row.category] += row.revenueDeltaLegacyMinusCanonical;
      reasonUnitDelta[row.reason] += row.unitDeltaLegacyMinusCanonical;
      reasonRevenueDelta[row.reason] += row.revenueDeltaLegacyMinusCanonical;
      if (row.canonicalBarcode) affected.add(row.canonicalBarcode);
      if (row.legacyBarcode) affected.add(row.legacyBarcode);
    }
  }

  allEvidence.sort((left, right) => evidenceImpact(right) - evidenceImpact(left));
  const topEvidence = allEvidence.slice(0, 100);
  const normalized = {
    fetchedRows,
    candidateRows,
    evidenceRows,
    truncatedEvidenceRows,
    affectedBarcodes: [...affected].sort(),
    categoryCounts,
    categoryUnitDelta,
    categoryRevenueDelta,
    reasonCounts,
    reasonUnitDelta,
    reasonRevenueDelta,
    topEvidence,
  };
  return {
    generatedAt: new Date().toISOString(),
    ...normalized,
    evidenceFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex")}`,
  };
}