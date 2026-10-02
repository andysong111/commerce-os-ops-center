import { createHash } from "node:crypto";
import type { CandidatePromotionGate } from "./stage8CandidatePromotionGate";
import type { PostApplyCanonicalReconciliation } from "./stage8PostApplyCanonicalReconciliation";
import type { InventoryVerificationPriority, InventoryVerificationPriorityRow } from "./stage8InventoryVerificationPriority";
import type { PurchaseWholesaleCostEstimateSnapshot } from "./purchaseWholesaleCostEstimate";
import {
  validPurchaseOwnerCostEstimateSnapshot,
  type PurchaseOwnerCostEstimateSnapshot,
  type PurchaseOwnerCostEstimateSource,
} from "./purchaseCycleOwnerCostEstimate.ts";
import {
  effectivePurchaseUnitCostKrw,
  purchaseCostEvidenceAt,
  purchaseCostEvidenceSource,
  purchaseCostReadyForExecution,
} from "./verifiedPurchaseCostEvidence.ts";

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
  allowOpenBudgetPreview?: boolean;
  replaceDraftId?: string | null;
};
export type PurchaseMonthlySpendPin = {
  cycleMonth: string;
  readAt: string;
  recordedSpendKrw: number;
  contentFingerprint: string;
};
export type PurchaseReplacementDraftLine = {
  barcode: string;
  name: string;
  quantity: number;
};
export type PurchaseReplacementDraftSnapshot = {
  draftId: string;
  readAt: string;
  contentFingerprint: string;
  lines: PurchaseReplacementDraftLine[];
};
export type PurchaseReplacementDraftAudit = {
  previousLineCount: number;
  selectedLineCount: number;
  matchedCount: number;
  added: PurchaseReplacementDraftLine[];
  removed: Array<PurchaseReplacementDraftLine & { reasons: string[] }>;
  quantityChanged: Array<{
    barcode: string;
    name: string;
    previousQuantity: number;
    selectedQuantity: number;
  }>;
  complete: boolean;
};
export type PurchasePreflightInput = {
  now: string;
  options: PurchasePreflightOptions;
  before: PurchaseCandidatePin | null;
  after: PurchaseCandidatePin | null;
  gate: CandidatePromotionGate | null;
  reconciliation: PostApplyCanonicalReconciliation | null;
  priority: InventoryVerificationPriority | null;
  wholesaleCosts?: PurchaseWholesaleCostEstimateSnapshot | null;
  ownerCosts?: PurchaseOwnerCostEstimateSnapshot | null;
  costEstimateErrors?: string[];
  sourceErrors: string[];
  spendBefore: PurchaseMonthlySpendPin | null;
  spendAfter: PurchaseMonthlySpendPin | null;
  replacementBefore?: PurchaseReplacementDraftSnapshot | null;
  replacementAfter?: PurchaseReplacementDraftSnapshot | null;
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
  confirmedUnitCostKrw: number;
  estimatedUnitCostKrw: number;
  costBasis: "VERIFIED_PURCHASE_COST" | "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE" | PurchaseOwnerCostEstimateSource;
  costModelNo: string | null;
  costReferenceModelNo: string | null;
  executionCostVerified: boolean;
  costEvidenceSource: string;
  inventoryQuantity: number;
  inventoryMode: "VERIFIED" | "PROVISIONAL";
  inventoryVerified: boolean;
  advisoryOnly: boolean;
  openCommitment: number;
  costEvidenceAt: string | null;
};
export type PurchaseCyclePreflightReport = {
  mode: "LIVE_READ_ONLY";
  generatedAt: string;
  targetDate: string;
  replacementDraftId: string | null;
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
  automaticGrossBudgetKrw: number | null;
  effectiveBudgetKrw: number;
  recordedCycleSpendKrw: number | null;
  remainingMonthlyCashKrw: number;
  effectiveCashKrw: number;
  purchaseCostMultiplier: number | null;
  estimatedAllInSpendKrw: number;
  estimatedSpendKrw: number;
  wholesaleEstimatedSelectedCount: number;
  ownerEstimatedSelectedCount: number;
  missingCostCount: number;
  remainingPreviewBudgetKrw: number;
  previewReady: boolean;
  comparisonAvailable: boolean;
  comparable: boolean;
  comparisonMessage: string;
  stages: PurchasePreflightStage[];
  blockers: string[];
  reviewBlockers: string[];
  excluded: Array<{ barcode: string; reasons: string[] }>;
  candidateCount: number;
  accountedCandidateCount: number;
  candidateCoverageComplete: boolean;
  eligibleCount: number;
  selected: PurchasePreflightLine[];
  replacementAudit: PurchaseReplacementDraftAudit | null;
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

export function buildPurchaseReplacementDraftSnapshot(
  draftId: string,
  readAt: string,
  lines: PurchaseReplacementDraftLine[],
): PurchaseReplacementDraftSnapshot {
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId) || !Number.isFinite(Date.parse(readAt))) {
    throw new Error("REPLACEMENT_DRAFT_SNAPSHOT_INVALID");
  }
  const normalized = lines
    .map((line) => ({ barcode: line.barcode.trim().toUpperCase(), name: line.name.trim(), quantity: line.quantity }))
    .sort((a, b) => a.barcode.localeCompare(b.barcode));
  if (
    normalized.length === 0 ||
    normalized.some((line, index) => !CODE.test(line.barcode) || !positive(line.quantity) || (index > 0 && normalized[index - 1].barcode === line.barcode))
  ) {
    throw new Error("REPLACEMENT_DRAFT_SNAPSHOT_INVALID");
  }
  return {
    draftId,
    readAt,
    contentFingerprint: hash({ draftId, lines: normalized }),
    lines: normalized,
  };
}

function validReplacementDraftSnapshot(
  value: PurchaseReplacementDraftSnapshot | null | undefined,
  draftId: string,
) {
  if (!value || value.draftId !== draftId || !fingerprint(value.contentFingerprint) || !Number.isFinite(Date.parse(value.readAt))) return false;
  try {
    return buildPurchaseReplacementDraftSnapshot(value.draftId, value.readAt, value.lines).contentFingerprint === value.contentFingerprint;
  } catch {
    return false;
  }
}

export function validPurchaseTargetDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validatePurchasePreflightOptions(options: PurchasePreflightOptions) {
  if (!validPurchaseTargetDate(options.targetDate)) throw new Error("TARGET_DATE_INVALID");
  if (
    options.replaceDraftId &&
    !/^fast-purchase-draft:[a-f0-9]{20}$/.test(options.replaceDraftId)
  ) {
    throw new Error("REPLACEMENT_DRAFT_ID_INVALID");
  }
  if (options.cashLimitKrw !== null && !positive(options.cashLimitKrw)) throw new Error("CASH_LIMIT_INVALID");
  if (!positive(options.maxSkus) || options.maxSkus > 100) throw new Error("PURCHASE_SKU_LIMIT_INVALID");
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
function verifiedUnitCost(row: InventoryVerificationPriorityRow, now: number) {
  return effectivePurchaseUnitCostKrw(row, now);
}
type PurchaseCostBasis = {
  unitCostKrw: number;
  basis: PurchasePreflightLine["costBasis"];
  source: string;
  evidenceAt: string | null;
  executionVerified: boolean;
  modelNo: string | null;
  referenceModelNo: string | null;
};

function purchaseCostBasis(
  row: InventoryVerificationPriorityRow,
  now: number,
  wholesaleByBarcode: Map<string, PurchaseCostBasis>,
  ownerByBarcode: Map<string, PurchaseCostBasis>,
): PurchaseCostBasis | null {
  if (purchaseCostReadyForExecution(row, now)) {
    const unitCostKrw = verifiedUnitCost(row, now);
    if (positive(unitCostKrw)) {
      return {
        unitCostKrw,
        basis: "VERIFIED_PURCHASE_COST",
        source: purchaseCostEvidenceSource(row),
        evidenceAt: purchaseCostEvidenceAt(row),
        executionVerified: true,
        modelNo: null,
        referenceModelNo: null,
      };
    }
  }
  return wholesaleByBarcode.get(row.barcode) ?? ownerByBarcode.get(row.barcode) ?? null;
}

function lineCost(row: InventoryVerificationPriorityRow, basis: PurchaseCostBasis | null) {
  const value = (basis?.unitCostKrw ?? 0) * row.recommendedQty;
  return positive(value) ? value : 0;
}
function verifiedInventoryReady(row: InventoryVerificationPriorityRow) {
  return row.inventoryMode === "VERIFIED" && row.inventoryVerified === true &&
    row.executionInventoryEligible === true && row.inventoryCalculationUsable === true &&
    row.inventoryRequiresReview === false && row.initialZeroUnverified === false &&
    row.advisoryOnly === false && nonnegative(row.inventoryQuantity) && nonnegative(row.openCommitment);
}
function provisionalInventoryReady(row: InventoryVerificationPriorityRow) {
  return row.inventoryMode === "PROVISIONAL" && row.inventoryVerified === false &&
    row.executionInventoryEligible === false && row.inventoryCalculationUsable === true &&
    row.inventoryRequiresReview === false && row.advisoryOnly === true &&
    row.action === "PROVISIONAL_DECISION_EVIDENCE_REQUIRED" &&
    nonnegative(row.inventoryQuantity) && nonnegative(row.openCommitment);
}
function inventoryPreviewReady(row: InventoryVerificationPriorityRow) {
  return verifiedInventoryReady(row) || provisionalInventoryReady(row);
}
function projectedLine(row: InventoryVerificationPriorityRow, basis: PurchaseCostBasis): PurchasePreflightLine {
  const unitCost = basis.unitCostKrw;
  return {
    barcode: row.barcode, name: row.name, quantity: row.recommendedQty,
    estimatedCostKrw: lineCost(row, basis),
    verifiedUnitCostKrw: basis.executionVerified ? unitCost : 0,
    confirmedUnitCostKrw: basis.executionVerified ? unitCost : 0,
    estimatedUnitCostKrw: unitCost,
    costBasis: basis.basis,
    costModelNo: basis.modelNo,
    costReferenceModelNo: basis.referenceModelNo,
    executionCostVerified: basis.executionVerified,
    costEvidenceSource: basis.source,
    inventoryQuantity: row.inventoryQuantity,
    inventoryMode: row.inventoryMode === "VERIFIED" ? "VERIFIED" : "PROVISIONAL",
    inventoryVerified: row.inventoryVerified,
    advisoryOnly: row.advisoryOnly,
    openCommitment: row.openCommitment,
    costEvidenceAt: basis.evidenceAt,
  };
}

function stablePlanLine({ costEvidenceAt, ...line }: PurchasePreflightLine) {
  void costEvidenceAt;
  return line;
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
  const replacementDraftId = input.options.replaceDraftId ?? null;
  const replacementStable = replacementDraftId === null || (
    validReplacementDraftSnapshot(input.replacementBefore, replacementDraftId) &&
    validReplacementDraftSnapshot(input.replacementAfter, replacementDraftId) &&
    input.replacementBefore!.contentFingerprint === input.replacementAfter!.contentFingerprint
  );
  if (!replacementStable) blockers.push("REPLACEMENT_DRAFT_CHANGED_OR_UNVERIFIED");
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
  // An owner-authorized early preview can inspect the current month-to-date
  // basis, but it remains non-binding and must be refreshed after month close.
  const budgetMonthClosed = todaySeoul.slice(0, 7) > requiredBudgetMonth;
  if (!budgetMonthClosed) {
    if (input.options.allowOpenBudgetPreview === true) {
      reviewBlockers.push("OPEN_BUDGET_EARLY_PREVIEW_RECHECK_REQUIRED");
    } else {
      blockers.push("BUDGET_MONTH_NOT_CLOSED");
    }
  }
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
  const effectiveCashKrw = positive(cashLimitKrw)
    ? Math.min(cashLimitKrw, remainingMonthlyCashKrw)
    : remainingMonthlyCashKrw;
  // The cash ceiling includes freight reserve; line amounts are product costs.
  // Subtract recorded spend first, then reserve the existing policy multiplier.
  const effectiveBudgetKrw = fundingValid && positive(source?.budgetKrw)
    ? Math.min(source.budgetKrw, Math.floor(effectiveCashKrw / multiplier!)) : 0;
  const comparable = source?.comparisonAvailable === true && source.sameAnalysisAsOf === true;
  if (!comparable) reviewBlockers.push("SAME_TIME_LEGACY_COMPARISON_REQUIRED");
  for (const key of source?.blockerKeys ?? []) reviewBlockers.push(`UPSTREAM:${key}`);
  if (dateState !== "ON_TARGET") reviewBlockers.push(dateState === "BEFORE_TARGET" ? "OWNER_REVIEW_ON_TARGET_DATE" : "TARGET_DATE_RECONFIRM_REQUIRED");

  const wholesaleSnapshot = input.wholesaleCosts ?? null;
  const wholesaleSnapshotUsable = Boolean(
    wholesaleSnapshot &&
    wholesaleSnapshot.writesEnabled === false &&
    fingerprint(wholesaleSnapshot.contentFingerprint) &&
    fresh(wholesaleSnapshot.generatedAt, now, REPORT_MAX_AGE_MS) &&
    wholesaleSnapshot.planningContentFingerprint === source?.planningContentFingerprint,
  );
  const wholesaleByBarcode = new Map<string, PurchaseCostBasis>();
  if (wholesaleSnapshotUsable && wholesaleSnapshot) {
    for (const row of wholesaleSnapshot.rows) {
      if (row.state !== "ESTIMATED" || !positive(row.estimatedUnitCostKrw)) continue;
      wholesaleByBarcode.set(row.barcode, {
        unitCostKrw: row.estimatedUnitCostKrw,
        basis: "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE",
        source: row.source,
        evidenceAt: wholesaleSnapshot.generatedAt,
        executionVerified: false,
        modelNo: null,
        referenceModelNo: null,
      });
    }
  }
  if (wholesaleSnapshot && !wholesaleSnapshotUsable) {
    reviewBlockers.push("WHOLESALE_COST_ESTIMATE_STALE_OR_UNPINNED");
  }
  for (const error of input.costEstimateErrors ?? []) reviewBlockers.push(error);

  const ownerSnapshot = input.ownerCosts ?? null;
  const ownerSnapshotUsable = validPurchaseOwnerCostEstimateSnapshot(ownerSnapshot);
  const ownerByBarcode = new Map<string, PurchaseCostBasis>();
  if (ownerSnapshotUsable && ownerSnapshot) {
    for (const row of ownerSnapshot.rows) {
      ownerByBarcode.set(row.barcode, {
        unitCostKrw: row.estimatedUnitCostKrw,
        basis: row.source,
        source: row.source,
        evidenceAt: row.evidenceAt,
        executionVerified: false,
        modelNo: row.modelNo,
        referenceModelNo: row.referenceModelNo,
      });
    }
  }
  if (ownerSnapshot && !ownerSnapshotUsable) reviewBlockers.push("OWNER_COST_ESTIMATE_INVALID");

  const rows = [...(input.priority?.rows ?? [])].sort((a, b) => a.barcode.localeCompare(b.barcode));
  const duplicates = new Set(rows.filter((row, i) => i > 0 && rows[i - 1].barcode === row.barcode).map(row => row.barcode));
  if (duplicates.size) blockers.push("DUPLICATE_BARCODE");
  const candidates = rows.filter(row => row.purchaseStatus === "발주 추천");
  const costBasisByBarcode = new Map(
    candidates.map((row) => [row.barcode, purchaseCostBasis(row, now, wholesaleByBarcode, ownerByBarcode)] as const),
  );
  const excluded: PurchaseCyclePreflightReport["excluded"] = [];
  const eligible: InventoryVerificationPriorityRow[] = [];
  for (const row of candidates) {
    const reasons: string[] = [];
    if (!CODE.test(row.barcode) || duplicates.has(row.barcode)) reasons.push("IDENTITY_REVIEW");
    const basis = costBasisByBarcode.get(row.barcode) ?? null;
    if (!basis || !positive(lineCost(row, basis))) {
      const estimateRow = wholesaleSnapshot?.rows.find((item) => item.barcode === row.barcode);
      reasons.push(
        wholesaleSnapshotUsable && estimateRow?.reason
          ? estimateRow.reason
          : wholesaleSnapshot
            ? "WHOLESALE_COST_ESTIMATE_UNAVAILABLE"
            : "CONFIRMED_COST_REQUIRED",
      );
    }
    if (!inventoryPreviewReady(row)) reasons.push("VERIFIED_INVENTORY_REQUIRED");
    if (!positive(row.recommendedQty) || !nonnegative(row.priorityScore)) reasons.push("INVALID_RECOMMENDATION");
    if (row.recommendedQty > maxUnitsPerSku) reasons.push("CANARY_QUANTITY_LIMIT");
    const previewPolicyReady = verifiedInventoryReady(row)
      ? basis?.executionVerified === false
        ? row.action === "COST_CONFIRMATION_REQUIRED" && row.operationallyReady === false
        : row.action === "NONE" && row.operationallyReady === true
      : provisionalInventoryReady(row) && row.operationallyReady === false;
    if (!previewPolicyReady) reasons.push("ROW_EXECUTION_BLOCKED");
    if (reasons.length) excluded.push({ barcode: row.barcode, reasons }); else eligible.push(row);
  }
  eligible.sort((a, b) => b.priorityScore - a.priorityScore || lineCost(a, costBasisByBarcode.get(a.barcode) ?? null) - lineCost(b, costBasisByBarcode.get(b.barcode) ?? null) || a.barcode.localeCompare(b.barcode));
  const selected: PurchasePreflightLine[] = [];
  let estimatedSpendKrw = 0;
  const calculationUnblocked = blockers.length === 0;
  // Never scale or round the engine's MOQ/carton-aware quantity to squeeze it
  // into a canary budget; skip whole lines that exceed the explicit limits.
  if (blockers.length === 0) {
    for (const row of eligible) {
      const basis = costBasisByBarcode.get(row.barcode);
      if (!basis) continue;
      if (selected.length >= maxSkus) { excluded.push({ barcode: row.barcode, reasons: ["CANARY_SKU_LIMIT"] }); continue; }
      if (lineCost(row, basis) > effectiveBudgetKrw - estimatedSpendKrw) {
        excluded.push({ barcode: row.barcode, reasons: ["CASH_BUDGET_LIMIT"] }); continue;
      }
      selected.push(projectedLine(row, basis)); estimatedSpendKrw += lineCost(row, basis);
    }
    if (selected.length === 0) blockers.push("NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  }
  const accountedCandidateBarcodes = new Set([
    ...selected.map((row) => row.barcode),
    ...excluded.map((row) => row.barcode),
  ]);
  const candidateCoverageComplete =
    accountedCandidateBarcodes.size === candidates.length &&
    selected.length + excluded.length === candidates.length;
  if (calculationUnblocked && !candidateCoverageComplete) blockers.push("CANDIDATE_COVERAGE_MISMATCH");
  if (selected.some((row) => row.inventoryMode === "PROVISIONAL")) {
    reviewBlockers.push("PROVISIONAL_INVENTORY_OWNER_REVIEW_REQUIRED");
  }
  if (selected.some((row) => row.costBasis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE")) {
    reviewBlockers.push("WHOLESALE_COST_ESTIMATE_OWNER_REVIEW_REQUIRED");
  }
  if (selected.some((row) => row.costBasis === "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE" || row.costBasis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE")) {
    reviewBlockers.push("OWNER_COST_ESTIMATE_REVIEW_REQUIRED");
  }
  let replacementAudit: PurchaseReplacementDraftAudit | null = null;
  if (replacementDraftId && replacementStable && input.replacementAfter) {
    const previousByBarcode = new Map(input.replacementAfter.lines.map((line) => [line.barcode, line]));
    const selectedByBarcode = new Map(selected.map((line) => [line.barcode, line]));
    const matchedBarcodes = [...previousByBarcode.keys()].filter((barcode) => selectedByBarcode.has(barcode));
    const added = selected
      .filter((line) => !previousByBarcode.has(line.barcode))
      .map((line) => ({ barcode: line.barcode, name: line.name, quantity: line.quantity }));
    const removed = input.replacementAfter.lines
      .filter((line) => !selectedByBarcode.has(line.barcode))
      .map((line) => ({
        ...line,
        reasons: excluded.find((item) => item.barcode === line.barcode)?.reasons ?? ["CURRENT_ENGINE_NOT_RECOMMENDED"],
      }));
    const quantityChanged = matchedBarcodes.flatMap((barcode) => {
      const previous = previousByBarcode.get(barcode)!;
      const next = selectedByBarcode.get(barcode)!;
      return previous.quantity === next.quantity ? [] : [{
        barcode,
        name: next.name || previous.name,
        previousQuantity: previous.quantity,
        selectedQuantity: next.quantity,
      }];
    });
    const complete =
      matchedBarcodes.length + removed.length === input.replacementAfter.lines.length &&
      matchedBarcodes.length + added.length === selected.length &&
      new Set([...matchedBarcodes, ...removed.map((line) => line.barcode)]).size === input.replacementAfter.lines.length &&
      new Set([...matchedBarcodes, ...added.map((line) => line.barcode)]).size === selected.length;
    replacementAudit = {
      previousLineCount: input.replacementAfter.lines.length,
      selectedLineCount: selected.length,
      matchedCount: matchedBarcodes.length,
      added,
      removed,
      quantityChanged,
      complete,
    };
    if (!complete) blockers.push("REPLACEMENT_DRAFT_COVERAGE_MISMATCH");
  }
  const sourceEvidence = source ? {
    analysisAsOf: source.analysisAsOf,
    planningContentFingerprint: source.planningContentFingerprint,
    shadowPlanningContentFingerprint: source.shadowPlanningContentFingerprint,
    canonicalContentFingerprint: source.canonicalContentFingerprint,
    reconciliationFingerprint: source.reconciliationFingerprint,
    cycleMonth: source.cycleMonth,
    budgetMonth: source.budgetMonth,
    budgetKrw: source.budgetKrw,
    inventoryContentFingerprint: source.inventoryContentFingerprint,
    grossBudgetKrw: source.grossBudgetKrw,
    purchaseCostMultiplier: source.purchaseCostMultiplier,
    comparisonAvailable: source.comparisonAvailable,
    sameAnalysisAsOf: source.sameAnalysisAsOf,
    blockerKeys: source.blockerKeys,
  } : null;
  const sourceFingerprint = hash({
    before: pin, after: input.after, stable,
    validity: { sourceFresh, shadowReady, contextMatch, fullReadback, salesVerified, inventoryFresh, spendStable, replacementStable },
    spend: input.spendAfter ? { cycleMonth: input.spendAfter.cycleMonth, amount: input.spendAfter.recordedSpendKrw, fingerprint: input.spendAfter.contentFingerprint } : null,
    gate: gate ? { state: gate.state, safe: gate.safeToApply, checks: gate.checks, fingerprint: gate.promotionFingerprint } : null,
    reconciliation: rec ? { state: rec.state, ready: rec.ready, full: rec.fullApplyVerified, checks: rec.checks, fingerprint: rec.reconciliationFingerprint } : null,
    // Freshness still uses inventoryGeneratedAt above. The content pin must stay
    // stable when only the observation time changes between preview and write.
    source: sourceEvidence,
    priorityState: input.priority?.state ?? null,
    // Include every eligibility input, not only selected quantities. A new cost,
    // commitment, baseline, or blocked row must invalidate the preparation.
    rows,
    wholesaleCosts: wholesaleSnapshot ? {
      planningContentFingerprint: wholesaleSnapshot.planningContentFingerprint,
      contentFingerprint: wholesaleSnapshot.contentFingerprint,
      state: wholesaleSnapshot.state,
      rows: wholesaleSnapshot.rows,
    } : null,
    ownerCosts: ownerSnapshotUsable && ownerSnapshot ? {
      contentFingerprint: ownerSnapshot.contentFingerprint,
      rows: ownerSnapshot.rows,
    } : null,
    replacementDraft: input.replacementAfter ? {
      draftId: input.replacementAfter.draftId,
      contentFingerprint: input.replacementAfter.contentFingerprint,
      lines: input.replacementAfter.lines,
    } : null,
    costEstimateErrors: [...(input.costEstimateErrors ?? [])].sort(),
    sourceErrors: [...input.sourceErrors].sort(),
  });
  const previewReady = blockers.length === 0 && selected.length > 0;
  const stage = (number: number, label: string, state: PurchasePreflightStage["state"], message: string, href: string): PurchasePreflightStage => ({ number, label, state, message, href });
  const coverage = (readyCount: number): PurchasePreflightStage["state"] =>
    candidates.length === 0 ? "WAITING" : readyCount === candidates.length ? "VERIFIED" : readyCount > 0 ? "PARTIAL" : "BLOCKED";
  const stages = [
    stage(5, "공식 판매원장 게이트", salesVerified ? "VERIFIED" : "BLOCKED", fullReadback ? "동일 후보의 검증된 공식 반영 이력이 있습니다. 새 쓰기 권한은 발급하지 않습니다." : gate?.message ?? "후보 승인 검증을 기다립니다.", "/stage8-candidate-promotion-gate"),
    stage(6, "Product Master 반영·재조회", fullReadback && stable ? "VERIFIED" : "WAITING", rec?.message ?? "1건 카나리·전수 반영 후 재조회 검증이 필요합니다.", "/stage8-postapply-canonical-reconciliation"),
    stage(7, "발주 후보 원가 근거", inventoryFresh ? coverage(candidates.filter(row => costBasisByBarcode.get(row.barcode)).length) : "BLOCKED", `확정원가 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "VERIFIED_PURCHASE_COST").length}개 · 활성 도매 판매가 추정 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE").length}개 · 사용자 제공 추정 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE" || costBasisByBarcode.get(row.barcode)?.basis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE").length}개 · 미확인 ${candidates.filter(row => !costBasisByBarcode.get(row.barcode)).length}개. 추정값은 초안 예산에만 쓰며 실제 주문 원가로 승격하지 않습니다.`, "/stage7-purchase-cost-evidence"),
    stage(8, "발주 후보 재고 근거", inventoryFresh ? coverage(candidates.filter(inventoryPreviewReady).length) : "BLOCKED", `계획재고 ${candidates.filter(inventoryPreviewReady).length}/${candidates.length}개 · VERIFIED ${candidates.filter(verifiedInventoryReady).length}개 · PROVISIONAL ${candidates.filter(provisionalInventoryReady).length}개. 전수 실사는 요구하지 않으며, 실제 품절 시 SOLD_OUT_RESET=0 이후 중국 확정입고와 판매를 누적합니다.`, "/stage8-inventory-verification-priority"),
    stage(9, "발주 Shadow·원본 일치", shadowReady && contextMatch && stable && fullReadback && sourceFresh && inventoryFresh ? "VERIFIED" : "BLOCKED", "판매·재고·미입고가 연결된 읽기 전용 계산입니다. 보조신호 등 남은 조건은 승인 검토 차단 사유로 별도 표시합니다.", "/stage8-canonical-purchase-shadow"),
    stage(10, "예산 내 소량 발주안", previewReady ? "VERIFIED" : "WAITING", previewReady ? budgetMonthClosed ? "전월 판매원가 자동 한도로 계산한 미리보기입니다. 승인·예약·주문은 생성되지 않았습니다." : "월 마감 전 조기 미리보기입니다. 실제 주문 전에 마감 자료로 다시 계산해야 하며 승인·예약·주문은 생성되지 않았습니다." : "목표 월의 최신 데이터와 전월 판매원가 자동 한도를 확인한 뒤 계산합니다.", "/purchase-cycle-preflight"),
    stage(11, "실제 주문→입고 검증", "LOCKED", "지정일에도 자동으로 열리지 않습니다. 별도 최종 승인과 기존 실행 경로의 재검증 후 실제 입고까지 확인해야 합니다.", "/fast-purchase-mvp"),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueReview = [...new Set(reviewBlockers)];
  return {
    mode: "LIVE_READ_ONLY", generatedAt: input.now, targetDate,
    replacementDraftId,
    targetCycleMonth, requiredBudgetMonth, dateState,
    state: !previewReady ? "BLOCKED" : uniqueReview.length ? "PREVIEW_ONLY" : "AWAITING_OWNER_REVIEW",
    sourceFingerprint,
    planFingerprint: hash({
      sourceFingerprint,
      options: input.options,
      selected: selected.map(stablePlanLine),
    }),
    candidateRequestId: pin?.requestId ?? null, sourceAnalysisAsOf: pin?.analysisAsOf ?? null,
    sourceCycleMonth: source?.cycleMonth ?? null, sourceBudgetMonth: source?.budgetMonth ?? null,
    cashLimitKrw, automaticGrossBudgetKrw: fundingValid ? source!.grossBudgetKrw! : null,
    effectiveBudgetKrw, estimatedSpendKrw, remainingPreviewBudgetKrw: effectiveBudgetKrw - estimatedSpendKrw,
    wholesaleEstimatedSelectedCount: selected.filter((row) => row.costBasis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE").length,
    ownerEstimatedSelectedCount: selected.filter((row) => row.costBasis === "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE" || row.costBasis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE").length,
    missingCostCount: candidates.filter((row) => !costBasisByBarcode.get(row.barcode)).length,
    recordedCycleSpendKrw, remainingMonthlyCashKrw, effectiveCashKrw,
    purchaseCostMultiplier: multiplierValid ? multiplier! : null,
    estimatedAllInSpendKrw: multiplierValid ? Math.ceil(estimatedSpendKrw * multiplier!) : 0,
    previewReady, comparisonAvailable: source?.comparisonAvailable === true, comparable,
    comparisonMessage: comparable ? "동일 분석시점의 기존 방식 비교가 있습니다. 실제 승인 전 차이를 검토하세요." : "기존 비교가 없거나 분석시점이 달라 동일 조건 비교로 인정하지 않습니다.",
    stages, blockers: uniqueBlockers, reviewBlockers: uniqueReview, excluded,
    candidateCount: candidates.length,
    accountedCandidateCount: accountedCandidateBarcodes.size,
    candidateCoverageComplete,
    eligibleCount: eligible.length, selected, replacementAudit,
    businessWritesEnabled: false, approvalEnabled: false, actualPurchaseExecuted: false, scheduledExecution: false,
  };
}

export type PurchasePreflightReaders = {
  candidate: () => Promise<PurchaseCandidatePin>;
  gate: () => Promise<CandidatePromotionGate>;
  reconciliation: () => Promise<PostApplyCanonicalReconciliation>;
  priority: () => Promise<InventoryVerificationPriority>;
  monthlySpend: (cycleMonth: string) => Promise<PurchaseMonthlySpendPin>;
  wholesaleCosts?: () => Promise<PurchaseWholesaleCostEstimateSnapshot>;
  ownerCosts?: () => Promise<PurchaseOwnerCostEstimateSnapshot>;
  replacementDraft?: (draftId: string) => Promise<PurchaseReplacementDraftSnapshot>;
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
  const costEstimateErrors: string[] = [];
  const capture = async <T>(code: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch { sourceErrors.push(code); return null; }
  };
  const replacementRead = options.replaceDraftId && readers.replacementDraft
    ? () => readers.replacementDraft!(options.replaceDraftId!)
    : null;
  const [before, spendBefore, replacementBefore] = await Promise.all([
    capture("CANDIDATE_READ_FAILED", readers.candidate),
    capture("CYCLE_SPEND_READ_FAILED", () => readers.monthlySpend(options.targetDate.slice(0, 7))),
    replacementRead
      ? capture("REPLACEMENT_DRAFT_READ_FAILED", replacementRead)
      : Promise.resolve(null),
  ]);
  if (options.replaceDraftId && !replacementRead) sourceErrors.push("REPLACEMENT_DRAFT_READ_FAILED");
  const [gate, reconciliation, priority] = await Promise.all([
    capture("PROMOTION_GATE_READ_FAILED", readers.gate),
    capture("MASTER_READBACK_READ_FAILED", readers.reconciliation),
    capture("INVENTORY_PRIORITY_READ_FAILED", readers.priority),
  ]);
  let wholesaleCosts: PurchaseWholesaleCostEstimateSnapshot | null = null;
  if (readers.wholesaleCosts) {
    try {
      wholesaleCosts = await readers.wholesaleCosts();
    } catch {
      costEstimateErrors.push("WHOLESALE_COST_ESTIMATE_READ_FAILED");
    }
  }
  let ownerCosts: PurchaseOwnerCostEstimateSnapshot | null = null;
  if (readers.ownerCosts) {
    try {
      ownerCosts = await readers.ownerCosts();
    } catch {
      costEstimateErrors.push("OWNER_COST_ESTIMATE_READ_FAILED");
    }
  }
  const [after, spendAfter, replacementAfter] = await Promise.all([
    capture("CANDIDATE_RECHECK_FAILED", readers.candidate),
    capture("CYCLE_SPEND_RECHECK_FAILED", () => readers.monthlySpend(options.targetDate.slice(0, 7))),
    replacementRead
      ? capture("REPLACEMENT_DRAFT_RECHECK_FAILED", replacementRead)
      : Promise.resolve(null),
  ]);
  return buildPurchaseCyclePreflight({ now: clock(), options, before, after, gate, reconciliation, priority, wholesaleCosts, ownerCosts, costEstimateErrors, sourceErrors, spendBefore, spendAfter, replacementBefore, replacementAfter });
}
