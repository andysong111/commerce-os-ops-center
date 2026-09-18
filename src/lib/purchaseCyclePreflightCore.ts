import { createHash } from "node:crypto";
import type { CandidatePromotionGate } from "./stage8CandidatePromotionGate";
import type { PostApplyCanonicalReconciliation } from "./stage8PostApplyCanonicalReconciliation";
import type { InventoryVerificationPriority, InventoryVerificationPriorityRow } from "./stage8InventoryVerificationPriority";

// This module is a calculator, NOT an approval token, draft writer or executor.
export type PurchaseCandidatePin = {
  requestId: string;
  analysisAsOf: string;
  planFingerprint: string;
  eventFingerprint: string;
  planningContentFingerprint: string;
};
export type PurchasePreflightOptions = {
  targetDate: string;
  cashLimitKrw: number | null;
  maxSkus: number;
  maxUnitsPerSku: number;
};
export type PurchaseMonthlySpendPin = {
  cycleMonth: string;
  readAt: string;
  recordedSpendKrw: number;
  contentFingerprint: string;
};
export type PurchasePreflightInput = {
  now: string;
  options: PurchasePreflightOptions;
  before: PurchaseCandidatePin | null;
  after: PurchaseCandidatePin | null;
  gate: CandidatePromotionGate | null;
  reconciliation: PostApplyCanonicalReconciliation | null;
  priority: InventoryVerificationPriority | null;
  sourceErrors: string[];
  spendBefore: PurchaseMonthlySpendPin | null;
  spendAfter: PurchaseMonthlySpendPin | null;
};
export type PurchasePreflightStage = {
  number: number;
  label: string;
  state: "VERIFIED" | "PARTIAL" | "WAITING" | "BLOCKED" | "LOCKED";
  message: string;
  href: string;
};
export type PurchasePreflightLine = {
  barcode: string;
  name: string;
  quantity: number;
  estimatedCostKrw: number;
  verifiedUnitCostKrw: number;
  /**
   * Backward-compatible alias for the effective verified unit cost.
   * New consumers should use verifiedUnitCostKrw + costEvidenceSource because
   * Stage 7 may use purchase-only evidence that is not a confirmed receipt.
   */
  confirmedUnitCostKrw: number;
  costEvidenceSource: string;
  inventoryQuantity: number;
  openCommitment: number;
  costEvidenceAt: string | null;
};
export type PurchaseCyclePreflightReport = {
  mode: "LIVE_READ_ONLY";
  generatedAt: string;
  targetDate: string;
  targetCycleMonth: string;
  requiredBudgetMonth: string;
  dateState: "BEFORE_TARGET" | "ON_TARGET" | "TARGET_PASSED";
  state: "BLOCKED" | "PREVIEW_ONLY" | "AWAITING_OWNER_REVIEW";
  sourceFingerprint: string;
  planFingerprint: string;
  candidateRequestId: string | null;
  sourceAnalysisAsOf: string | null;
  sourceCycleMonth: string | null;
  sourceBudgetMonth: string | null;
  cashLimitKrw: number | null;
  effectiveBudgetKrw: number;
  recordedCycleSpendKrw: number | null;
  remainingMonthlyCashKrw: number;
  effectiveCashKrw: number;
  purchaseCostMultiplier: number | null;
  estimatedAllInSpendKrw: number;
  estimatedSpendKrw: number;
  remainingPreviewBudgetKrw: number;
  previewReady: boolean;
  comparisonAvailable: boolean;
  comparable: boolean;
  comparisonMessage: string;
  stages: PurchasePreflightStage[];
  blockers: string[];
  reviewBlockers: string[];
  excluded: Array<{ barcode: string; reasons: string[] }>;
  eligibleCount: number;
  selected: PurchasePreflightLine[];
  businessWritesEnabled: false;
  approvalEnabled: false;
  actualPurchaseExecuted: false;
  scheduledExecution: false;
};

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const REPORT_MAX_AGE_MS = 15 * 60 * 1000;
const FP = /^sha256:[a-f0-9]{64}$/;
const CODE = /^B[A-Z]{2}\d+-\d+$/;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const hash = (v: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(v)).digest("hex")}`;
const fingerprint = (v: unknown): v is string => typeof v === "string" && FP.test(v);

export function validPurchaseTargetDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validatePurchasePreflightOptions(options: PurchasePreflightOptions) {
  if (!validPurchaseTargetDate(options.targetDate)) throw new Error("TARGET_DATE_INVALID");
  if (options.cashLimitKrw !== null && !positive(options.cashLimitKrw)) throw new Error("CASH_LIMIT_INVALID");
  if (!positive(options.maxSkus) || options.maxSkus > 10) throw new Error("CANARY_SKU_LIMIT_INVALID");
  if (!positive(options.maxUnitsPerSku) || options.maxUnitsPerSku > 9999) throw new Error("CANARY_UNIT_LIMIT_INVALID");
}
function validPin(pin: PurchaseCandidatePin | null): pin is PurchaseCandidatePin {
  return Boolean(pin && pin.requestId.trim() && Number.isFinite(Date.parse(pin.analysisAsOf)) &&
    [pin.planFingerprint, pin.eventFingerprint, pin.planningContentFingerprint].every(fingerprint));
}
export function samePurchaseCandidatePin(a: PurchaseCandidatePin | null, b: PurchaseCandidatePin | null) {
  return validPin(a) && validPin(b) && a.requestId === b.requestId &&
    a.analysisAsOf === b.analysisAsOf && a.planFingerprint === b.planFingerprint &&
    a.eventFingerprint === b.eventFingerprint && a.planningContentFingerprint === b.planningContentFingerprint;
}
function fresh(value: string | null | undefined, now: number, maxAge: number) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= now && now - time <= maxAge;
}
function purchaseCostSource(row: InventoryVerificationPriorityRow) {
  return row.purchaseCostTrustSource ??
    (row.hasConfirmedReceiptCost ? "CONFIRMED_RECEIPT" : "UNVERIFIED");
}
function purchaseCostAt(row: InventoryVerificationPriorityRow) {
  return row.verifiedPurchaseCostAt ?? row.latestConfirmedReceiptAt;
}
function verifiedUnitCost(row: InventoryVerificationPriorityRow) {
  const unit = positive(row.verifiedPurchaseUnitCostKrw)
    ? row.verifiedPurchaseUnitCostKrw
    : row.hasConfirmedReceiptCost && positive(row.latestConfirmedReceiptCostKrw)
      ? row.latestConfirmedReceiptCostKrw
      : 0;
  const protectedCost = nonnegative(row.purchaseProtectedCostKrw)
    ? row.purchaseProtectedCostKrw
    : nonnegative(row.protectedCostKrw)
      ? row.protectedCostKrw
      : 0;
  if (!positive(unit)) return 0;
  return Math.max(unit, protectedCost);
}
function verifiedLineCost(row: InventoryVerificationPriorityRow) {
  const value = verifiedUnitCost(row) * row.recommendedQty;
  return positive(value) ? value : 0;
}
function costReady(row: InventoryVerificationPriorityRow, now: number) {
  const at = purchaseCostAt(row);
  const time = at ? Date.parse(at) : NaN;
  const verified =
    row.hasVerifiedPurchaseCost === true ||
    (row.hasVerifiedPurchaseCost === undefined &&
      row.hasConfirmedReceiptCost === true);
  const source = purchaseCostSource(row);
  return (
    verified &&
    source !== "UNVERIFIED" &&
    positive(verifiedUnitCost(row)) &&
    Number.isFinite(time) &&
    time <= now &&
    positive(verifiedLineCost(row))
  );
}
function inventoryReady(row: InventoryVerificationPriorityRow) {
  return row.inventoryMode === "VERIFIED" && row.inventoryVerified === true &&
    row.executionInventoryEligible === true && row.inventoryCalculationUsable === true &&
    row.inventoryRequiresReview === false && row.initialZeroUnverified === false &&
    row.advisoryOnly === false && nonnegative(row.inventoryQuantity) && nonnegative(row.openCommitment);
}
function projectedLine(row: InventoryVerificationPriorityRow): PurchasePreflightLine {
  const unitCost = verifiedUnitCost(row);
  return {
    barcode: row.barcode,
    name: row.name,
    quantity: row.recommendedQty,
    estimatedCostKrw: verifiedLineCost(row),
    verifiedUnitCostKrw: unitCost,
    confirmedUnitCostKrw: unitCost,
    costEvidenceSource: purchaseCostSource(row),
    inventoryQuantity: row.inventoryQuantity,
    openCommitment: row.openCommitment,
    costEvidenceAt: purchaseCostAt(row),
  };
}

export function buildPurchaseCyclePreflight(input: PurchasePreflightInput): PurchaseCyclePreflightReport {
  validatePurchasePreflightOptions(input.options);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("PREFLIGHT_TIME_INVALID");
  const { targetDate, cashLimitKrw, maxSkus, maxUnitsPerSku } = input.options;
  const targetCycleMonth = targetDate.slice(0, 7);
  const [year, month] = targetCycleMonth.split("-").map(Number);
  const requiredBudgetMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const todaySeoul = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateState = todaySeoul < targetDate ? "BEFORE_TARGET" : todaySeoul === targetDate ? "ON_TARGET" : "TARGET_PASSED";
  const pin = input.before;
  const source = input.priority?.source;
  const gate = input.gate;
  const rec = input.reconciliation;
  const blockers = [...input.sourceErrors];
  const reviewBlockers: string[] = [];
  const stable = samePurchaseCandidatePin(pin, input.after);
  if (!stable) blockers.push("SOURCE_CHANGED_OR_MISSING");
  const sourceFresh = validPin(pin) && fresh(pin.analysisAsOf, now, MAX_AGE_MS);
  if (!sourceFresh) blockers.push("SALES_SOURCE_STALE_OR_FUTURE");

  const fullReadback = Boolean(validPin(pin) && rec?.state === "READY" && rec.ready === true &&
    rec.fullApplyVerified === true && fingerprint(rec.reconciliationFingerprint) &&
    fingerprint(rec.persistedContentFingerprint) && rec.checks.length > 0 && rec.checks.every(c => c.passed === true) &&
    rec.candidateSalesRequestId === pin.requestId && rec.analysisAsOf === pin.analysisAsOf &&
    rec.candidatePlanFingerprint === pin.planFingerprint && rec.candidateEventFingerprint === pin.eventFingerprint &&
    fresh(rec.generatedAt, now, REPORT_MAX_AGE_MS));
  const gateVerified = Boolean(validPin(pin) && gate?.safeToApply === true &&
    ["EXACT_MATCH", "SAFE_CANONICAL_SUPERSET"].includes(gate.state) && fingerprint(gate.promotionFingerprint) &&
    gate.checks.length > 0 && gate.checks.every(c => c.passed === true) &&
    gate.candidateSalesRequestId === pin.requestId && gate.candidatePlanFingerprint === pin.planFingerprint &&
    gate.candidateEventFingerprint === pin.eventFingerprint && fresh(gate.generatedAt, now, REPORT_MAX_AGE_MS));
  // COMPLETED is not a new canary state. A verified full readback is recorded as
  // historical completion, never converted to a fresh publication permission.
  const salesVerified = stable && (gateVerified || fullReadback);
  if (!salesVerified) blockers.push("SALES_PROMOTION_NOT_VERIFIED");
  if (!fullReadback) blockers.push("PRODUCT_MASTER_FULL_READBACK_REQUIRED");
  const contextMatch = Boolean(validPin(pin) && source && rec &&
    source.analysisAsOf === pin.analysisAsOf &&
    source.planningContentFingerprint === pin.planningContentFingerprint &&
    source.shadowPlanningContentFingerprint === pin.planningContentFingerprint &&
    fingerprint(source.canonicalContentFingerprint) &&
    source.canonicalContentFingerprint === rec.persistedContentFingerprint &&
    fingerprint(source.reconciliationFingerprint) &&
    source.reconciliationFingerprint === rec.reconciliationFingerprint);
  if (!contextMatch) blockers.push("PURCHASE_SOURCE_CONTEXT_MISMATCH");
  const shadowReady = input.priority?.state === "READY" && input.priority.purchaseShadowReady === true &&
    input.priority.writesEnabled === false && fresh(input.priority.generatedAt, now, REPORT_MAX_AGE_MS);
  if (!shadowReady) blockers.push("PURCHASE_SHADOW_NOT_READY");
  const inventoryFresh = fresh(source?.inventoryGeneratedAt, now, REPORT_MAX_AGE_MS) &&
    fingerprint(source?.inventoryContentFingerprint);
  if (!inventoryFresh) blockers.push("INVENTORY_EVIDENCE_STALE_OR_UNPINNED");
  if (source?.cycleMonth !== targetCycleMonth || source?.budgetMonth !== requiredBudgetMonth) {
    blockers.push("TARGET_CYCLE_RECALCULATION_REQUIRED");
  }
  // A future (not closed) calendar month must never be treated as final funding.
  if (todaySeoul.slice(0, 7) <= requiredBudgetMonth) blockers.push("BUDGET_MONTH_NOT_CLOSED");
  if (cashLimitKrw === null) blockers.push("OWNER_CASH_LIMIT_REQUIRED");
  if (!positive(source?.budgetKrw)) blockers.push("MONTHLY_BUDGET_NOT_VERIFIED");
  const spendValid = (value: PurchaseMonthlySpendPin | null): value is PurchaseMonthlySpendPin => Boolean(
    value && value.cycleMonth === targetCycleMonth && nonnegative(value.recordedSpendKrw) &&
    fingerprint(value.contentFingerprint) && fresh(value.readAt, now, REPORT_MAX_AGE_MS),
  );
  const spendStable = spendValid(input.spendBefore) && spendValid(input.spendAfter) &&
    input.spendBefore.recordedSpendKrw === input.spendAfter.recordedSpendKrw &&
    input.spendBefore.contentFingerprint === input.spendAfter.contentFingerprint;
  if (!spendStable) blockers.push("CYCLE_SPEND_CHANGED_OR_UNVERIFIED");
  const recordedCycleSpendKrw = spendStable && input.spendAfter ? input.spendAfter.recordedSpendKrw : null;
  const multiplier = source?.purchaseCostMultiplier;
  const multiplierValid = typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier >= 1 && multiplier <= 3;
  const fundingValid = positive(source?.grossBudgetKrw) && multiplierValid;
  if (!fundingValid) blockers.push("GROSS_FUNDING_BASIS_UNVERIFIED");
  const remainingMonthlyCashKrw = fundingValid && recordedCycleSpendKrw !== null
    ? Math.max(0, source.grossBudgetKrw! - recordedCycleSpendKrw) : 0;
  const effectiveCashKrw = positive(cashLimitKrw) ? Math.min(cashLimitKrw, remainingMonthlyCashKrw) : 0;
  // The cash ceiling includes freight reserve; line amounts are product costs.
  // Subtract recorded spend first, then reserve the existing policy multiplier.
  const effectiveBudgetKrw = fundingValid && positive(source?.budgetKrw)
    ? Math.min(source.budgetKrw, Math.floor(effectiveCashKrw / multiplier!)) : 0;
  const comparable = source?.comparisonAvailable === true && source.sameAnalysisAsOf === true;
  if (!comparable) reviewBlockers.push("SAME_TIME_LEGACY_COMPARISON_REQUIRED");
  for (const key of source?.blockerKeys ?? []) reviewBlockers.push(`UPSTREAM:${key}`);
  if (dateState !== "ON_TARGET") reviewBlockers.push(dateState === "BEFORE_TARGET" ? "OWNER_REVIEW_ON_TARGET_DATE" : "TARGET_DATE_RECONFIRM_REQUIRED");

  const rows = [...(input.priority?.rows ?? [])].sort((a, b) => a.barcode.localeCompare(b.barcode));
  const duplicates = new Set(rows.filter((row, i) => i > 0 && rows[i - 1].barcode === row.barcode).map(row => row.barcode));
  if (duplicates.size) blockers.push("DUPLICATE_BARCODE");
  const candidates = rows.filter(row => row.purchaseStatus === "발주 추천");
  const excluded: PurchaseCyclePreflightReport["excluded"] = [];
  const eligible: InventoryVerificationPriorityRow[] = [];
  for (const row of candidates) {
    const reasons: string[] = [];
    if (!CODE.test(row.barcode) || duplicates.has(row.barcode)) reasons.push("IDENTITY_REVIEW");
    if (!costReady(row, now)) reasons.push("CONFIRMED_COST_REQUIRED");
    if (!inventoryReady(row)) reasons.push("VERIFIED_INVENTORY_REQUIRED");
    if (!positive(row.recommendedQty) || !nonnegative(row.priorityScore)) reasons.push("INVALID_RECOMMENDATION");
    if (row.recommendedQty > maxUnitsPerSku) reasons.push("CANARY_QUANTITY_LIMIT");
    if (row.action !== "NONE" || row.operationallyReady !== true) reasons.push("ROW_EXECUTION_BLOCKED");
    if (reasons.length) excluded.push({ barcode: row.barcode, reasons }); else eligible.push(row);
  }
  eligible.sort((a, b) => b.priorityScore - a.priorityScore || verifiedLineCost(a) - verifiedLineCost(b) || a.barcode.localeCompare(b.barcode));
  const selected: PurchasePreflightLine[] = [];
  let estimatedSpendKrw = 0;
  // Never scale or round the engine's MOQ/carton-aware quantity to squeeze it
  // into a canary budget; skip whole lines that exceed the explicit limits.
  if (blockers.length === 0) {
    for (const row of eligible) {
      if (selected.length >= maxSkus) { excluded.push({ barcode: row.barcode, reasons: ["CANARY_SKU_LIMIT"] }); continue; }
      if (verifiedLineCost(row) > effectiveBudgetKrw - estimatedSpendKrw) {
        excluded.push({ barcode: row.barcode, reasons: ["CASH_BUDGET_LIMIT"] }); continue;
      }
      selected.push(projectedLine(row)); estimatedSpendKrw += verifiedLineCost(row);
    }
    if (selected.length === 0) blockers.push("NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  }
  const sourceFingerprint = hash({
    before: pin, after: input.after, stable,
    validity: { sourceFresh, shadowReady, contextMatch, fullReadback, salesVerified, inventoryFresh, spendStable },
    spend: input.spendAfter ? { cycleMonth: input.spendAfter.cycleMonth, amount: input.spendAfter.recordedSpendKrw, fingerprint: input.spendAfter.contentFingerprint } : null,
    gate: gate ? { state: gate.state, safe: gate.safeToApply, checks: gate.checks, fingerprint: gate.promotionFingerprint } : null,
    reconciliation: rec ? { state: rec.state, ready: rec.ready, full: rec.fullApplyVerified, checks: rec.checks, fingerprint: rec.reconciliationFingerprint } : null,
    source: source ?? null,
    priorityState: input.priority?.state ?? null,
    // Include every eligibility input, not only selected quantities. A new cost,
    // commitment, baseline, or blocked row must invalidate the preparation.
    rows,
    sourceErrors: [...input.sourceErrors].sort(),
  });
  const previewReady = blockers.length === 0 && selected.length > 0;
  const stage = (number: number, label: string, state: PurchasePreflightStage["state"], message: string, href: string): PurchasePreflightStage => ({ number, label, state, message, href });
  const coverage = (readyCount: number): PurchasePreflightStage["state"] =>
    candidates.length === 0 ? "WAITING" : readyCount === candidates.length ? "VERIFIED" : readyCount > 0 ? "PARTIAL" : "BLOCKED";
  const stages = [
    stage(5, "공식 판매원장 게이트", salesVerified ? "VERIFIED" : "BLOCKED", fullReadback ? "동일 후보의 검증된 공식 반영 이력이 있습니다. 새 쓰기 권한은 발급하지 않습니다." : gate?.message ?? "후보 승인 검증을 기다립니다.", "/stage8-candidate-promotion-gate"),
    stage(6, "Product Master 반영·재조회", fullReadback && stable ? "VERIFIED" : "WAITING", rec?.message ?? "1건 카나리·전수 반영 후 재조회 검증이 필요합니다.", "/stage8-postapply-canonical-reconciliation"),
    stage(7, "발주 후보 원가 근거", inventoryFresh ? coverage(candidates.filter(row => costReady(row, now)).length) : "BLOCKED", `검증원가 ${candidates.filter(row => costReady(row, now)).length}/${candidates.length}개. 확정입고 또는 A등급 구매전용 근거만 허용하며 캐시·추정값은 승격하지 않습니다.`, "/stage7-purchase-cost-evidence"),
    stage(8, "발주 후보 재고 근거", inventoryFresh ? coverage(candidates.filter(inventoryReady).length) : "BLOCKED", `확인재고 ${candidates.filter(inventoryReady).length}/${candidates.length}개. 미확인·초기 0 재고는 제외하며 전수 실사를 요구하지 않습니다.`, "/stage8-inventory-verification-priority"),
    stage(9, "발주 Shadow·원본 일치", shadowReady && contextMatch && stable && fullReadback && sourceFresh && inventoryFresh ? "VERIFIED" : "BLOCKED", "판매·재고·미입고가 연결된 읽기 전용 계산입니다. 보조신호 등 남은 조건은 승인 검토 차단 사유로 별도 표시합니다.", "/stage8-canonical-purchase-shadow"),
    stage(10, "예산 내 소량 발주안", previewReady ? "VERIFIED" : "WAITING", previewReady ? "금액·품목·수량이 고정된 미리보기입니다. 승인·예약·주문은 생성되지 않았습니다." : "목표 월의 최신 데이터와 현금 상한을 확인한 뒤 계산합니다.", "/purchase-cycle-preflight"),
    stage(11, "실제 주문→입고 검증", "LOCKED", "지정일에도 자동으로 열리지 않습니다. 별도 최종 승인과 기존 실행 경로의 재검증 후 실제 입고까지 확인해야 합니다.", "/fast-purchase-mvp"),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueReview = [...new Set(reviewBlockers)];
  return {
    mode: "LIVE_READ_ONLY", generatedAt: input.now, targetDate, targetCycleMonth, requiredBudgetMonth, dateState,
    state: !previewReady ? "BLOCKED" : uniqueReview.length ? "PREVIEW_ONLY" : "AWAITING_OWNER_REVIEW",
    sourceFingerprint, planFingerprint: hash({ sourceFingerprint, options: input.options, selected }),
    candidateRequestId: pin?.requestId ?? null, sourceAnalysisAsOf: pin?.analysisAsOf ?? null,
    sourceCycleMonth: source?.cycleMonth ?? null, sourceBudgetMonth: source?.budgetMonth ?? null,
    cashLimitKrw, effectiveBudgetKrw, estimatedSpendKrw, remainingPreviewBudgetKrw: effectiveBudgetKrw - estimatedSpendKrw,
    recordedCycleSpendKrw, remainingMonthlyCashKrw, effectiveCashKrw,
    purchaseCostMultiplier: multiplierValid ? multiplier! : null,
    estimatedAllInSpendKrw: multiplierValid ? Math.ceil(estimatedSpendKrw * multiplier!) : 0,
    previewReady, comparisonAvailable: source?.comparisonAvailable === true, comparable,
    comparisonMessage: comparable ? "동일 분석시점의 기존 방식 비교가 있습니다. 실제 승인 전 차이를 검토하세요." : "기존 비교가 없거나 분석시점이 달라 동일 조건 비교로 인정하지 않습니다.",
    stages, blockers: uniqueBlockers, reviewBlockers: uniqueReview, excluded, eligibleCount: eligible.length, selected,
    businessWritesEnabled: false, approvalEnabled: false, actualPurchaseExecuted: false, scheduledExecution: false,
  };
}

export type PurchasePreflightReaders = {
  candidate: () => Promise<PurchaseCandidatePin>;
  gate: () => Promise<CandidatePromotionGate>;
  reconciliation: () => Promise<PostApplyCanonicalReconciliation>;
  priority: () => Promise<InventoryVerificationPriority>;
  monthlySpend: (cycleMonth: string) => Promise<PurchaseMonthlySpendPin>;
};

// The actual orchestration is injectable so CI exercises failure/drift and
// call-count behavior without production credentials or a fabricated DB.
export async function readPurchaseCyclePreflight(
  options: PurchasePreflightOptions,
  readers: PurchasePreflightReaders,
  clock: () => string,
) {
  validatePurchasePreflightOptions(options);
  const sourceErrors: string[] = [];
  const capture = async <T>(code: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch { sourceErrors.push(code); return null; }
  };
  const [before, spendBefore] = await Promise.all([
    capture("CANDIDATE_READ_FAILED", readers.candidate),
    capture("CYCLE_SPEND_READ_FAILED", () => readers.monthlySpend(options.targetDate.slice(0, 7))),
  ]);
  const [gate, reconciliation, priority] = await Promise.all([
    capture("PROMOTION_GATE_READ_FAILED", readers.gate),
    capture("MASTER_READBACK_READ_FAILED", readers.reconciliation),
    capture("INVENTORY_PRIORITY_READ_FAILED", readers.priority),
  ]);
  const [after, spendAfter] = await Promise.all([
    capture("CANDIDATE_RECHECK_FAILED", readers.candidate),
    capture("CYCLE_SPEND_RECHECK_FAILED", () => readers.monthlySpend(options.targetDate.slice(0, 7))),
  ]);
  return buildPurchaseCyclePreflight({ now: clock(), options, before, after, gate, reconciliation, priority, sourceErrors, spendBefore, spendAfter });
}
