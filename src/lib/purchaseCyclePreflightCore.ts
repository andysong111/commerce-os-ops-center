import { createHash } from "node:crypto";
import { purchaseSalesSourceFresh } from "./purchaseSalesFreshness.ts";
import { purchaseInventoryEvidenceFresh } from "./purchaseInventoryFreshness.ts";
import type { CandidatePromotionGate } from "./stage8CandidatePromotionGate";
import type { PostApplyCanonicalReconciliation } from "./stage8PostApplyCanonicalReconciliation";
import type { InventoryVerificationPriority, InventoryVerificationPriorityRow } from "./stage8InventoryVerificationPriority";
import { comparePurchaseStrategyPriority } from "./productDecisionEngine/purchaseStrategyPolicy.ts";
import type { PurchaseCandidateOmissionReviewRow } from "./purchaseCandidateOmissionAudit";
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
import {
  allocatePurchaseCashflow,
  normalizePurchaseOrderQuantity,
  type PurchaseCashflowTier,
} from "./purchaseCashflowAllocation.ts";

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
  startNewRun?: boolean;
  cashLimitKrw: number | null;
  sourcingBudgetPercent?: number;
  sourcingBudgetReturnKrw?: number;
  maxSkus: number;
  maxUnitsPerSku: number;
  allowOpenBudgetPreview?: boolean;
  replaceDraftId?: string | null;
  excludedBarcodes?: string[];
  quantityOverrides?: PurchaseQuantityOverride[];
  releasedQuantityOverrideBarcodes?: string[];
};
export type PurchaseQuantityOverride = {
  barcode: string;
  targetQuantity: number;
};
export type PurchaseMonthlySpendPin = {
  cycleMonth: string;
  readAt: string;
  recordedSpendKrw: number;
  contentFingerprint: string;
  accrualStartMonth?: string;
  accrualEndMonth?: string;
  accruedGrossBudgetKrw?: number;
  availableCashKrw?: number;
  accruedBudgetMonths?: string[];
};
export type PurchaseReplacementDraftLine = {
  barcode: string;
  name: string;
  quantity: number;
  preserveOnRegeneration?: boolean;
  recoveredFromPredecessor?: boolean;
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
  originalRecommendedQuantity: number;
  cashAdjusted: boolean;
  cashflowTier: "AUTOMATIC" | PurchaseCashflowTier;
  priorityScore: number;
  revenueQualifiedMonthCount: number;
  averageMonthlyRevenueKrw: number;
  revenueQualificationLabel: string;
  risingStrength: "NONE" | "MILD" | "MODERATE" | "STRONG";
  newProduct: boolean;
  newProductProtectedUntil: string | null;
  targetCoverageMonths: number;
  manualHeroCoverageReview: boolean;
  weightedClaimRate: number;
  claimPenaltyPoints: number;
  averageSellingPriceKrw: number;
  highValueConsistentBonusPoints: number;
  estimatedCostKrw: number;
  verifiedUnitCostKrw: number;
  confirmedUnitCostKrw: number;
  estimatedUnitCostKrw: number;
  costBasis: "VERIFIED_PURCHASE_COST" | "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE" | "PURCHASE_SHADOW_UNIT_COST_ESTIMATE" | PurchaseOwnerCostEstimateSource;
  costModelNo: string | null;
  costReferenceModelNo: string | null;
  executionCostVerified: boolean;
  costEvidenceSource: string;
  inventoryQuantity: number;
  inventoryMode: "VERIFIED" | "PROVISIONAL";
  inventoryVerified: boolean;
  inventoryBaselineKind: string | null;
  advisoryOnly: boolean;
  openCommitment: number;
  costEvidenceAt: string | null;
};
export type PurchaseDiscontinuationReviewCandidate = {
  barcode: string;
  name: string;
  revenueQualifiedMonthCount: number;
  revenueQualificationLabel: string;
  inventoryQuantity: number;
};
export type PurchaseCyclePreflightReport = {
  mode: "LIVE_READ_ONLY";
  generatedAt: string;
  targetDate: string;
  replacementDraftId: string | null;
  operatorExcludedBarcodes: string[];
  operatorQuantityOverrides: PurchaseQuantityOverride[];
  operatorReleasedQuantityOverrideBarcodes: string[];
  targetCycleMonth: string;
  requiredBudgetMonth: string;
  dateState: "BEFORE_TARGET" | "ON_TARGET" | "TARGET_PASSED";
  state: "BLOCKED" | "PREVIEW_ONLY" | "AWAITING_OWNER_REVIEW";
  sourceFingerprint: string;
  planFingerprint: string;
  purchaseStrategyConfigVersion: number | null;
  purchaseStrategyPolicySnapshot: string | null;
  candidateRequestId: string | null;
  sourceAnalysisAsOf: string | null;
  sourceCycleMonth: string | null;
  sourceBudgetMonth: string | null;
  cashLimitKrw: number | null;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
  sourcingBudgetReturnKrw: number;
  reorderCashKrw: number;
  automaticGrossBudgetKrw: number | null;
  effectiveBudgetKrw: number;
  recordedCycleSpendKrw: number | null;
  remainingMonthlyCashKrw: number;
  effectiveCashKrw: number;
  purchaseCostMultiplier: number | null;
  estimatedAllInSpendKrw: number;
  estimatedSpendKrw: number;
  cashAdjustedCount: number;
  cashExcludedCount: number;
  wholesaleEstimatedSelectedCount: number;
  shadowEstimatedSelectedCount: number;
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
  omissionReviewCount: number;
  omissionBlockingCount: number;
  omissionPreparationCount: number;
  omissionReview: PurchaseCandidateOmissionReviewRow[];
  discontinuationReviewCandidates: PurchaseDiscontinuationReviewCandidate[];
  eligibleCount: number;
  selected: PurchasePreflightLine[];
  preservedReplacementLines: PurchaseReplacementDraftLine[];
  replacementAudit: PurchaseReplacementDraftAudit | null;
  businessWritesEnabled: false;
  approvalEnabled: false;
  actualPurchaseExecuted: false;
  scheduledExecution: false;
};

const REPORT_MAX_AGE_MS = 15 * 60 * 1000;
const PURCHASE_DRAFT_LINE_LIMIT = 100;
// Leave room for the new-sourcing step while still exposing a broad, current
// set of reorder candidates that need rough stock or 5-1 cost input.
const PURCHASE_INPUT_PENDING_LINE_LIMIT = 80;
const FP = /^sha256:[a-f0-9]{64}$/;
const CODE = /^B[A-Z]{2}\d+-\d+$/;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const validPercent = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 100;
const percentOfFloor = (amount: number, percent: number) =>
  Math.floor(amount / 100) * percent + Math.floor(((amount % 100) * percent) / 100);
const hash = (v: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(v)).digest("hex")}`;
const fingerprint = (v: unknown): v is string => typeof v === "string" && FP.test(v);

function verifiedAutomaticRemovalReason(
  row: InventoryVerificationPriorityRow | undefined,
  completeCurrentPriorityScope: boolean,
) {
  if (!row) {
    return completeCurrentPriorityScope ? "LATEST_ACTIVE_SCOPE_ABSENT" : null;
  }
  if (row.permanentlyDiscontinued === true) return "PERMANENTLY_DISCONTINUED";
  const securedQuantity = row.inventoryQuantity + row.openCommitment;
  if (
    row.inventoryMode === "VERIFIED" &&
    row.inventoryVerified === true &&
    positive(row.demandTarget) &&
    securedQuantity >= row.demandTarget &&
    row.purchaseStatus !== "발주 추천"
  ) {
    return "VERIFIED_STOCK_COVERS_DEMAND";
  }
  // A complete current priority snapshot is the authority for automatic
  // recommendations. Keeping an old automatic line after the current policy
  // has explicitly stopped recommending it makes the replacement Draft both
  // stale and impossible to save. A missing row is removable only when the
  // priority snapshot proves that it covers the full managed active scope.
  if (row.purchaseStatus !== "발주 추천" || !positive(row.recommendedQty)) {
    return "LATEST_POLICY_NOT_RECOMMENDED";
  }
  return null;
}

const OPERATOR_INPUT_PENDING_REASONS = new Set([
  "CONFIRMED_COST_REQUIRED",
  "WHOLESALE_COST_ESTIMATE_UNAVAILABLE",
  "NO_ACTIVE_WHOLESALE_LISTING",
  "WHOLESALE_LISTING_PRICE_UNRESOLVED",
  "ACTIVE_WHOLESALE_PRICE_UNAVAILABLE",
  "VERIFIED_INVENTORY_REQUIRED",
  "ROW_EXECUTION_BLOCKED",
]);

function isCurrentOperatorInputRecommendation(
  row: InventoryVerificationPriorityRow | undefined,
  exclusionReasons: string[],
) {
  return Boolean(
    row?.purchaseStatus === "발주 추천" &&
      positive(row.recommendedQty) &&
      exclusionReasons.length > 0 &&
      exclusionReasons.every((reason) => OPERATOR_INPUT_PENDING_REASONS.has(reason)),
  );
}

function hasCompleteCurrentPriorityScope(
  priority: InventoryVerificationPriority | null,
) {
  // READY already proves the shadow, inventory and planning scopes join one
  // managed active row per SKU. Upstream blocker keys also carry advisory
  // execution concerns, so they must not make a complete scope look
  // incomplete for Draft replacement.
  return Boolean(
    priority?.state === "READY" &&
    priority.purchaseShadowReady === true &&
    priority.writesEnabled === false &&
    positive(priority.managedActiveSkuCount) &&
    priority.rows.length === priority.managedActiveSkuCount &&
    (priority.omissionBlockingCount ?? 0) === 0,
  );
}

export function buildPurchaseReplacementDraftSnapshot(
  draftId: string,
  readAt: string,
  lines: PurchaseReplacementDraftLine[],
): PurchaseReplacementDraftSnapshot {
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId) || !Number.isFinite(Date.parse(readAt))) {
    throw new Error("REPLACEMENT_DRAFT_SNAPSHOT_INVALID");
  }
  const normalized = lines
    .map((line) => ({
      barcode: line.barcode.trim().toUpperCase(),
      name: line.name.trim(),
      quantity: line.quantity,
      preserveOnRegeneration: line.preserveOnRegeneration === true,
      recoveredFromPredecessor: line.recoveredFromPredecessor === true,
    }))
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
  const excludedBarcodes = options.excludedBarcodes ?? [];
  if (!Array.isArray(excludedBarcodes) || excludedBarcodes.length > 100) {
    throw new Error("OPERATOR_EXCLUDED_BARCODES_INVALID");
  }
  if (excludedBarcodes.length > 0 && !options.replaceDraftId) {
    throw new Error("OPERATOR_EXCLUSIONS_REQUIRE_REPLACEMENT_DRAFT");
  }
  if (
    excludedBarcodes.some((value) => typeof value !== "string" || !CODE.test(value)) ||
    new Set(excludedBarcodes).size !== excludedBarcodes.length
  ) {
    throw new Error("OPERATOR_EXCLUDED_BARCODES_INVALID");
  }
  const quantityOverrides = options.quantityOverrides ?? [];
  if (!Array.isArray(quantityOverrides) || quantityOverrides.length > 100) {
    throw new Error("OPERATOR_QUANTITY_OVERRIDES_INVALID");
  }
  if (quantityOverrides.length > 0 && !options.replaceDraftId) {
    throw new Error("OPERATOR_QUANTITY_OVERRIDES_REQUIRE_REPLACEMENT_DRAFT");
  }
  const quantityOverrideBarcodes = quantityOverrides.map((row) => row?.barcode);
  if (
    quantityOverrides.some((row) =>
      !row || typeof row.barcode !== "string" || !CODE.test(row.barcode) ||
      !positive(row.targetQuantity) || row.targetQuantity > options.maxUnitsPerSku
    ) ||
    new Set(quantityOverrideBarcodes).size !== quantityOverrideBarcodes.length
  ) {
    throw new Error("OPERATOR_QUANTITY_OVERRIDES_INVALID");
  }
  if (quantityOverrideBarcodes.some((barcode) => excludedBarcodes.includes(barcode))) {
    throw new Error("OPERATOR_QUANTITY_OVERRIDE_EXCLUSION_CONFLICT");
  }
  const releasedQuantityOverrideBarcodes = options.releasedQuantityOverrideBarcodes ?? [];
  if (
    !Array.isArray(releasedQuantityOverrideBarcodes) ||
    releasedQuantityOverrideBarcodes.length > 100 ||
    releasedQuantityOverrideBarcodes.some(
      (value) => typeof value !== "string" || !CODE.test(value),
    ) ||
    new Set(releasedQuantityOverrideBarcodes).size !== releasedQuantityOverrideBarcodes.length
  ) {
    throw new Error("OPERATOR_RELEASED_QUANTITY_OVERRIDES_INVALID");
  }
  if (releasedQuantityOverrideBarcodes.length > 0 && !options.replaceDraftId) {
    throw new Error("OPERATOR_RELEASED_QUANTITY_OVERRIDES_REQUIRE_REPLACEMENT_DRAFT");
  }
  if (releasedQuantityOverrideBarcodes.some((barcode) => quantityOverrideBarcodes.includes(barcode))) {
    throw new Error("OPERATOR_RELEASED_QUANTITY_OVERRIDE_CONFLICT");
  }
  if (options.cashLimitKrw !== null && !positive(options.cashLimitKrw)) throw new Error("CASH_LIMIT_INVALID");
  if (!validPercent(options.sourcingBudgetPercent ?? 0)) throw new Error("SOURCING_BUDGET_PERCENT_INVALID");
  if (!nonnegative(options.sourcingBudgetReturnKrw ?? 0)) throw new Error("SOURCING_BUDGET_RETURN_INVALID");
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

function exactPlanningScopeVerified(
  reconciliation: PostApplyCanonicalReconciliation | null,
  currentPlanningContentFingerprint: string,
) {
  return reconciliation?.state === "READY" &&
    reconciliation.ready === true &&
    reconciliation.planningContentFingerprint === currentPlanningContentFingerprint &&
    reconciliation.checks.some(
      (check) => check.key === "planning-fingerprint-stable" && check.passed,
    );
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
  allowShadowEstimate = false,
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
  const supplied = wholesaleByBarcode.get(row.barcode) ?? ownerByBarcode.get(row.barcode);
  if (supplied) return supplied;
  if (
    allowShadowEstimate &&
    positive(row.expectedCost) &&
    positive(row.recommendedQty)
  ) {
    return {
      // This current shadow value is only a conservative Draft budgeting
      // estimate. The downstream 1688 step must still capture the live yuan
      // price before cart preparation or ordering.
      unitCostKrw: Math.ceil(row.expectedCost / row.recommendedQty),
      basis: "PURCHASE_SHADOW_UNIT_COST_ESTIMATE",
      source: "PURCHASE_SHADOW_EXPECTED_COST_ESTIMATE",
      evidenceAt: null,
      executionVerified: false,
      modelNo: row.modelNo,
      referenceModelNo: null,
    };
  }
  return null;
}

function lineCost(row: InventoryVerificationPriorityRow, basis: PurchaseCostBasis | null) {
  const value = (basis?.unitCostKrw ?? 0) * normalizePurchaseOrderQuantity(
    row.recommendedQty,
    row.cartonQuantity,
  );
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
function projectedLine(
  row: InventoryVerificationPriorityRow,
  basis: PurchaseCostBasis,
  allocatedQuantity = normalizePurchaseOrderQuantity(
    row.recommendedQty,
    row.cartonQuantity,
  ),
  cashflowTier: PurchasePreflightLine["cashflowTier"] = "AUTOMATIC",
): PurchasePreflightLine {
  const unitCost = basis.unitCostKrw;
  return {
    barcode: row.barcode, name: row.name, quantity: allocatedQuantity,
    originalRecommendedQuantity: row.recommendedQty,
    cashAdjusted: allocatedQuantity !== row.recommendedQty,
    cashflowTier,
    priorityScore: row.priorityScore,
    revenueQualifiedMonthCount: row.revenueQualifiedMonthCount,
    averageMonthlyRevenueKrw: row.averageMonthlyRevenueKrw,
    revenueQualificationLabel: row.revenueQualificationLabel,
    risingStrength: row.risingStrength,
    newProduct: row.newProduct,
    newProductProtectedUntil: row.newProductProtectedUntil,
    targetCoverageMonths: row.targetCoverageMonths,
    manualHeroCoverageReview: row.manualHeroCoverageReview,
    weightedClaimRate: row.weightedClaimRate,
    claimPenaltyPoints: row.claimPenaltyPoints,
    averageSellingPriceKrw: row.averageSellingPriceKrw,
    highValueConsistentBonusPoints: row.highValueConsistentBonusPoints,
    estimatedCostKrw: unitCost * allocatedQuantity,
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
    inventoryBaselineKind: row.inventoryBaselineKind,
    advisoryOnly: row.advisoryOnly,
    openCommitment: row.openCommitment,
    costEvidenceAt: basis.evidenceAt,
  };
}

function stablePlanLine(line: PurchasePreflightLine) {
  return {
    barcode: line.barcode,
    quantity: line.quantity,
  };
}

function stablePlanLines(lines: PurchasePreflightLine[]) {
  return lines
    .map(stablePlanLine)
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

function stableReplacementAudit(audit: PurchaseReplacementDraftAudit | null) {
  if (!audit) return null;
  return {
    previousLineCount: audit.previousLineCount,
    selectedLineCount: audit.selectedLineCount,
    matchedCount: audit.matchedCount,
    added: audit.added.map(({ barcode, quantity }) => ({ barcode, quantity })),
    removed: audit.removed.map(({ barcode, quantity }) => ({ barcode, quantity })),
    quantityChanged: audit.quantityChanged.map(({ barcode, previousQuantity, selectedQuantity }) => ({
      barcode,
      previousQuantity,
      selectedQuantity,
    })),
    complete: audit.complete,
  };
}

export function buildPurchaseCyclePreflight(input: PurchasePreflightInput): PurchaseCyclePreflightReport {
  validatePurchasePreflightOptions(input.options);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("PREFLIGHT_TIME_INVALID");
  const { targetDate, cashLimitKrw, maxSkus, maxUnitsPerSku } = input.options;
  const sourcingBudgetPercent = input.options.sourcingBudgetPercent ?? 0;
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
  const startNewRun = input.options.startNewRun === true;
  const operatorExcludedBarcodes = [...(input.options.excludedBarcodes ?? [])].sort();
  const operatorExcludedSet = new Set(operatorExcludedBarcodes);
  const operatorQuantityOverrides = [...(input.options.quantityOverrides ?? [])]
    .map((row) => ({ barcode: row.barcode, targetQuantity: row.targetQuantity }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
  const operatorQuantityByBarcode = new Map(
    operatorQuantityOverrides.map((row) => [row.barcode, row.targetQuantity] as const),
  );
  const operatorReleasedQuantityOverrideBarcodes = [
    ...(input.options.releasedQuantityOverrideBarcodes ?? []),
  ].sort();
  const operatorReleasedQuantityOverrideSet = new Set(
    operatorReleasedQuantityOverrideBarcodes,
  );
  const replacementStable = replacementDraftId === null || (
    validReplacementDraftSnapshot(input.replacementBefore, replacementDraftId) &&
    validReplacementDraftSnapshot(input.replacementAfter, replacementDraftId) &&
    input.replacementBefore!.contentFingerprint === input.replacementAfter!.contentFingerprint
  );
  if (!replacementStable) blockers.push("REPLACEMENT_DRAFT_CHANGED_OR_UNVERIFIED");
  const stable = samePurchaseCandidatePin(pin, input.after);
  if (!stable) blockers.push("SOURCE_CHANGED_OR_MISSING");
  const fullReadback = Boolean(validPin(pin) && rec?.state === "READY" && rec.ready === true &&
    rec.fullApplyVerified === true && fingerprint(rec.reconciliationFingerprint) &&
    fingerprint(rec.persistedContentFingerprint) && rec.checks.length > 0 && rec.checks.every(c => c.passed === true) &&
    rec.candidateSalesRequestId === pin.requestId && rec.analysisAsOf === pin.analysisAsOf &&
    rec.candidatePlanFingerprint === pin.planFingerprint && rec.candidateEventFingerprint === pin.eventFingerprint &&
    Number.isFinite(Date.parse(String(rec.generatedAt))));
  const sourceFresh = validPin(pin) && purchaseSalesSourceFresh({
    analysisAsOf: pin.analysisAsOf,
    nowMs: now,
    fullReadbackVerified: fullReadback,
  });
  if (!sourceFresh) blockers.push("SALES_SOURCE_STALE_OR_FUTURE");
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
  const planningContextMatch = Boolean(validPin(pin) && source && rec &&
    source.planningContentFingerprint === source.shadowPlanningContentFingerprint &&
    (source.planningContentFingerprint === pin.planningContentFingerprint ||
      exactPlanningScopeVerified(rec, source.planningContentFingerprint)));
  const contextMatch = Boolean(validPin(pin) && source && rec &&
    source.analysisAsOf === pin.analysisAsOf &&
    planningContextMatch &&
    fingerprint(source.canonicalContentFingerprint) &&
    source.canonicalContentFingerprint === rec.persistedContentFingerprint &&
    fingerprint(source.reconciliationFingerprint) &&
    source.reconciliationFingerprint === rec.reconciliationFingerprint);
  if (!contextMatch) blockers.push("PURCHASE_SOURCE_CONTEXT_MISMATCH");
  const shadowReady = input.priority?.state === "READY" && input.priority.purchaseShadowReady === true &&
    input.priority.writesEnabled === false && fresh(input.priority.generatedAt, now, REPORT_MAX_AGE_MS);
  if (!shadowReady) blockers.push("PURCHASE_SHADOW_NOT_READY");
  const inventoryFresh = purchaseInventoryEvidenceFresh({
    generatedAt: source?.inventoryGeneratedAt,
    nowMs: now,
  }) &&
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
  const carryoverCashKrw = spendStable && input.spendAfter &&
    nonnegative(input.spendAfter.availableCashKrw)
      ? input.spendAfter.availableCashKrw!
      : null;
  const remainingMonthlyCashKrw = fundingValid && recordedCycleSpendKrw !== null
    ? carryoverCashKrw ?? Math.max(0, source.grossBudgetKrw! - recordedCycleSpendKrw)
    : 0;
  // An explicit value is the cash available for this purchase run. It replaces
  // the automatic prior-month cost envelope instead of being clamped by it.
  // Recorded cycle spend is already reflected by the operator when they enter
  // current available cash; it is subtracted only in automatic mode.
  const effectiveCashKrw = positive(cashLimitKrw)
    ? cashLimitKrw
    : remainingMonthlyCashKrw;
  // Reserve the sourcing share from the all-in cash before freight reserve and
  // reorder allocation. The quotient/remainder form avoids unsafe integer
  // multiplication when an operator enters a very large safe-integer budget.
  const sourcingBudgetKrw = percentOfFloor(effectiveCashKrw, sourcingBudgetPercent);
  const sourcingBudgetReturnKrw = input.options.sourcingBudgetReturnKrw ?? 0;
  if (sourcingBudgetReturnKrw > sourcingBudgetKrw) {
    throw new Error("SOURCING_BUDGET_RETURN_EXCEEDS_RESERVE");
  }
  const reorderCashKrw = effectiveCashKrw - sourcingBudgetKrw + sourcingBudgetReturnKrw;
  // The cash ceiling includes freight reserve; line amounts are product costs.
  // Automatic mode remains bounded by the prior-month product-cost envelope.
  // Explicit mode uses the entered all-in cash after reserving the multiplier.
  const effectiveBudgetKrw = fundingValid && positive(source?.budgetKrw)
    ? cashLimitKrw === null
      ? carryoverCashKrw === null
        ? Math.min(source.budgetKrw, Math.floor(reorderCashKrw / multiplier!))
        : Math.floor(reorderCashKrw / multiplier!)
      : Math.floor(reorderCashKrw / multiplier!)
    : 0;
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
  const omissionReview = [...(input.priority?.omissionReviewRows ?? [])];
  const omissionBlockingCount = omissionReview.filter(
    (row) => row.severity === "BLOCKING",
  ).length;
  const omissionPreparationCount =
    omissionReview.length - omissionBlockingCount;
  if (omissionBlockingCount > 0) {
    blockers.push("PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED");
  }
  const duplicates = new Set(rows.filter((row, i) => i > 0 && rows[i - 1].barcode === row.barcode).map(row => row.barcode));
  if (duplicates.size) blockers.push("DUPLICATE_BARCODE");
  const replacementLineBarcodes = new Set(
    (input.replacementAfter?.lines ?? []).map((line) => line.barcode),
  );
  const operatorPinnedExistingBarcodes = new Set(
    operatorQuantityOverrides
      .map((row) => row.barcode)
      .filter((barcode) => replacementLineBarcodes.has(barcode) && !operatorExcludedSet.has(barcode)),
  );
  // An explicit quantity on the active replacement Draft is an operator
  // decision. Keep that existing line in the calculation even when the
  // automatic recommendation has since become ineligible. A missing cost
  // keeps the line out of budget allocation, but the existing Draft row is
  // preserved for the downstream 1688 price-capture step. New lines still
  // need cost and inventory evidence before they can enter the Draft.
  const candidates = rows.filter(
    (row) => row.purchaseStatus === "발주 추천" || operatorPinnedExistingBarcodes.has(row.barcode),
  );
  const allowShadowEstimateForRefill = Boolean(
    replacementDraftId && (operatorExcludedBarcodes.length > 0 || operatorQuantityOverrides.length > 0),
  );
  const costBasisByBarcode = new Map(
    candidates.map((row) => [
      row.barcode,
      purchaseCostBasis(
        row,
        now,
        wholesaleByBarcode,
        ownerByBarcode,
        allowShadowEstimateForRefill,
      ),
    ] as const),
  );
  const excluded: PurchaseCyclePreflightReport["excluded"] = [];
  const eligible: InventoryVerificationPriorityRow[] = [];
  for (const row of candidates) {
    const reasons: string[] = [];
    const operatorPinnedExisting = operatorPinnedExistingBarcodes.has(row.barcode);
    if (operatorExcludedSet.has(row.barcode)) reasons.push("OPERATOR_DRAFT_EXCLUSION");
    if (!CODE.test(row.barcode) || duplicates.has(row.barcode)) reasons.push("IDENTITY_REVIEW");
    const basis = costBasisByBarcode.get(row.barcode) ?? null;
    if (!basis || !positive(operatorPinnedExisting ? basis.unitCostKrw : lineCost(row, basis))) {
      const estimateRow = wholesaleSnapshot?.rows.find((item) => item.barcode === row.barcode);
      reasons.push(
        wholesaleSnapshotUsable && estimateRow?.reason
          ? estimateRow.reason
          : wholesaleSnapshot
            ? "WHOLESALE_COST_ESTIMATE_UNAVAILABLE"
            : "CONFIRMED_COST_REQUIRED",
      );
    }
    if (!operatorPinnedExisting && !inventoryPreviewReady(row)) reasons.push("VERIFIED_INVENTORY_REQUIRED");
    if (!operatorPinnedExisting && (!positive(row.recommendedQty) || !nonnegative(row.priorityScore))) {
      reasons.push("INVALID_RECOMMENDATION");
    }
    const quantityForLimit = operatorPinnedExisting
      ? operatorQuantityByBarcode.get(row.barcode) ?? 0
      : row.recommendedQty;
    if (quantityForLimit > maxUnitsPerSku) reasons.push("CANARY_QUANTITY_LIMIT");
    const previewPolicyReady = verifiedInventoryReady(row)
      ? basis?.executionVerified === false
        ? row.action === "COST_CONFIRMATION_REQUIRED" && row.operationallyReady === false
        : row.action === "NONE" && row.operationallyReady === true
      : provisionalInventoryReady(row) && row.operationallyReady === false;
    if (!operatorPinnedExisting && !previewPolicyReady) reasons.push("ROW_EXECUTION_BLOCKED");
    if (reasons.length) excluded.push({ barcode: row.barcode, reasons }); else eligible.push(row);
  }
  eligible.sort((a, b) => comparePurchaseStrategyPriority(a, b) || lineCost(a, costBasisByBarcode.get(a.barcode) ?? null) - lineCost(b, costBasisByBarcode.get(b.barcode) ?? null) || a.barcode.localeCompare(b.barcode));
  const candidateBarcodes = new Set(candidates.map((row) => row.barcode));
  const eligibleBarcodes = new Set(eligible.map((row) => row.barcode));
  const preservedReplacementBarcodes = new Set(
    (input.replacementAfter?.lines ?? [])
      .filter((line) => line.preserveOnRegeneration === true)
      .map((line) => line.barcode),
  );
  for (const override of operatorQuantityOverrides) {
    if (
      preservedReplacementBarcodes.has(override.barcode) ||
      operatorPinnedExistingBarcodes.has(override.barcode)
    ) continue;
    if (!candidateBarcodes.has(override.barcode) || !eligibleBarcodes.has(override.barcode)) {
      blockers.push("OPERATOR_QUANTITY_TARGET_NOT_ELIGIBLE");
    }
  }
  const selected: PurchasePreflightLine[] = [];
  let estimatedSpendKrw = 0;
  const previewCalculationBlocked = () => blockers.some(
    (code) => code !== "PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED",
  );
  if (!previewCalculationBlocked()) {
    const fixedRows = eligible.filter((row) => operatorQuantityByBarcode.has(row.barcode));
    const flexibleRows = eligible.filter((row) => !operatorQuantityByBarcode.has(row.barcode));
    const remainingSkuCapacity = Math.max(0, maxSkus - fixedRows.length);
    const withinSkuLimit = flexibleRows.slice(0, remainingSkuCapacity);
    for (const row of flexibleRows.slice(remainingSkuCapacity)) {
      excluded.push({ barcode: row.barcode, reasons: ["CANARY_SKU_LIMIT"] });
    }
    const fixedSpendKrw = fixedRows.reduce((sum, row) => {
      const basis = costBasisByBarcode.get(row.barcode);
      const targetQuantity = operatorQuantityByBarcode.get(row.barcode) ?? 0;
      return sum + (basis?.unitCostKrw ?? 0) * targetQuantity;
    }, 0);
    if (fixedRows.length > maxSkus) {
      blockers.push("OPERATOR_QUANTITY_SKU_LIMIT_EXCEEDED");
    } else if (fixedSpendKrw > effectiveBudgetKrw) {
      blockers.push("OPERATOR_QUANTITY_BUDGET_EXCEEDED");
    } else {
      for (const row of fixedRows) {
        const basis = costBasisByBarcode.get(row.barcode);
        const targetQuantity = operatorQuantityByBarcode.get(row.barcode);
        if (!basis || !targetQuantity) continue;
        selected.push(projectedLine(row, basis, targetQuantity, "AUTOMATIC"));
        estimatedSpendKrw += basis.unitCostKrw * targetQuantity;
      }
    }
    const remainingBudgetKrw = Math.max(0, effectiveBudgetKrw - estimatedSpendKrw);
    if (!previewCalculationBlocked() && cashLimitKrw !== null) {
      const allocations = allocatePurchaseCashflow(
        withinSkuLimit.map((row) => ({
          barcode: row.barcode,
          priorityScore: row.priorityScore,
          revenueQualifiedMonthCount: row.revenueQualifiedMonthCount,
          averageMonthlyRevenueKrw: row.averageMonthlyRevenueKrw,
          risingStrength: row.risingStrength,
          targetQuantity: row.recommendedQty,
          unitCostKrw:
            costBasisByBarcode.get(row.barcode)?.unitCostKrw ?? 0,
          moq: row.moq,
          cartonQuantity: row.cartonQuantity,
        })),
        remainingBudgetKrw,
      );
      const allocationByBarcode = new Map(
        allocations.map((row) => [row.barcode, row] as const),
      );
      for (const row of withinSkuLimit) {
        const basis = costBasisByBarcode.get(row.barcode);
        const allocation = allocationByBarcode.get(row.barcode);
        if (!basis || !allocation || allocation.allocatedQuantity <= 0) {
          excluded.push({ barcode: row.barcode, reasons: ["CASH_BUDGET_LIMIT"] });
          continue;
        }
        selected.push(
          projectedLine(
            row,
            basis,
            allocation.allocatedQuantity,
            allocation.tier,
          ),
        );
        estimatedSpendKrw += allocation.estimatedCostKrw;
      }
    } else if (!previewCalculationBlocked()) {
      for (const row of withinSkuLimit) {
        const basis = costBasisByBarcode.get(row.barcode);
        if (!basis) continue;
        if (lineCost(row, basis) > effectiveBudgetKrw - estimatedSpendKrw) {
          excluded.push({ barcode: row.barcode, reasons: ["CASH_BUDGET_LIMIT"] });
          continue;
        }
        selected.push(projectedLine(row, basis));
        estimatedSpendKrw += lineCost(row, basis);
      }
    }
    if (!previewCalculationBlocked() && selected.length === 0) {
      blockers.push("NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
    }
  }
  const accountedCandidateBarcodes = new Set([
    ...selected.map((row) => row.barcode),
    ...excluded.map((row) => row.barcode),
  ]);
  const candidateCoverageComplete =
    accountedCandidateBarcodes.size === candidates.length &&
    selected.length + excluded.length === candidates.length &&
    omissionBlockingCount === 0;
  const discontinuationReviewCandidates = rows
    .filter((row) => row.discontinuationReviewCandidate === true)
    .map((row) => ({
      barcode: row.barcode,
      name: row.name,
      revenueQualifiedMonthCount: row.revenueQualifiedMonthCount,
      revenueQualificationLabel: row.revenueQualificationLabel,
      inventoryQuantity: row.inventoryQuantity,
    }))
    .sort(
      (left, right) =>
        right.inventoryQuantity - left.inventoryQuantity ||
        left.barcode.localeCompare(right.barcode),
    );
  if (blockers.length === 0 && !candidateCoverageComplete) blockers.push("CANDIDATE_COVERAGE_MISMATCH");
  if (selected.some((row) => row.inventoryMode === "PROVISIONAL")) {
    reviewBlockers.push("PROVISIONAL_INVENTORY_OWNER_REVIEW_REQUIRED");
  }
  if (selected.some((row) => row.costBasis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE")) {
    reviewBlockers.push("WHOLESALE_COST_ESTIMATE_OWNER_REVIEW_REQUIRED");
  }
  if (selected.some((row) => row.costBasis === "PURCHASE_SHADOW_UNIT_COST_ESTIMATE")) {
    reviewBlockers.push("PURCHASE_SHADOW_COST_ESTIMATE_OWNER_REVIEW_REQUIRED");
  }
  if (selected.some((row) => row.costBasis === "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE" || row.costBasis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE")) {
    reviewBlockers.push("OWNER_COST_ESTIMATE_REVIEW_REQUIRED");
  }
  let replacementAudit: PurchaseReplacementDraftAudit | null = null;
  let preservedReplacementLines: PurchaseReplacementDraftLine[] = [];
  if (replacementDraftId && replacementStable && input.replacementAfter) {
    const visiblePreviousLines = input.replacementAfter.lines.filter(
      (line) => line.recoveredFromPredecessor !== true,
    );
    const previousByBarcode = new Map(
      visiblePreviousLines.map((line) => [line.barcode, line]),
    );
    const selectedByBarcode = new Map(selected.map((line) => [line.barcode, line]));
    const priorityByBarcode = new Map(rows.map((row) => [row.barcode, row] as const));
    const exclusionReasonsByBarcode = new Map<string, string[]>();
    for (const row of excluded) {
      exclusionReasonsByBarcode.set(row.barcode, [
        ...(exclusionReasonsByBarcode.get(row.barcode) ?? []),
        ...row.reasons,
      ]);
    }
    const completeCurrentPriorityScope = hasCompleteCurrentPriorityScope(input.priority);
    const operatorPinnedPreservedBarcodes = new Set(
      [...operatorPinnedExistingBarcodes].filter((barcode) => !eligibleBarcodes.has(barcode)),
    );
    const automaticRemovalReasonByBarcode = new Map(
      input.replacementAfter.lines.flatMap((line) => {
        if (
          line.preserveOnRegeneration === true ||
          operatorPinnedPreservedBarcodes.has(line.barcode)
        ) return [];
        const reason = verifiedAutomaticRemovalReason(
          priorityByBarcode.get(line.barcode),
          completeCurrentPriorityScope,
        );
        return reason ? [[line.barcode, reason] as const] : [];
      }),
    );
    const retainedReplacementLines = input.replacementAfter.lines
      .filter(
        (line) =>
          !operatorExcludedSet.has(line.barcode) &&
          !operatorReleasedQuantityOverrideSet.has(line.barcode) &&
          !selectedByBarcode.has(line.barcode) &&
          !automaticRemovalReasonByBarcode.has(line.barcode) &&
          (!startNewRun ||
            line.preserveOnRegeneration === true ||
            operatorPinnedPreservedBarcodes.has(line.barcode)),
      )
      .map((line) => {
        const currentPriorityRow = priorityByBarcode.get(line.barcode);
        const refreshedAutomaticQuantity =
          line.preserveOnRegeneration !== true &&
          isCurrentOperatorInputRecommendation(
            currentPriorityRow,
            exclusionReasonsByBarcode.get(line.barcode) ?? [],
          )
            ? normalizePurchaseOrderQuantity(currentPriorityRow!.recommendedQty)
            : normalizePurchaseOrderQuantity(line.quantity);
        return {
          ...line,
          quantity:
            operatorQuantityByBarcode.get(line.barcode) ??
            refreshedAutomaticQuantity,
        };
      });
    const retainedBarcodes = new Set([
      ...selectedByBarcode.keys(),
      ...retainedReplacementLines.map((line) => line.barcode),
    ]);
    const freshInputPendingLines = rows
      .filter((row) =>
        !retainedBarcodes.has(row.barcode) &&
        !operatorExcludedSet.has(row.barcode) &&
        isCurrentOperatorInputRecommendation(
          row,
          exclusionReasonsByBarcode.get(row.barcode) ?? [],
        )
      )
      .sort((left, right) =>
        comparePurchaseStrategyPriority(left, right) ||
        left.barcode.localeCompare(right.barcode)
      )
      .slice(
        0,
        Math.max(
          0,
          PURCHASE_INPUT_PENDING_LINE_LIMIT -
            selected.length -
            retainedReplacementLines.length,
        ),
      )
      .map((row) => ({
        barcode: row.barcode,
        name: row.name,
        quantity: normalizePurchaseOrderQuantity(row.recommendedQty),
      }));
    preservedReplacementLines = [
      ...retainedReplacementLines,
      ...freshInputPendingLines,
    ];
    if (operatorPinnedPreservedBarcodes.size > 0) {
      reviewBlockers.push("OPERATOR_PINNED_EXISTING_COST_REVIEW_REQUIRED");
    }
    if (
      !startNewRun &&
      preservedReplacementLines.some(
        (line) =>
          line.preserveOnRegeneration !== true &&
          !operatorPinnedPreservedBarcodes.has(line.barcode) &&
          !isCurrentOperatorInputRecommendation(
            priorityByBarcode.get(line.barcode),
            exclusionReasonsByBarcode.get(line.barcode) ?? [],
          ),
      )
    ) {
      reviewBlockers.push("EXISTING_DRAFT_RECOMMENDATION_REVIEW_REQUIRED");
    }
    const finalByBarcode = new Map<string, PurchaseReplacementDraftLine>([
      ...selected.map((line) => [line.barcode, {
        barcode: line.barcode,
        name: line.name,
        quantity: line.quantity,
      }] as const),
      ...preservedReplacementLines.map((line) => [line.barcode, line] as const),
    ]);
    if (finalByBarcode.size > PURCHASE_DRAFT_LINE_LIMIT) {
      blockers.push("PURCHASE_DRAFT_LINE_LIMIT");
    }
    const matchedBarcodes = [...previousByBarcode.keys()].filter((barcode) => finalByBarcode.has(barcode));
    const added = [...finalByBarcode.values()]
      .filter((line) => !previousByBarcode.has(line.barcode))
      .map((line) => ({
        barcode: line.barcode,
        name: line.name,
        quantity: line.quantity,
        ...(line.preserveOnRegeneration === true
          ? { preserveOnRegeneration: true }
          : {}),
        ...(line.recoveredFromPredecessor === true
          ? { recoveredFromPredecessor: true }
          : {}),
      }));
    const removed = visiblePreviousLines
      .filter((line) => !finalByBarcode.has(line.barcode))
      .map((line) => ({
        ...line,
        reasons: operatorExcludedSet.has(line.barcode)
          ? ["OPERATOR_DRAFT_EXCLUSION"]
          : operatorReleasedQuantityOverrideSet.has(line.barcode)
            ? ["OPERATOR_QUANTITY_OVERRIDE_RELEASED_TO_POLICY"]
          : startNewRun
            ? ["NEW_RUN_REBUILT_FROM_LATEST_RECOMMENDATIONS"]
            : [automaticRemovalReasonByBarcode.get(line.barcode) ?? "EXISTING_DRAFT_REMOVAL_UNVERIFIED"],
      }));
    const quantityChanged = matchedBarcodes.flatMap((barcode) => {
      const previous = previousByBarcode.get(barcode)!;
      const next = finalByBarcode.get(barcode)!;
      return previous.quantity === next.quantity ? [] : [{
        barcode,
        name: next.name || previous.name,
        previousQuantity: previous.quantity,
        selectedQuantity: next.quantity,
      }];
    });
    const complete =
      matchedBarcodes.length + removed.length === visiblePreviousLines.length &&
      matchedBarcodes.length + added.length === finalByBarcode.size &&
      new Set([...matchedBarcodes, ...removed.map((line) => line.barcode)]).size === visiblePreviousLines.length &&
      new Set([...matchedBarcodes, ...added.map((line) => line.barcode)]).size === finalByBarcode.size;
    replacementAudit = {
      previousLineCount: visiblePreviousLines.length,
      selectedLineCount: finalByBarcode.size,
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
    purchaseStrategyConfigVersion:
      source.purchaseStrategyConfigVersion ?? null,
    purchaseStrategyPolicySnapshot:
      source.purchaseStrategyPolicySnapshot ?? null,
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
    omissionAuditError: input.priority?.omissionAuditError ?? null,
    omissionReview,
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
    operatorExcludedBarcodes,
    operatorQuantityOverrides,
    operatorReleasedQuantityOverrideBarcodes,
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
    stage(7, "발주 후보 원가 근거", inventoryFresh ? coverage(candidates.filter(row => costBasisByBarcode.get(row.barcode)).length) : "BLOCKED", `확정원가 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "VERIFIED_PURCHASE_COST").length}개 · 활성 도매 판매가 추정 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE").length}개 · 제외 후 재생성용 엔진 추정 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "PURCHASE_SHADOW_UNIT_COST_ESTIMATE").length}개 · 사용자 제공 추정 ${candidates.filter(row => costBasisByBarcode.get(row.barcode)?.basis === "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE" || costBasisByBarcode.get(row.barcode)?.basis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE").length}개 · 미확인 ${candidates.filter(row => !costBasisByBarcode.get(row.barcode)).length}개. 추정값은 초안 예산에만 쓰며 실제 주문 원가로 승격하지 않습니다.`, "/stage7-purchase-cost-evidence"),
    stage(8, "발주 후보 재고 근거", inventoryFresh && omissionBlockingCount === 0 ? coverage(candidates.filter(inventoryPreviewReady).length) : "BLOCKED", `계획재고 ${candidates.filter(inventoryPreviewReady).length}/${candidates.length}개 · VERIFIED ${candidates.filter(verifiedInventoryReady).length}개 · PROVISIONAL ${candidates.filter(provisionalInventoryReady).length}개 · 상위 누락 검토 ${omissionReview.length}개(차단 ${omissionBlockingCount}개). 전수 실사는 요구하지 않으며, 실제 품절 시 SOLD_OUT_RESET=0 이후 중국 확정입고와 판매를 누적합니다.`, "/stage8-inventory-verification-priority"),
    stage(9, "발주 Shadow·원본 일치", shadowReady && contextMatch && stable && fullReadback && sourceFresh && inventoryFresh ? "VERIFIED" : "BLOCKED", "판매·재고·미입고가 연결된 읽기 전용 계산입니다. 보조신호 등 남은 조건은 승인 검토 차단 사유로 별도 표시합니다.", "/stage8-canonical-purchase-shadow"),
    stage(10, "예산 내 소량 발주안", previewReady ? "VERIFIED" : "WAITING", previewReady ? budgetMonthClosed ? `${cashLimitKrw === null ? "전월 판매원가 자동 한도" : "운영자 입력 총현금"}에서 신규상품 소싱 ${sourcingBudgetPercent}%를 최대한도로 예약하고, 안전후보 배정 뒤 남은 ${sourcingBudgetReturnKrw.toLocaleString("ko-KR")}원을 기존상품 예산으로 돌려 계산한 미리보기입니다. 승인·예약·주문은 생성되지 않았습니다.` : "월 마감 전 조기 미리보기입니다. 실제 주문 전에 마감 자료로 다시 계산해야 하며 승인·예약·주문은 생성되지 않았습니다." : `목표 월의 최신 데이터와 ${cashLimitKrw === null ? "전월 판매원가 자동 한도" : "운영자 입력 총현금"}, 신규상품 소싱 비율을 확인한 뒤 계산합니다.`, "/purchase-cycle-preflight"),
    stage(11, "실제 주문→입고 검증", "LOCKED", "지정일에도 자동으로 열리지 않습니다. 별도 최종 승인과 기존 실행 경로의 재검증 후 실제 입고까지 확인해야 합니다.", "/fast-purchase-mvp"),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueReview = [...new Set(reviewBlockers)];
  return {
    mode: "LIVE_READ_ONLY", generatedAt: input.now, targetDate,
    replacementDraftId, operatorExcludedBarcodes, operatorQuantityOverrides,
    operatorReleasedQuantityOverrideBarcodes,
    targetCycleMonth, requiredBudgetMonth, dateState,
    state: !previewReady ? "BLOCKED" : uniqueReview.length ? "PREVIEW_ONLY" : "AWAITING_OWNER_REVIEW",
    sourceFingerprint,
    // Pin the operator-visible decision, not every diagnostic source row. The
    // full source fingerprint remains in the report for audit, while this
    // fingerprint stays stable when an unrelated source observation changes
    // without changing the approved products, quantities, budget or replaced
    // draft. Draft creation re-runs every readiness gate before accepting it.
    planFingerprint: hash({
      options: {
        targetDate: input.options.targetDate,
        startNewRun,
        cashLimitKrw: input.options.cashLimitKrw,
        sourcingBudgetPercent,
        maxSkus: input.options.maxSkus,
        maxUnitsPerSku: input.options.maxUnitsPerSku,
        allowOpenBudgetPreview: input.options.allowOpenBudgetPreview === true,
        replaceDraftId: input.options.replaceDraftId ?? null,
        excludedBarcodes: operatorExcludedBarcodes,
        quantityOverrides: operatorQuantityOverrides,
        releasedQuantityOverrideBarcodes: operatorReleasedQuantityOverrideBarcodes,
      },
      selected: stablePlanLines(selected),
      preservedReplacementLines: preservedReplacementLines.map((line) => ({
        barcode: line.barcode,
        quantity: line.quantity,
        preserveOnRegeneration: line.preserveOnRegeneration === true,
        recoveredFromPredecessor: line.recoveredFromPredecessor === true,
      })),
      replacementAudit: stableReplacementAudit(replacementAudit),
      budget: {
        cashLimitKrw,
        sourcingBudgetKrw,
        estimatedSpendKrw,
        estimatedAllInSpendKrw: multiplierValid ? Math.ceil(estimatedSpendKrw * multiplier!) : 0,
      },
      purchaseStrategy: {
        configVersion: source?.purchaseStrategyConfigVersion ?? null,
        policySnapshot: source?.purchaseStrategyPolicySnapshot ?? null,
      },
    }),
    purchaseStrategyConfigVersion:
      source?.purchaseStrategyConfigVersion ?? null,
    purchaseStrategyPolicySnapshot:
      source?.purchaseStrategyPolicySnapshot ?? null,
    candidateRequestId: pin?.requestId ?? null, sourceAnalysisAsOf: pin?.analysisAsOf ?? null,
    sourceCycleMonth: source?.cycleMonth ?? null, sourceBudgetMonth: source?.budgetMonth ?? null,
    cashLimitKrw, sourcingBudgetPercent, sourcingBudgetKrw, sourcingBudgetReturnKrw, reorderCashKrw,
    automaticGrossBudgetKrw: fundingValid ? source!.grossBudgetKrw! : null,
    effectiveBudgetKrw, estimatedSpendKrw,
    cashAdjustedCount: selected.filter((row) => row.cashAdjusted).length,
    cashExcludedCount: excluded.filter((row) =>
      row.reasons.includes("CASH_BUDGET_LIMIT"),
    ).length,
    remainingPreviewBudgetKrw: effectiveBudgetKrw - estimatedSpendKrw,
    wholesaleEstimatedSelectedCount: selected.filter((row) => row.costBasis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE").length,
    shadowEstimatedSelectedCount: selected.filter((row) => row.costBasis === "PURCHASE_SHADOW_UNIT_COST_ESTIMATE").length,
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
    omissionReviewCount: omissionReview.length,
    omissionBlockingCount,
    omissionPreparationCount,
    omissionReview,
    discontinuationReviewCandidates,
    eligibleCount: eligible.length, selected, preservedReplacementLines, replacementAudit,
    businessWritesEnabled: false, approvalEnabled: false, actualPurchaseExecuted: false, scheduledExecution: false,
  };
}

export type PurchasePreflightReaders = {
  candidate: () => Promise<PurchaseCandidatePin>;
  gate?: () => Promise<CandidatePromotionGate>;
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
  const safeReadFailureCause = (error: unknown) => {
    const chain: unknown[] = [error];
    const tokens: string[] = [];
    const details: string[] = [];
    for (let index = 0; index < chain.length && index < 4; index += 1) {
      const value = chain[index];
      if (!value || typeof value !== "object") continue;
      const row = value as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
      const name = String(row.name ?? "").trim();
      const errorCode = String(row.code ?? "").trim();
      const message = String(row.message ?? "").trim();
      if (name && name !== "Error") tokens.push(name);
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(errorCode)) tokens.push(errorCode);
      const messageCode = message.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
      if (messageCode) tokens.push(messageCode);
      details.push(message.toLowerCase());
      if (row.cause) chain.push(row.cause);
    }
    if (tokens.length) return tokens[0];
    const detail = details.join(" ");
    if (detail.includes("timeout") || detail.includes("timed out")) return "TIMEOUT";
    if (detail.includes("abort")) return "ABORTED";
    if (detail.includes("fetch failed")) return "FETCH_FAILED";
    return error instanceof Error ? error.name : "UNKNOWN_ERROR";
  };
  const capture = async <T>(code: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      const cause = safeReadFailureCause(error);
      console.warn("[purchase-cycle-preflight] source read failed", { code, cause });
      sourceErrors.push(code);
      return null;
    }
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
  const [gate, reconciliation, priority] = before
    ? await Promise.all([
        readers.gate
          ? capture("PROMOTION_GATE_READ_FAILED", readers.gate)
          : Promise.resolve(null),
        capture("MASTER_READBACK_READ_FAILED", readers.reconciliation),
        capture("INVENTORY_PRIORITY_READ_FAILED", readers.priority),
      ])
    : [null, null, null];
  let wholesaleCosts: PurchaseWholesaleCostEstimateSnapshot | null = null;
  const hasPurchaseRecommendations = priority?.rows.some(
    (row) => row.purchaseStatus === "발주 추천",
  ) === true;
  if (readers.wholesaleCosts && hasPurchaseRecommendations) {
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
    before
      ? capture("CANDIDATE_RECHECK_FAILED", readers.candidate)
      : Promise.resolve(null),
    before && spendBefore
      ? capture("CYCLE_SPEND_RECHECK_FAILED", () => readers.monthlySpend(options.targetDate.slice(0, 7)))
      : Promise.resolve(null),
    before && replacementRead && replacementBefore
      ? capture("REPLACEMENT_DRAFT_RECHECK_FAILED", replacementRead)
      : Promise.resolve(null),
  ]);
  return buildPurchaseCyclePreflight({ now: clock(), options, before, after, gate, reconciliation, priority, wholesaleCosts, ownerCosts, costEstimateErrors, sourceErrors, spendBefore, spendAfter, replacementBefore, replacementAfter });
}
