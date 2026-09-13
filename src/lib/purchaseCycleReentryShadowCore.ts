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
  sourceReadStartedAt: string;
  // Additive readback fields: an unavailable source is not proof of bad SKU data.
  demandSourceState?: string; managedSkuCount?: number | null; quarantinedSkuCount?: number;
  recovery?: Array<{ id: string; state: "BLOCKED" | "REVIEW" | "VERIFIED" | "DEFERRED"; message: string }>;
  commitmentPolicy: "ALL_OPEN_INCLUDING_MANUAL_ADDITIONS";
  summary: { activeSkuCount: number | null; exactCount: number; estimatedReferenceCount: number;
    candidateCount: number; candidateQuantity: number; reviewCount: number; accumulatingCount: number };
  blockers: ReentryShadowIssue[]; warnings: string[]; rows: ReentryShadowRow[];
};

function code(value: unknown) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, "");
}
function validCode(value: string) { return /^B[A-Z]{1,2}\d+-\d+$/.test(value); }
// Read-only quarantine for the seven observed legacy launch placeholders only.
// This is not approval to accept new TMP-shaped identities or generate B-codes.
const KNOWN_LEGACY_PLACEHOLDERS = new Set(["TMP1-1", "TMP1-2", "TMP1-3", "TMP1-4", "TMP1-5", "TMP1-6", "TMP1-7"]);
function temporaryCode(value: string) { return KNOWN_LEGACY_PLACEHOLDERS.has(value); }
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
  const sourceMessages: Record<string, string> = {
    REENTRY_COMMITMENT_BARCODE_UNRESOLVED: "기존 발주에 정식 B코드가 연결되지 않은 품목이 있습니다. 실주문·옵션을 대조해 연결해야 하며 미입고를 0으로 처리하거나 자동 재발주하지 않습니다.",
    REENTRY_COMMITMENT_IDENTITY_REQUIRED: "기존 발주의 원본 시스템·주문행 식별정보가 누락됐습니다. 같은 주문의 중복 계산을 막기 위해 원본 연결을 확인해야 합니다.",
    REENTRY_COMMITMENT_STATUS_INVALID: "기존 발주 원장에 해석할 수 없는 상태가 있습니다. 주문·입고 내역 대조 전에는 진행하지 않습니다.",
    REENTRY_COMMITMENT_TIME_INVALID: "기존 발주 원장의 기록 시점을 확인하지 못했습니다. 최신 사건의 순서를 추측하지 않습니다.",
    REENTRY_COMMITMENT_READ_UNVERIFIED: "발주 원장의 전체 건수·조회 성공을 확인하지 못했습니다. 누락된 미입고를 0으로 간주하지 않고 다음 조회에서 재확인합니다.",
  };
  const blockers = (input.sourceErrors ?? []).map((value) => issue(value, sourceMessages[value] ?? "필수 원본을 읽지 못했습니다. 읽기 전용 재확인이 필요합니다."));
  const warnings = [...(input.warnings ?? [])];
  const profiles = input.planning?.products.filter((row) => row.skuActive !== false) ?? [];
  // TMP codes are explicitly unassigned launch placeholders, not canonical
  // managed B-code SKUs. Retain them visibly in quarantine; never auto-map them.
  // Unknown malformed codes still block the entire source, as before.
  const managedProfiles = profiles.filter((row) => !temporaryCode(code(row.barcode)));
  const quarantinedSkuCount = profiles.length - managedProfiles.length;
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
    const publicationPending = ["READY_CANARY", "READY_FULL"].includes(input.audit?.state ?? "");
    blockers.push(issue(publicationPending ? "DEMAND_PUBLICATION_PENDING" : "DEMAND_NOT_READY", publicationPending
      ? "주문행 수집은 끝났지만 공식 판매원장 반영 검증이 남았습니다. 기존 수집 결과의 대조·적재 검증을 먼저 완료해야 합니다. 월별 집계 갱신으로 이 단계를 대신하지 않습니다."
      : "12×30일 판매 원장의 정합성을 확인하지 못했습니다."));
  }
  if (!fresh(input.audit?.analysisAsOf, nowMs, REENTRY_DEMAND_MAX_AGE_MS) ||
      input.audit?.snapshot?.analysisAsOf !== input.audit?.analysisAsOf) {
    blockers.push(issue("DEMAND_STALE", "판매 수요 자료가 24시간 기준을 넘었거나 분석시점이 일치하지 않습니다."));
  }
  if (input.audit?.snapshot && input.planning && input.audit.snapshot.managedActiveSkuCount !== managedProfiles.length) blockers.push(issue("CATALOG_DEMAND_SCOPE_MISMATCH", "상품 기준정보와 판매 원장의 활성 SKU 범위가 다릅니다."));
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
  if (profiles.some((row) => !validCode(code(row.barcode)) && !temporaryCode(code(row.barcode)))) blockers.push(issue("CATALOG_INVALID_BARCODE", "상품 기준정보에 잘못된 B코드가 있습니다."));
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
    if (temporaryCode(key)) {
      row.issues.push(issue("CATALOG_PLACEHOLDER", "정식 B코드 배정 전 임시 상품입니다. 실제 옵션과 원본을 확인할 때까지 별도 보류하며 자동 발주하지 않습니다.", key));
      if (matches.length !== 1 || !skuId(profile.skuId) || conflictingSkuIds.has(skuId(profile.skuId))) {
        row.issues.push(issue("SKU_IDENTITY_CONFLICT", "임시 코드의 SKU 연결이 중복되거나 비어 있습니다. 정상 B코드와의 중복 여부를 확인해야 합니다.", key));
      }
      rows.push(row); continue;
    }
    if (matches.length !== 1 || !validCode(key) || !skuId(profile.skuId)) row.issues.push(issue("BARCODE_IDENTITY_CONFLICT", "B코드가 하나의 활성 SKU로 식별되지 않습니다.", key));
    if (conflictingSkuIds.has(skuId(profile.skuId)) || conflictingSkuIds.has(skuId(demand?.skuId))) row.issues.push(issue("SKU_IDENTITY_CONFLICT", "하나의 SKU ID에 서로 다른 B코드가 연결되어 중복 발주 후보를 차단했습니다.", key));
    if (!input.audit?.snapshot) {
      row.issues.push(issue("DEMAND_SOURCE_UNAVAILABLE", "공식 판매원장을 아직 읽지 못했습니다. 이 상품의 판매 연결이 잘못됐다고 확정한 것은 아닙니다.", key));
    } else if (demandMatches.length !== 1 || skuId(demand?.skuId) !== skuId(profile.skuId) ||
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
  const costMissingCount = rows.filter((row) => row.issues.some((value) => value.code === "COST_MISSING")).length;
  const stockReviewCount = rows.filter((row) => row.issues.some((value) => ["BASELINE_EVIDENCE_NOT_READY", "SALE_STATUS_RECONCILIATION", "BASELINE_CONFLICT"].includes(value.code))).length;
  const baselineWaitingCount = rows.filter((row) => row.issues.some((value) => value.code === "BASELINE_ACCUMULATING")).length;
  const demandRowReviewCount = rows.filter((row) => row.issues.some((value) => ["DEMAND_IDENTITY_OR_BUCKETS_INVALID", "DEMAND_SOURCE_UNAVAILABLE", "SKU_IDENTITY_CONFLICT"].includes(value.code))).length;
  const catalogIdentityReviewCount = rows.filter((row) => row.issues.some((value) => ["BARCODE_IDENTITY_CONFLICT", "SKU_IDENTITY_CONFLICT"].includes(value.code))).length;
  const catalogBlocked = !input.planning || blockers.some((row) => row.code.startsWith("CATALOG_") || row.code === "PLANNING_UNAVAILABLE");
  const stockSourceBlocked = !input.stock || blockers.some((row) => row.code.startsWith("STOCK_"));
  const salesBlocked = blockers.some((row) => row.code.startsWith("DEMAND_") || row.code === "CATALOG_DEMAND_SCOPE_MISMATCH");
  const commitmentBlocked = blockers.some((row) => row.code.includes("COMMITMENT"));
  const recovery: NonNullable<ReentryShadowReport["recovery"]> = [
    { id: "sales", state: salesBlocked ? "BLOCKED" : demandRowReviewCount ? "REVIEW" : "VERIFIED", message: salesBlocked ? "판매 원장의 수집·반영 단계와 실제 분석시점을 먼저 복구·검증합니다. 화면 새로고침은 원본 수집이 아닙니다." : demandRowReviewCount ? `판매 원본을 읽었지만 ${demandRowReviewCount}개 상품의 판매 연결·기간 구간·SKU 식별 검증이 남았습니다. 해당 상품을 정상 추천으로 사용하지 않습니다.` : "현재 사전 점검의 판매 자료·분석시점 검증을 통과했습니다." },
    { id: "commitments", state: commitmentBlocked ? "BLOCKED" : "VERIFIED", message: commitmentBlocked ? "기존 발주·미입고 원장과 미연결 주문행을 확인합니다. 실제 수량을 다시 입력하거나 주문하지 않습니다." : "전체 발주 원장을 읽고 수동 추가분을 포함한 미입고를 대조했습니다." },
    { id: "catalog_cost", state: catalogBlocked ? "BLOCKED" : quarantinedSkuCount || costMissingCount || catalogIdentityReviewCount ? "REVIEW" : "VERIFIED", message: `상품 기준정보 ${catalogBlocked ? "조회·범위 확인 필요" : "조회됨"} · 임시 코드 ${quarantinedSkuCount}개 · 원가 미확인 ${costMissingCount}개 · 상품 식별 재확인 ${catalogIdentityReviewCount}개. 기존 원본과 일치하는 근거만 사용하며 판매가로 원가를 만들어 넣지 않습니다.` },
    { id: "stock_sale", state: stockSourceBlocked ? "BLOCKED" : stockReviewCount || baselineWaitingCount ? "REVIEW" : "VERIFIED", message: `재고 원본 ${stockSourceBlocked ? "조회·범위 확인 필요" : "조회됨"} · 기존 근거 재확인 ${stockReviewCount}개 · 기준점 자연 축적 ${baselineWaitingCount}개. 전수 실사를 요구하지 않습니다.` },
    { id: "purchase_day", state: "DEFERRED", message: "발주일 최신 자료·마감매출·실제 투입현금으로 정상 V2를 다시 계산하고 수동 추가 미입고·추정원가 정책 차이를 대조한 뒤 사람이 소량 승인합니다. 날짜가 바뀌어도 이 화면에서 주문·결제는 실행되지 않습니다." },
  ];
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
    sourceReadStartedAt: input.readStartedAt,
    demandSourceState: input.audit?.state ?? (input.audit?.snapshot ? "UNKNOWN" : "UNAVAILABLE"),
    managedSkuCount: input.planning ? managedProfiles.length : null, quarantinedSkuCount, recovery,
    commitmentPolicy: "ALL_OPEN_INCLUDING_MANUAL_ADDITIONS",
    summary: { activeSkuCount: input.planning ? profiles.length : null,
      exactCount: rows.filter((row) => row.inventoryBasis === "EXACT").length,
      estimatedReferenceCount: rows.filter((row) => row.inventoryBasis === "ESTIMATED_REFERENCE").length,
      candidateCount: rows.filter((row) => row.stage === "PURCHASE_CANDIDATE").length,
      candidateQuantity: rows.reduce((sum, row) => sum + (row.candidateQuantity ?? 0), 0), reviewCount, accumulatingCount },
    blockers, warnings, rows,
  };
}
