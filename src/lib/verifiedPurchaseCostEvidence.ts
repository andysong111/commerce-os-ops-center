export type VerifiedPurchaseCostContract = {
  hasVerifiedPurchaseCost?: unknown;
  purchaseCostTrustSource?: unknown;
  verifiedPurchaseUnitCostKrw?: unknown;
  purchaseProtectedCostKrw?: unknown;
  verifiedPurchaseCostAt?: unknown;
  hasConfirmedReceiptCost?: unknown;
  latestConfirmedReceiptAt?: unknown;
  latestConfirmedReceiptCostKrw?: unknown;
  protectedCostKrw?: unknown;
  purchaseCostEvidenceCount?: unknown;
  verifiedPurchaseCostReady?: unknown;
};

export const VERIFIED_PURCHASE_COST_SOURCES = [
  "CONFIRMED_RECEIPT",
  "LEGACY_VERIFIED_COST_EVIDENCE",
  "SOURCE_ORDER_VERIFIED_COST_EVIDENCE",
] as const;

const VERIFIED_PURCHASE_COST_SOURCE_SET = new Set<string>(
  VERIFIED_PURCHASE_COST_SOURCES,
);

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function notFutureTimestamp(value: unknown, now: number) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now;
}

export function usesCanonicalPurchaseCostContract(
  row: VerifiedPurchaseCostContract | null | undefined,
) {
  return Boolean(
    row &&
      (row.hasVerifiedPurchaseCost !== undefined ||
        row.purchaseCostTrustSource !== undefined ||
        row.verifiedPurchaseUnitCostKrw !== undefined ||
        row.purchaseProtectedCostKrw !== undefined ||
        row.verifiedPurchaseCostAt !== undefined ||
        row.purchaseCostEvidenceCount !== undefined),
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
    !positiveInteger(row.verifiedPurchaseUnitCostKrw) ||
    !nonnegativeInteger(row.purchaseProtectedCostKrw) ||
    row.purchaseProtectedCostKrw < row.verifiedPurchaseUnitCostKrw
  ) {
    return false;
  }
  if (!notFutureTimestamp(row.verifiedPurchaseCostAt, now)) return false;

  if (row.purchaseCostTrustSource === "CONFIRMED_RECEIPT") {
    return (
      row.hasConfirmedReceiptCost === true &&
      positiveInteger(row.latestConfirmedReceiptCostKrw) &&
      row.latestConfirmedReceiptCostKrw === row.verifiedPurchaseUnitCostKrw
    );
  }

  return (
    row.hasConfirmedReceiptCost === false &&
    positiveInteger(row.purchaseCostEvidenceCount)
  );
}

export function legacyConfirmedReceiptPurchaseCostReady(
  row: VerifiedPurchaseCostContract | null | undefined,
  now: number,
) {
  return Boolean(
    row &&
      row.hasConfirmedReceiptCost === true &&
      positiveInteger(row.latestConfirmedReceiptCostKrw) &&
      nonnegativeInteger(row.protectedCostKrw) &&
      notFutureTimestamp(row.latestConfirmedReceiptAt, now),
  );
}

export function purchaseCostReadyForExecution(
  row: VerifiedPurchaseCostContract | null | undefined,
  now: number,
) {
  if (!row) return false;
  if (typeof row.verifiedPurchaseCostReady === "boolean") {
    return row.verifiedPurchaseCostReady;
  }
  return usesCanonicalPurchaseCostContract(row)
    ? verifiedPurchaseCostReady(row, now)
    : legacyConfirmedReceiptPurchaseCostReady(row, now);
}

export function effectivePurchaseUnitCostKrw(
  row: VerifiedPurchaseCostContract | null | undefined,
  now: number,
) {
  if (!purchaseCostReadyForExecution(row, now) || !row) return 0;
  if (usesCanonicalPurchaseCostContract(row)) {
    return Math.max(
      row.verifiedPurchaseUnitCostKrw as number,
      row.purchaseProtectedCostKrw as number,
    );
  }
  return Math.max(
    row.latestConfirmedReceiptCostKrw as number,
    row.protectedCostKrw as number,
  );
}

export function purchaseCostEvidenceSource(
  row: VerifiedPurchaseCostContract | null | undefined,
) {
  if (!row) return "UNVERIFIED";
  if (usesCanonicalPurchaseCostContract(row)) {
    return typeof row.purchaseCostTrustSource === "string"
      ? row.purchaseCostTrustSource
      : "UNVERIFIED";
  }
  return row.hasConfirmedReceiptCost === true
    ? "CONFIRMED_RECEIPT"
    : "UNVERIFIED";
}

export function purchaseCostEvidenceAt(
  row: VerifiedPurchaseCostContract | null | undefined,
) {
  if (!row) return null;
  if (usesCanonicalPurchaseCostContract(row)) {
    return typeof row.verifiedPurchaseCostAt === "string"
      ? row.verifiedPurchaseCostAt
      : null;
  }
  return typeof row.latestConfirmedReceiptAt === "string"
    ? row.latestConfirmedReceiptAt
    : null;
}

export type Stage7PurchaseCandidateContract = VerifiedPurchaseCostContract & {
  purchaseStatus?: unknown;
};

export type Stage7PurchaseCostCoverage = {
  state: "READY" | "WAITING" | "BLOCKED";
  candidateCount: number;
  verifiedCount: number;
  missingCount: number;
};

export function stage7PurchaseCostCandidates<
  T extends Stage7PurchaseCandidateContract,
>(rows: readonly T[]) {
  return rows.filter((row) => row.purchaseStatus === "발주 추천");
}

export function stage7PurchaseCostCoverage(
  priorityState: "READY" | "BLOCKED",
  rows: readonly Stage7PurchaseCandidateContract[],
  now: number,
): Stage7PurchaseCostCoverage {
  const candidates = stage7PurchaseCostCandidates(rows);
  const verifiedCount = candidates.filter((row) =>
    purchaseCostReadyForExecution(row, now),
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
