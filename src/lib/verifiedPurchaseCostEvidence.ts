export type VerifiedPurchaseCostContract = {
  hasVerifiedPurchaseCost?: unknown;
  purchaseCostTrustSource?: unknown;
  verifiedPurchaseUnitCostKrw?: unknown;
  purchaseProtectedCostKrw?: unknown;
  verifiedPurchaseCostAt?: unknown;
  hasConfirmedReceiptCost?: unknown;
  latestConfirmedReceiptCostKrw?: unknown;
  purchaseCostEvidenceCount?: unknown;
};

export const VERIFIED_PURCHASE_COST_SOURCES = [
  "CONFIRMED_RECEIPT",
  "LEGACY_VERIFIED_COST_EVIDENCE",
  "SOURCE_ORDER_VERIFIED_COST_EVIDENCE",
] as const;

const VERIFIED_PURCHASE_COST_SOURCE_SET = new Set<string>(
  VERIFIED_PURCHASE_COST_SOURCES,
);

function safePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function safeNonnegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function verifiedPurchaseCostReady(
  row: VerifiedPurchaseCostContract | null | undefined,
  now: number,
) {
  if (!row || row.hasVerifiedPurchaseCost !== true) return false;
  if (
    typeof row.purchaseCostTrustSource !== "string" ||
    !VERIFIED_PURCHASE_COST_SOURCE_SET.has(row.purchaseCostTrustSource)
  ) {
    return false;
  }
  if (
    !safePositiveInteger(row.verifiedPurchaseUnitCostKrw) ||
    !safeNonnegativeInteger(row.purchaseProtectedCostKrw) ||
    row.purchaseProtectedCostKrw < row.verifiedPurchaseUnitCostKrw
  ) {
    return false;
  }
  if (typeof row.verifiedPurchaseCostAt !== "string") return false;
  const evidenceTime = Date.parse(row.verifiedPurchaseCostAt);
  if (!Number.isFinite(evidenceTime) || evidenceTime > now) return false;

  if (row.purchaseCostTrustSource === "CONFIRMED_RECEIPT") {
    return (
      row.hasConfirmedReceiptCost === true &&
      safePositiveInteger(row.latestConfirmedReceiptCostKrw) &&
      row.latestConfirmedReceiptCostKrw === row.verifiedPurchaseUnitCostKrw
    );
  }

  return (
    row.hasConfirmedReceiptCost === false &&
    safePositiveInteger(row.purchaseCostEvidenceCount)
  );
}

export type Stage7PurchaseCostCoverage = {
  state: "READY" | "WAITING" | "BLOCKED";
  candidateCount: number;
  verifiedCount: number;
  missingCount: number;
};

export function stage7PurchaseCostCoverage(
  priorityState: "READY" | "BLOCKED",
  candidates: readonly VerifiedPurchaseCostContract[],
  now: number,
): Stage7PurchaseCostCoverage {
  const verifiedCount = candidates.filter((row) =>
    verifiedPurchaseCostReady(row, now),
  ).length;
  const candidateCount = candidates.length;
  const missingCount = candidateCount - verifiedCount;
  const state =
    priorityState !== "READY"
      ? "BLOCKED"
      : candidateCount === 0
        ? "WAITING"
        : missingCount === 0
          ? "READY"
          : "BLOCKED";
  return { state, candidateCount, verifiedCount, missingCount };
}
