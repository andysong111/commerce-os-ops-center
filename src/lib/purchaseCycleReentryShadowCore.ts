import { createHash } from "node:crypto";
import { calculatePurchaseV2Product, PURCHASE_V2_RULE_VERSION } from "./productDecisionEngine/purchaseV2";
import type { InventoryStockControlReport } from "./inventoryStockControl";
import type { ProductMasterCanonicalSalesAudit } from "./productMasterCanonicalSalesAudit";
import type { ProductPlanningSnapshot } from "./shopling/shoplingLiveAggregation";
import type { ChinaOrderLedgerSummary } from "./chinaOrderLedger";
import type { ProvisionalInventoryDiagnostics } from "./stage8ProvisionalInventoryDiagnostics";

export const REENTRY_SHADOW_VERSION = "purchase-reentry-shadow-v1";
export const REENTRY_DEMAND_MAX_AGE_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const MAX_SOURCE_READ_AGE_MS = 5 * 60_000;

export type ReentryShadowIssue = { code: string; message: string; barcode: string | null };
export type ReentryShadowRow = {
  barcode: string; productName: string; modelNo: string | null;
  stockQuantity: number | null; inventoryLowQuantity: number | null;
  inventoryHighQuantity: number | null; inventoryBasis: "EXACT" | "ESTIMATED_REFERENCE" | "UNKNOWN";
  baselineAt: string | null; baselineEventId: string | null;
  desiredStatus: string | null; syncOutcome: string | null;
  openCommitmentQuantity: number | null; manualOpenDifferenceQuantity: number;
  forecast30Quantity: number | null; target44Quantity: number | null;
  referenceNeedQuantity: number | null; candidateQuantity: number | null;
  allocatedQuantity: 0; stage: "DATA_HOLD" | "BASELINE_ACCUMULATING" | "REVIEW" | "STOCK_SUFFICIENT" | "PURCHASE_CANDIDATE";
  engineDecision: string | null; reasons: string[]; issues: ReentryShadowIssue[];
};
export type ReentryShadowInput = {
  now: string; targetCycleMonth: string; readStartedAt: string;
  planning: ProductPlanningSnapshot | null;
  audit: ProductMasterCanonicalSalesAudit | null;
  stock: InventoryStockControlReport | null;
  ledger: ChinaOrderLedgerSummary | null;
  diagnostics?: ProvisionalInventoryDiagnostics | null;
  feedback?: { multipliers: Map<string, number>; fingerprint: string } | null;
  sourceErrors?: string[];
  warnings?: string[];
};
export type ReentryShadowReport = {
  version: string; engineVersion: string; generatedAt: string;
  targetCycleMonth: string; budgetMonth: string;
  state: "READY_SHADOW" | "REVIEW_SHADOW" | "BLOCKED";
  mode: "SHADOW_READ_ONLY"; basis: "CURRENT_AS_OF_NOT_FUTURE_PROJECTION";
  writesEnabled: false; actualPurchaseExecuted: false; approvalGranted: false;
  cashBudgetKrw: null; budgetAllocationState: "AWAITING_PURCHASE_DAY_CASH_AND_CLOSED_REVENUE";
  sourceFingerprint: string; demandAsOf: string | null; stockReadAt: string | null;
  sourceReadStartedAt: string; commitmentPolicy: "ALL_OPEN_INCLUDING_MANUAL_ADDITIONS";
  summary: { activeSkuCount: number | null; exactCount: number; estimatedReferenceCount: number;
    candidateCount: number; candidateQuantity: number; reviewCount: number; accumulatingCount: number };
  blockers: ReentryShadowIssue[]; warnings: string[]; rows: ReentryShadowRow[];
};

function code(value: unknown) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, "");
}
function validCode(value: string) { return /^B[A-Z]{1,2}\d+-\d+$/.test(value); }
function quantity(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function fresh(value: string | null | undefined, now: number, maxAge: number) {
  const at = Date.parse(value ?? "");
  return Number.isFinite(at) && at <= now + CLOCK_SKEW_MS && now - at <= maxAge;
}
function groups<T extends { barcode: string }>(rows: readonly T[]) {
  const result = new Map<string, T[]>();
  for (const row of rows) { const key = code(row.barcode); result.set(key, [...(result.get(key) ?? []), row]); }
  return result;
}
function skuId(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}
function ambiguousSkuIds(rows: readonly { skuId?: unknown; barcode: string }[]) {
  const barcodesBySku = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = skuId(row.skuId);
    if (!id) continue;
    const barcodes = barcodesBySku.get(id) ?? new Set<string>();
    barcodes.add(code(row.barcode));
    barcodesBySku.set(id, barcodes);
  }
  return new Set([...barcodesBySku].filter(([, barcodes]) => barcodes.size > 1).map(([id]) => id));
}
function issue(codeValue: string, message: string, barcode: string | null = null): ReentryShadowIssue {
  return { code: codeValue, message, barcode };
}
function hash(value: unknown) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
export function reentryShadowMonths(now: string) {
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error("REENTRY_TIME_INVALID");
  const seoul = new Date(at.getTime() + 9 * 60 * 60_000);
  const current = seoul.toISOString().slice(0, 7);
  const next = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  return { current, next };
}
export function validateReentryTargetMonth(value: string, now: string) {
  const { current, next } = reentryShadowMonths(now);
  if (value !== current && value !== next) throw new Error("REENTRY_TARGET_MONTH_INVALID");
  return value;
}

// Read-only rehearsal: never manufacture exact zero inventory, allocate cash,
// create a Draft, or feed this response into the approval/finalization APIs.
export function buildPurchaseCycleReentryShadow(input: ReentryShadowInput): ReentryShadowReport {
  const nowMs = Date.parse(input.now);
  const target = validateReentryTargetMonth(input.targetCycleMonth, input.now);
  const [year, month] = target.split("-").map(Number);
  const budgetMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const blockers = (input.sourceErrors ?? []).map((value) => issue(value, "필수 원본을 읽지 못했습니다. 읽기 전용 재확인이 필요합니다."));
  const warnings = [...(input.warnings ?? [])];
  const profiles = input.planning?.products.filter((row) => row.skuActive !== false) ?? [];
  const stocks = input.stock?.rows ?? [];
  const auditRows = input.audit?.snapshot?.rows ?? [];
  const byProfile = groups(profiles), byStock = groups(stocks), byDemand = groups(auditRows);
  const byDiagnostic = groups(input.diagnostics?.rows ?? []);
  const conflictingSkuIds = ambiguousSkuIds([...profiles, ...auditRows]);
  if (!input.planning || !profiles.length || !fresh(input.planning.generatedAt, nowMs, MAX_SOURCE_READ_AGE_MS)) {
    blockers.push(issue("PLANNING_UNAVAILABLE", "상품 기준정보를 최신 상태로 확인하지 못했습니다."));
  }
  if (!fresh(input.readStartedAt, nowMs, MAX_SOURCE_READ_AGE_MS)) blockers.push(issue("SOURCE_READ_EXPIRED", "원본 조회가 지연되어 결과를 보류합니다."));
  if (!input.audit?.ready || !input.audit.snapshot?.classificationComplete ||
      input.audit.snapshot.bucketCount !== 12 || input.audit.snapshot.bucketDays !== 30 ||
      input.audit.snapshot.orphanEventCount !== 0 ||
      input.audit.snapshot.rows.length !== input.audit.snapshot.managedActiveSkuCount) {
    blockers.push(issue("DEMAND_NOT_READY", "12×30일 판매 원장의 정합성을 확인하지 못했습니다."));
  }
  if (!fresh(input.audit?.analysisAsOf, nowMs, REENTRY_DEMAND_MAX_AGE_MS) ||
      input.audit?.snapshot?.analysisAsOf !== input.audit?.analysisAsOf) {
    blockers.push(issue("DEMAND_STALE", "판매 수요 자료가 24시간 기준을 넘었거나 분석시점이 일치하지 않습니다."));
  }
  if (input.audit?.snapshot && input.planning && input.audit.snapshot.managedActiveSkuCount !== profiles.length) blockers.push(issue("CATALOG_DEMAND_SCOPE_MISMATCH", "상품 기준정보와 판매 원장의 활성 SKU 범위가 다릅니다."));
  if (!input.stock || !fresh(input.stock.generatedAt, nowMs, MAX_SOURCE_READ_AGE_MS)) blockers.push(issue("STOCK_UNAVAILABLE", "현재 재고 근거를 읽지 못했습니다."));
  // Existing validator reports individual expired baselines as BLOCKED. Keep
  // unrelated verified rows useful, but never ignore a true upstream read error.
  if (input.stock?.state !== "READY") {
    const stockErrors = input.stock?.blockers ?? [];
    if (!stockErrors.length || stockErrors.some((value) => !value.startsWith("PURCHASE_STOCK_EVIDENCE_REQUIRED:"))) {
      blockers.push(issue("STOCK_SOURCE_BLOCKED", "재고 원본 조회가 차단되어 신규 발주 판단을 보류합니다."));
    }
  }
  if (!input.ledger || input.ledger.invalidEventCount > 0) blockers.push(issue("COMMITMENTS_UNAVAILABLE", "기존 발주·입고대기 원장을 완전히 확인하지 못했습니다."));
  if (profiles.some((row) => !validCode(code(row.barcode)))) blockers.push(issue("CATALOG_INVALID_BARCODE", "상품 기준정보에 잘못된 B코드가 있습니다."));
  const openByCode = new Map<string, number>();
  const manualGapByCode = new Map<string, number>();
  for (const row of input.ledger?.commitments ?? []) {
    const key = code(row.barcode);
    if (!validCode(key) || !quantity(row.openQuantity) || !quantity(row.recommendationOpenQuantity) ||
        row.recommendationOpenQuantity > row.openQuantity || !fresh(row.updatedAt, nowMs, Number.MAX_SAFE_INTEGER)) {
      blockers.push(issue("COMMITMENT_INVALID", "미입고 수량 또는 발주 원장 시점이 올바르지 않습니다.", key));
      continue;
    }
    const total = (openByCode.get(key) ?? 0) + row.openQuantity;
    if (!quantity(total)) { blockers.push(issue("COMMITMENT_OVERFLOW", "미입고 합계 범위를 초과했습니다.", key)); continue; }
    openByCode.set(key, total);
    manualGapByCode.set(key, (manualGapByCode.get(key) ?? 0) + row.openQuantity - row.recommendationOpenQuantity);
  }
  const rows: ReentryShadowRow[] = [];
  for (const [key, matches] of [...byProfile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const profile = matches[0];
    const stockMatches = byStock.get(key) ?? [], demandMatches = byDemand.get(key) ?? [];
    const stock = stockMatches[0], demand = demandMatches[0];
    const diagnosticMatches = byDiagnostic.get(key) ?? [];
    const diagnostic = diagnosticMatches[0];
    const row: ReentryShadowRow = {
      barcode: key, productName: profile.productName || key, modelNo: profile.modelNo || null,
      stockQuantity: null, inventoryLowQuantity: null, inventoryHighQuantity: null, inventoryBasis: "UNKNOWN",
      baselineAt: stock?.resetAt ?? null, baselineEventId: stock?.resetEventId ?? null,
      desiredStatus: stock?.desiredStatus ?? null, syncOutcome: stock?.latestSyncOutcome ?? null,
      openCommitmentQuantity: input.ledger ? openByCode.get(key) ?? 0 : null,
      manualOpenDifferenceQuantity: manualGapByCode.get(key) ?? 0,
      forecast30Quantity: null, target44Quantity: null, referenceNeedQuantity: null, candidateQuantity: null,
      allocatedQuantity: 0, stage: "DATA_HOLD", engineDecision: null, reasons: [], issues: [],
    };
    if (matches.length !== 1 || !validCode(key) || !skuId(profile.skuId)) row.issues.push(issue("BARCODE_IDENTITY_CONFLICT", "B코드가 하나의 활성 SKU로 식별되지 않습니다.", key));
    if (conflictingSkuIds.has(skuId(profile.skuId)) || conflictingSkuIds.has(skuId(demand?.skuId))) row.issues.push(issue("SKU_IDENTITY_CONFLICT", "하나의 SKU ID에 서로 다른 B코드가 연결되어 중복 발주 후보를 차단했습니다.", key));
    if (demandMatches.length !== 1 || skuId(demand?.skuId) !== skuId(profile.skuId) ||
        (!Array.isArray(demand?.monthlyUnits) || demand.monthlyUnits.length !== 12 || !demand.monthlyUnits.every(quantity)) ||
        (!Array.isArray(demand?.monthlyRevenue) || demand.monthlyRevenue.length !== 12 || !demand.monthlyRevenue.every(finiteNonnegative))) {
      row.issues.push(issue("DEMAND_IDENTITY_OR_BUCKETS_INVALID", "판매 SKU 연결 또는 12개 수요 구간을 확인할 수 없습니다.", key));
    }
    if (stockMatches.length > 1) row.issues.push(issue("BASELINE_CONFLICT", "동일 B코드 재고 기준점이 중복됩니다.", key));
    if (stockMatches.length === 1) {
      if (!stock.salesCoverageReady || !quantity(stock.exactInventoryQuantity) ||
          !stock.resetEventId || !Number.isFinite(Date.parse(stock.resetAt)) || Date.parse(stock.resetAt) > nowMs) {
        row.issues.push(issue("BASELINE_EVIDENCE_NOT_READY", "확보된 기준점 이후 최신 판매범위를 확인하지 못했습니다. 추정재고로 우회하지 않습니다.", key));
      } else {
        row.inventoryBasis = "EXACT";
        row.stockQuantity = row.inventoryLowQuantity = row.inventoryHighQuantity = stock.exactInventoryQuantity;
        const status = stock.exactInventoryQuantity > 0 ? "ON_SALE" : "SOLD_OUT";
        if (stock.desiredStatus !== status || stock.syncNeeded || stock.syncBlocked || stock.latestSyncOutcome !== "SUCCEEDED") {
          row.issues.push(issue("SALE_STATUS_RECONCILIATION", "계산재고와 샵플링 상태 반영의 최종 확인이 남아 있습니다. 자동 재전송하지 않습니다.", key));
        }
      }
    } else if (!stockMatches.length) {
      row.stage = "BASELINE_ACCUMULATING";
      if (diagnosticMatches.length === 1 && input.diagnostics?.state === "READY_READ_ONLY" &&
          fresh(input.diagnostics.canonicalCoverageEndAt, nowMs, REENTRY_DEMAND_MAX_AGE_MS) &&
          diagnostic?.state === "BAND_READY" && quantity(diagnostic.diagnosticLowQuantity) &&
          quantity(diagnostic.diagnosticHighQuantity) && diagnostic.diagnosticLowQuantity <= diagnostic.diagnosticHighQuantity) {
        row.inventoryBasis = "ESTIMATED_REFERENCE";
        row.inventoryLowQuantity = diagnostic.diagnosticLowQuantity;
        row.inventoryHighQuantity = diagnostic.diagnosticHighQuantity;
      }
      row.issues.push(issue("BASELINE_ACCUMULATING", "실제 품절·실사 때 기준점을 축적합니다. 전수 실사를 요구하지 않으며 추정값은 참고로만 표시합니다.", key));
    }
    const unitCost = profile.latestCostKrw || profile.protectedCostKrw;
    if (!finiteNonnegative(unitCost) || unitCost <= 0) row.issues.push(issue("COST_MISSING", "상품 원가가 없어 지출을 추측하지 않습니다.", key));
    const multiplier = input.feedback?.multipliers.get(key) ?? 1;
    if (!Number.isFinite(multiplier) || multiplier < 0.75 || multiplier > 1.25) row.issues.push(issue("FEEDBACK_INVALID", "수요 보정값이 허용 범위를 벗어났습니다.", key));
    const hardIssues = row.issues.filter((value) => !["BASELINE_ACCUMULATING", "SALE_STATUS_RECONCILIATION"].includes(value.code));
    if (!blockers.length && !hardIssues.length && row.inventoryBasis !== "UNKNOWN" && demand) {
      const result = calculatePurchaseV2Product({
        barcode: key, name: row.productName, modelNo: row.modelNo,
        monthlyUnits: demand.monthlyUnits, monthlyRevenue: demand.monthlyRevenue, unitCostKrw: Number(unitCost),
        inventorySource: row.inventoryBasis === "EXACT" ? "EXACT_AFTER_STOCKOUT_RESET" : "ESTIMATED_BAND",
        inventoryLowQuantity: row.inventoryLowQuantity, inventoryHighQuantity: row.inventoryHighQuantity,
        openCommitmentQuantity: row.openCommitmentQuantity,
        recent30StockoutDays: stock?.recent30StockoutDays ?? 0, feedbackMultiplier: multiplier,
      });
      if (![result.forecast30Quantity, result.target44Quantity, result.referenceNeedQuantity, result.recommendedQuantity].every(quantity)) {
        row.issues.push(issue("ENGINE_RESULT_INVALID", "계산 수량이 허용 범위를 벗어났습니다.", key)); rows.push(row); continue;
      }
      row.forecast30Quantity = result.forecast30Quantity; row.target44Quantity = result.target44Quantity;
      row.referenceNeedQuantity = result.referenceNeedQuantity; row.engineDecision = result.decision;
      row.reasons = result.reasons;
      if (!["ORDER", "HOLD"].includes(result.decision)) row.issues.push(issue("ENGINE_REVIEW", result.reasons.join(" ") || "기존 V2 규칙의 추가 검토 대상입니다.", key));
      if (row.inventoryBasis === "EXACT" && !row.issues.length && ["ORDER", "HOLD"].includes(result.decision)) {
        row.candidateQuantity = result.recommendedQuantity;
        row.stage = result.recommendedQuantity > 0 ? "PURCHASE_CANDIDATE" : "STOCK_SUFFICIENT";
      } else {
        row.stage = "REVIEW";
      }
    } else if (blockers.length || hardIssues.length || stockMatches.length > 0) row.stage = "DATA_HOLD";
    if (row.manualOpenDifferenceQuantity > 0) row.reasons.push("중복 발주 방지를 위해 수동 추가분을 포함한 전체 미입고를 차감했습니다. 기존 확정안은 변경하지 않습니다.");
    rows.push(row);
  }
  const reviewCount = rows.filter((row) => ["DATA_HOLD", "REVIEW"].includes(row.stage)).length;
  const accumulatingCount = rows.filter((row) => row.stage === "BASELINE_ACCUMULATING").length;
  const state = blockers.length ? "BLOCKED" : reviewCount || accumulatingCount ? "REVIEW_SHADOW" : "READY_SHADOW";
  const sourceFingerprint = hash({
    version: REENTRY_SHADOW_VERSION, engine: PURCHASE_V2_RULE_VERSION, target,
    demandAsOf: input.audit?.analysisAsOf, demandFingerprint: input.audit?.snapshot?.contentFingerprint,
    feedbackFingerprint: input.feedback?.fingerprint ?? null,
    planningEvidence: profiles.map((row) => [row.skuId, code(row.barcode), row.latestCostKrw, row.protectedCostKrw]).sort(),
    commitmentEvidence: (input.ledger?.commitments ?? []).map((row) => [row.id, row.sourceSystem, row.sourceLineId, row.openQuantity, row.receivedQuantity, row.cancelledQuantity, row.updatedAt]).sort(),
    diagnosticFingerprint: input.diagnostics?.fingerprint ?? null,
    blockers: blockers.map((row) => [row.code, row.barcode]).sort(), warnings: [...warnings].sort(), rows,
  });
  return {
    version: REENTRY_SHADOW_VERSION, engineVersion: PURCHASE_V2_RULE_VERSION, generatedAt: input.now,
    targetCycleMonth: target, budgetMonth, state, mode: "SHADOW_READ_ONLY", basis: "CURRENT_AS_OF_NOT_FUTURE_PROJECTION",
    writesEnabled: false, actualPurchaseExecuted: false, approvalGranted: false, cashBudgetKrw: null,
    budgetAllocationState: "AWAITING_PURCHASE_DAY_CASH_AND_CLOSED_REVENUE", sourceFingerprint,
    demandAsOf: input.audit?.analysisAsOf ?? null, stockReadAt: input.stock?.generatedAt ?? null,
    sourceReadStartedAt: input.readStartedAt, commitmentPolicy: "ALL_OPEN_INCLUDING_MANUAL_ADDITIONS",
    summary: { activeSkuCount: input.planning ? profiles.length : null,
      exactCount: rows.filter((row) => row.inventoryBasis === "EXACT").length,
      estimatedReferenceCount: rows.filter((row) => row.inventoryBasis === "ESTIMATED_REFERENCE").length,
      candidateCount: rows.filter((row) => row.stage === "PURCHASE_CANDIDATE").length,
      candidateQuantity: rows.reduce((sum, row) => sum + (row.candidateQuantity ?? 0), 0), reviewCount, accumulatingCount },
    blockers, warnings, rows,
  };
}
