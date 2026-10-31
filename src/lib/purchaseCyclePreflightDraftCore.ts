import { createHash } from "node:crypto";
import type { FastPurchaseInternalDraftLine } from "@/lib/fastPurchaseInternalDraft";
import type {
  PurchaseCyclePreflightReport,
  PurchaseQuantityOverride,
} from "@/lib/purchaseCyclePreflightCore";
import type {
  SourcingBudgetPlan,
  SourcingVariantSelectionInput,
} from "@/lib/sourcingBudgetPlan";

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const PRESERVED_SOURCING_ONLY_BLOCKERS = new Set([
  "WAREHOUSE_GATE_NOT_READY",
  "NO_TEST_READY_CANDIDATE",
]);

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export function sourcingBudgetDecisionFingerprint(plan: SourcingBudgetPlan) {
  type DecisionLine = {
    conceptId: string;
    variantKey: string | null;
    saleOption: string | null;
    chinaOption: string | null;
    storageSize: "S" | "L" | null;
    quantity: number | null;
  };
  const selected: DecisionLine[] = [];
  for (const row of plan.allocation.selected) {
    if (Array.isArray(row.selectedVariants) && row.selectedVariants.length > 0) {
      for (const variant of row.selectedVariants) {
        selected.push({
          conceptId: row.conceptId,
          variantKey: variant.variantKey,
          saleOption: variant.saleOption,
          chinaOption: variant.chinaOption,
          storageSize: variant.storageSize,
          quantity: variant.quantity,
        });
      }
    } else {
      selected.push({
        conceptId: row.conceptId,
        variantKey: null,
        saleOption: null,
        chinaOption: null,
        storageSize: row.storageSize ?? null,
        quantity: row.quantity ?? null,
      });
    }
  }
  selected.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const reused = [...(plan.reusedConfirmedVariants ?? [])]
    .map((row) => ({
      conceptId: row.conceptId,
      variantKey: row.variantKey,
      barcode: row.barcode,
      quantity: row.quantity,
      estimatedCostKrw: row.estimatedCostKrw,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return hash({
    targetCycleMonth: plan.targetCycleMonth,
    totalCashKrw: plan.totalCashKrw,
    sourcingBudgetPercent: plan.sourcingBudgetPercent,
    sourcingBudgetKrw: plan.sourcingBudgetKrw,
    selected,
    reused,
  });
}

function sortedStrings(values: string[] | undefined) {
  return [...(values ?? [])].sort();
}

function sortedQuantityOverrides(values: PurchaseQuantityOverride[] | undefined) {
  return [...(values ?? [])]
    .map(({ barcode, targetQuantity }) => ({ barcode, targetQuantity }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

function sortedStorageEntries(values: Record<string, "S" | "L"> | undefined) {
  return Object.entries(values ?? {}).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
}

function sortedVariantSelections(values: SourcingVariantSelectionInput[] | undefined) {
  return (values ?? [])
    .map(({ conceptId, variantKey, storageSize }) => [conceptId, variantKey, storageSize] as const)
    .sort((left, right) => {
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] < right[index]) return -1;
        if (left[index] > right[index]) return 1;
      }
      return 0;
    });
}

function sameSourcingSelection(
  plan: SourcingBudgetPlan,
  request: PurchaseCycleDraftRequest,
) {
  return (
    JSON.stringify(sortedStrings(plan.preferredConceptIds)) ===
      JSON.stringify(sortedStrings(request.preferredSourcingConceptIds)) &&
    JSON.stringify(sortedStorageEntries(plan.storageSizeByConceptId)) ===
      JSON.stringify(sortedStorageEntries(request.sourcingStorageSizeByConceptId)) &&
    JSON.stringify(sortedVariantSelections(plan.variantSelections)) ===
      JSON.stringify(sortedVariantSelections(request.sourcingVariantSelections))
  );
}

export type PurchaseCycleDraftRequest = {
  targetDate: string;
  startNewRun?: boolean;
  cashLimitKrw?: number | null;
  sourcingBudgetPercent?: number;
  preferredSourcingConceptIds?: string[];
  sourcingStorageSizeByConceptId?: Record<string, "S" | "L">;
  sourcingVariantSelections?: SourcingVariantSelectionInput[];
  sourcingSelectionMode?: "automatic" | "custom";
  allowOpenBudgetPreview?: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  expectedSourcingSourceFingerprint?: string | null;
  expectedSourcingPlanFingerprint?: string | null;
  expectedSourcingDecisionFingerprint?: string | null;
  confirmation: string;
  replaceDraftId?: string | null;
  excludedBarcodes?: string[];
  quantityOverrides?: PurchaseQuantityOverride[];
  releasedQuantityOverrideBarcodes?: string[];
};

export function purchaseCycleDraftPreflightOptions(
  request: PurchaseCycleDraftRequest,
) {
  return {
    targetDate: request.targetDate,
    startNewRun: request.startNewRun === true,
    cashLimitKrw: request.cashLimitKrw ?? null,
    sourcingBudgetPercent: request.sourcingBudgetPercent ?? 0,
    maxSkus: 100,
    maxUnitsPerSku: 9_999,
    allowOpenBudgetPreview: request.allowOpenBudgetPreview === true,
    replaceDraftId: request.replaceDraftId ?? null,
    excludedBarcodes: request.excludedBarcodes ?? [],
    quantityOverrides: request.quantityOverrides ?? [],
    releasedQuantityOverrideBarcodes: request.releasedQuantityOverrideBarcodes ?? [],
  };
}

export function purchaseCycleDraftConfirmation(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null = null,
) {
  const sourcingVariantCount = (sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (
      Array.isArray(row.selectedVariants) ? row.selectedVariants.length : 1
    ),
    0,
  ) ?? 0) + (sourcingPlan?.reusedConfirmedVariants?.length ?? 0);
  const sourcingSuffix = report.sourcingBudgetPercent > 0 && sourcingPlan
    ? `_NEWSOURCE${sourcingVariantCount}SKU_LIMIT${report.sourcingBudgetKrw}KRW_${sourcingBudgetDecisionFingerprint(sourcingPlan).slice(-12)}`
    : "";
  if (report.replacementDraftId) {
    const audit = report.replacementAudit;
    if (!audit?.complete) throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
    return `REGENERATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${audit.selectedLineCount}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT_ADD${audit.added.length}_REMOVE${audit.removed.length}_CHANGE${audit.quantityChanged.length}_${report.replacementDraftId}${sourcingSuffix}`;
  }
  return `CREATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT${sourcingSuffix}`;
}

export function purchaseCycleDraftPlannedTotals(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null = null,
) {
  const existingReorderCount = report.selected.length;
  const existingReorderQuantity = report.selected.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const preservedSourcingLines = (report.preservedReplacementLines ?? []).filter(
    (row) => row.preserveOnRegeneration === true,
  );
  const preservedSourcingBarcodes = new Set(
    preservedSourcingLines.map((row) => row.barcode),
  );
  const selectedBarcodes = new Set(report.selected.map((row) => row.barcode));
  const replacementLineBarcodes = new Set(
    (report.preservedReplacementLines ?? []).map((row) => row.barcode),
  );
  const restoredReusedReservations = (sourcingPlan?.reusedConfirmedVariants ?? []).filter(
    (row) =>
      !preservedSourcingBarcodes.has(row.barcode) &&
      !selectedBarcodes.has(row.barcode) &&
      !replacementLineBarcodes.has(row.barcode),
  );
  const operatorPinnedBarcodes = new Set(
    report.operatorQuantityOverrides.map((row) => row.barcode),
  );
  const preservedOperatorLines = (report.preservedReplacementLines ?? []).filter(
    (row) => row.preserveOnRegeneration !== true && operatorPinnedBarcodes.has(row.barcode),
  );
  const unresolvedAutomaticLines = (report.preservedReplacementLines ?? []).filter(
    (row) => row.preserveOnRegeneration !== true && !operatorPinnedBarcodes.has(row.barcode),
  );
  const preservedSourcingCount = preservedSourcingLines.length + restoredReusedReservations.length;
  const preservedSourcingQuantity = preservedSourcingLines.reduce(
    (total, row) => total + row.quantity,
    restoredReusedReservations.reduce((total, row) => total + row.quantity, 0),
  );
  const preservedOperatorCount = preservedOperatorLines.length;
  const preservedOperatorQuantity = preservedOperatorLines.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const unresolvedAutomaticCount = unresolvedAutomaticLines.length;
  const unresolvedAutomaticQuantity = unresolvedAutomaticLines.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const newSourcingCount = sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (Array.isArray(row.selectedVariants) ? row.selectedVariants.length : 0),
    0,
  ) ?? 0;
  const newSourcingQuantity = sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (Array.isArray(row.selectedVariants)
      ? row.selectedVariants.reduce((sum, variant) => sum + variant.quantity, 0)
      : 0),
    0,
  ) ?? 0;

  return {
    existingReorderCount,
    existingReorderQuantity,
    preservedSourcingCount,
    preservedSourcingQuantity,
    preservedOperatorCount,
    preservedOperatorQuantity,
    unresolvedAutomaticCount,
    unresolvedAutomaticQuantity,
    newSourcingCount,
    newSourcingQuantity,
    finalLineCount:
      existingReorderCount +
      preservedSourcingCount +
      preservedOperatorCount +
      unresolvedAutomaticCount +
      newSourcingCount,
    finalQuantity:
      existingReorderQuantity +
      preservedSourcingQuantity +
      preservedOperatorQuantity +
      unresolvedAutomaticQuantity +
      newSourcingQuantity,
  };
}

export function canRecalculateWithPreservedSourcingOnly(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null,
) {
  if (
    !report.replacementDraftId ||
    report.sourcingBudgetPercent <= 0 ||
    !report.preservedReplacementLines.some((row) => row.preserveOnRegeneration === true) ||
    report.replacementAudit?.complete !== true ||
    !sourcingPlan ||
    sourcingPlan.targetCycleMonth !== report.targetCycleMonth ||
    sourcingPlan.totalCashKrw !== report.effectiveCashKrw ||
    sourcingPlan.sourcingBudgetPercent !== report.sourcingBudgetPercent ||
    sourcingPlan.sourcingBudgetKrw !== report.sourcingBudgetKrw
  ) {
    return false;
  }
  if (
    sourcingPlan.preferredConceptIds.length > 0 ||
    sourcingPlan.variantSelections.length > 0 ||
    (sourcingPlan.reusedConfirmedVariants?.length ?? 0) > 0
  ) {
    return false;
  }
  return sourcingPlan.allocation.selected.length === 0 && sourcingPlan.blockers.every(
    (code) => PRESERVED_SOURCING_ONLY_BLOCKERS.has(code),
  );
}

export function explicitSourcingReplacementScope(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null,
  input: {
    startNewRun?: boolean;
    sourcingSelectionMode?: "automatic" | "custom";
    preferredSourcingConceptIds?: string[];
  },
) {
  const active = Boolean(
    input.startNewRun === true &&
    input.sourcingSelectionMode === "custom" &&
    (input.preferredSourcingConceptIds?.length ?? 0) > 0 &&
    sourcingPlan,
  );
  if (!active || !sourcingPlan) {
    return {
      active: false,
      excludedBarcodes: [] as string[],
      restoredReusedBarcodes: [] as string[],
      missingReusedBarcodes: [] as string[],
      conflictingReusedBarcodes: [] as string[],
      unexpectedPreservedBarcodes: [] as string[],
    };
  }
  const preservedBarcodes = new Set(
    (report.preservedReplacementLines ?? [])
      .filter((row) => row.preserveOnRegeneration === true)
      .map((row) => row.barcode),
  );
  const nonSourcingReplacementBarcodes = new Set(
    (report.preservedReplacementLines ?? [])
      .filter((row) => row.preserveOnRegeneration !== true)
      .map((row) => row.barcode),
  );
  const selectedBarcodes = new Set(report.selected.map((row) => row.barcode));
  const reusedBarcodes = new Set(
    (sourcingPlan.reusedConfirmedVariants ?? []).map((row) => row.barcode),
  );
  const reconstructableReusedBarcodes = new Set(
    (sourcingPlan.reusedConfirmedVariants ?? [])
      .filter((row) =>
        /^B[A-Z]{2}\d+-\d+$/.test(row.barcode) &&
        Number.isSafeInteger(row.quantity) &&
        row.quantity > 0 &&
        row.productName.trim().length > 0
      )
      .map((row) => row.barcode),
  );
  const conflictingReusedBarcodes = [...reusedBarcodes].filter(
    (barcode) => selectedBarcodes.has(barcode) || nonSourcingReplacementBarcodes.has(barcode),
  ).sort();
  return {
    active: true,
    excludedBarcodes: [...preservedBarcodes].filter((barcode) => !reusedBarcodes.has(barcode)).sort(),
    restoredReusedBarcodes: [...reusedBarcodes].filter(
      (barcode) =>
        !preservedBarcodes.has(barcode) &&
        !selectedBarcodes.has(barcode) &&
        !nonSourcingReplacementBarcodes.has(barcode) &&
        reconstructableReusedBarcodes.has(barcode),
    ).sort(),
    missingReusedBarcodes: [...reusedBarcodes].filter(
      (barcode) =>
        !preservedBarcodes.has(barcode) &&
        !selectedBarcodes.has(barcode) &&
        !nonSourcingReplacementBarcodes.has(barcode) &&
        !reconstructableReusedBarcodes.has(barcode),
    ).sort(),
    conflictingReusedBarcodes,
    unexpectedPreservedBarcodes: [...preservedBarcodes].filter((barcode) => !reusedBarcodes.has(barcode)).sort(),
  };
}

export function preparePurchaseCycleDraft(
  report: PurchaseCyclePreflightReport,
  request: PurchaseCycleDraftRequest,
  sourcingPlan: SourcingBudgetPlan | null = null,
  behavior: { preserveExistingSourcingOnly?: boolean } = {},
): {
  cycleMonth: string;
  sourceFingerprint: string;
  lines: FastPurchaseInternalDraftLine[];
} {
  if (
    request.targetDate !== report.targetDate ||
    (request.cashLimitKrw ?? null) !== report.cashLimitKrw ||
    (request.sourcingBudgetPercent ?? 0) !== report.sourcingBudgetPercent ||
    request.expectedPlanFingerprint !== report.planFingerprint ||
    (request.replaceDraftId ?? null) !== (report.replacementDraftId ?? null) ||
    JSON.stringify(sortedStrings(request.excludedBarcodes)) !==
      JSON.stringify(report.operatorExcludedBarcodes) ||
    JSON.stringify(sortedQuantityOverrides(request.quantityOverrides)) !==
      JSON.stringify(report.operatorQuantityOverrides) ||
    JSON.stringify(sortedStrings(request.releasedQuantityOverrideBarcodes)) !==
      JSON.stringify(report.operatorReleasedQuantityOverrideBarcodes ?? []) ||
    !FINGERPRINT.test(request.expectedSourceFingerprint) ||
    !FINGERPRINT.test(request.expectedPlanFingerprint)
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED");
  }
  const preserveExistingSourcingOnly =
    behavior.preserveExistingSourcingOnly === true && Boolean(request.replaceDraftId);
  if (report.sourcingBudgetPercent > 0 && !preserveExistingSourcingOnly) {
    const selectedSourcingVariantCount = sourcingPlan?.allocation.selected.reduce(
      (total, row) => total + row.selectedVariants.length,
      0,
    ) ?? 0;
    const reusedSourcingVariantCount = sourcingPlan?.reusedConfirmedVariants?.length ?? 0;
    if (
      !sourcingPlan ||
      sourcingPlan.readyForConfirmation !== true ||
      sourcingPlan.targetCycleMonth !== report.targetCycleMonth ||
      sourcingPlan.totalCashKrw !== report.effectiveCashKrw ||
      sourcingPlan.sourcingBudgetPercent !== report.sourcingBudgetPercent ||
      sourcingPlan.sourcingBudgetKrw !== report.sourcingBudgetKrw ||
      !sameSourcingSelection(sourcingPlan, request) ||
      selectedSourcingVariantCount + reusedSourcingVariantCount < 1 ||
      !FINGERPRINT.test(request.expectedSourcingSourceFingerprint ?? "") ||
      !FINGERPRINT.test(request.expectedSourcingPlanFingerprint ?? "") ||
      !FINGERPRINT.test(request.expectedSourcingDecisionFingerprint ?? "") ||
      request.expectedSourcingDecisionFingerprint !== sourcingBudgetDecisionFingerprint(sourcingPlan)
    ) {
      throw new Error("PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY");
    }
    const explicitScope = explicitSourcingReplacementScope(report, sourcingPlan, request);
    if (
      explicitScope.active &&
      (
        explicitScope.missingReusedBarcodes.length > 0 ||
        explicitScope.conflictingReusedBarcodes.length > 0 ||
        explicitScope.unexpectedPreservedBarcodes.length > 0
      )
    ) {
      throw new Error("PURCHASE_CYCLE_SOURCING_REUSE_SCOPE_MISMATCH");
    }
  } else if (!preserveExistingSourcingOnly && (
    request.expectedSourcingSourceFingerprint ||
    request.expectedSourcingPlanFingerprint ||
    request.expectedSourcingDecisionFingerprint
  )) {
    throw new Error("PURCHASE_CYCLE_SOURCING_PLAN_UNEXPECTED");
  }
  if (
    report.previewReady !== true ||
    report.blockers.length > 0 ||
    report.candidateCoverageComplete !== true ||
    report.accountedCandidateCount !== report.candidateCount ||
    report.selected.length < 1 ||
    report.selected.length > 100 ||
    report.estimatedSpendKrw <= 0 ||
    report.estimatedSpendKrw > report.effectiveBudgetKrw
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_NOT_READY");
  }
  if (
    report.reviewBlockers.includes(
      "EXISTING_DRAFT_RECOMMENDATION_REVIEW_REQUIRED",
    )
  ) {
    throw new Error("PURCHASE_DRAFT_REPLACEMENT_SOURCE_REVIEW_REQUIRED");
  }
  if (report.replacementDraftId && report.replacementAudit?.complete !== true) {
    throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
  }
  if (
    report.businessWritesEnabled !== false ||
    report.approvalEnabled !== false ||
    report.actualPurchaseExecuted !== false ||
    report.scheduledExecution !== false
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_EXECUTION_BOUNDARY_CHANGED");
  }
  if (request.confirmation !== purchaseCycleDraftConfirmation(report, sourcingPlan)) {
    throw new Error("PURCHASE_CYCLE_DRAFT_CONFIRMATION_REQUIRED");
  }
  const explicitScope = explicitSourcingReplacementScope(report, sourcingPlan, request);
  const restoredReusedBarcodeSet = new Set(explicitScope.restoredReusedBarcodes);
  const restoredReusedReservations = (sourcingPlan?.reusedConfirmedVariants ?? []).filter(
    (row) => restoredReusedBarcodeSet.has(row.barcode),
  );

  return {
    cycleMonth: report.targetCycleMonth,
    sourceFingerprint: report.planFingerprint,
    lines: [
      ...report.selected.map((row) => ({
      barcode: row.barcode,
      modelNo: null,
      productName: row.name,
      plannedQuantity: row.quantity,
      // Provisional zero is not a physical stockout confirmation.
      stockSense: "LOW" as const,
      referenceDemandQuantity: row.originalRecommendedQuantity,
      note: `발주 사전점검 · 정책 v${report.purchaseStrategyConfigVersion ?? "미확인"} · 최근 12개월 매출기준 ${row.revenueQualificationLabel} · 12개월 월평균매출 ${row.averageMonthlyRevenueKrw}원 · 목표재고 ${row.targetCoverageMonths}개월${row.newProduct ? " · NEW" : ""}${row.risingStrength !== "NONE" ? ` · Rising ${row.risingStrength}` : ""}${row.manualHeroCoverageReview ? " · 효자상품 5~6개월 수동검토" : ""} · 클레임 ${Number.isFinite(Number(row.weightedClaimRate)) ? Number(row.weightedClaimRate).toFixed(1) : "0.0"}% · 신규소싱 ${report.sourcingBudgetPercent}% 최대 · 실제 예약 ${report.sourcingBudgetKrw - report.sourcingBudgetReturnKrw}원 · ${row.costEvidenceSource} · 권장 ${row.originalRecommendedQuantity} → 현금반영 ${row.quantity} · ${row.cashflowTier} · 계획재고 ${row.inventoryQuantity} · 미입고 ${row.openCommitment}`,
      })),
      ...(report.preservedReplacementLines ?? []).map((row) => ({
        barcode: row.barcode,
        modelNo: null,
        productName: row.name,
        plannedQuantity: row.quantity,
        stockSense: "LOW" as const,
        referenceDemandQuantity: row.quantity,
        note: row.preserveOnRegeneration === true
          ? "기존 Draft 신규소싱 확정 상품 유지 · 운영자 제외 시에만 제거"
          : report.operatorQuantityOverrides.some(
                (override) => override.barcode === row.barcode,
              )
            ? "기존 Draft 운영자 고정수량 유지 · 5-1 원가·운임 기록에서 실제 위안단가 확인 필요"
            : row.recoveredFromPredecessor === true
              ? "이전 Draft 자동추천 복구 후보 · 최신 판매·재고 근거 확인 전 저장 금지"
              : "최신 자동추천 입력 대기 · 대략 재고를 선택하고 5-1에서 실제 위안단가·운임 확인 필요",
      })),
      ...restoredReusedReservations.map((row) => ({
        barcode: row.barcode,
        modelNo: null,
        productName: row.productName,
        plannedQuantity: row.quantity,
        stockSense: "LOW" as const,
        referenceDemandQuantity: row.quantity,
        note: "기존 확정 신규소싱 예약에서 복구 · 이번 수동 선택에만 포함",
      })),
    ],
  };
}
