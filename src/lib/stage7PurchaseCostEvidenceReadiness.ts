import { createHash } from "node:crypto";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export type Stage7PurchaseCostEvidenceRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  recommendedQty: number;
  hasVerifiedPurchaseCost: boolean;
  purchaseCostTrustSource: string;
  verifiedPurchaseUnitCostKrw: number;
  purchaseProtectedCostKrw: number;
  verifiedPurchaseCostAt: string | null;
  hasConfirmedReceiptCost: boolean;
  purchaseCostEvidenceCount: number;
};

export type Stage7PurchaseCostEvidenceReadiness = {
  generatedAt: string;
  state: "READY" | "WAITING" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  verifiedPurchaseCostCount: number;
  missingVerifiedPurchaseCostCount: number;
  confirmedReceiptCount: number;
  legacyVerifiedCount: number;
  sourceOrderVerifiedCount: number;
  fingerprint: string;
  businessWritesEnabled: false;
  priceWritesEnabled: false;
  inventoryWritesEnabled: false;
  receiptWritesEnabled: false;
  rows: Stage7PurchaseCostEvidenceRow[];
};

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export async function loadStage7PurchaseCostEvidenceReadiness(): Promise<Stage7PurchaseCostEvidenceReadiness> {
  const priority = await loadInventoryVerificationPriority();
  const rows = priority.rows
    .filter((row) => row.purchaseStatus === "발주 추천")
    .map((row): Stage7PurchaseCostEvidenceRow => ({
      barcode: row.barcode,
      name: row.name,
      modelNo: row.modelNo,
      recommendedQty: integer(row.recommendedQty),
      hasVerifiedPurchaseCost: row.hasVerifiedPurchaseCost === true,
      purchaseCostTrustSource: row.purchaseCostTrustSource,
      verifiedPurchaseUnitCostKrw: integer(row.verifiedPurchaseUnitCostKrw),
      purchaseProtectedCostKrw: integer(row.purchaseProtectedCostKrw),
      verifiedPurchaseCostAt: row.verifiedPurchaseCostAt,
      hasConfirmedReceiptCost: row.hasConfirmedReceiptCost,
      purchaseCostEvidenceCount: integer(row.purchaseCostEvidenceCount),
    }))
    .sort(
      (left, right) =>
        Number(left.hasVerifiedPurchaseCost) -
          Number(right.hasVerifiedPurchaseCost) ||
        left.barcode.localeCompare(right.barcode),
    );

  const verified = rows.filter((row) => row.hasVerifiedPurchaseCost);
  const missingVerifiedPurchaseCostCount = rows.length - verified.length;
  const state =
    priority.state !== "READY"
      ? "BLOCKED"
      : rows.length === 0
        ? "WAITING"
        : missingVerifiedPurchaseCostCount === 0
          ? "READY"
          : "BLOCKED";
  const message =
    priority.state !== "READY"
      ? "상위 발주·재고 근거가 아직 READY가 아니므로 원가 구간도 차단합니다."
      : rows.length === 0
        ? "현재 발주 추천 후보가 없어 검증할 원가 대상이 없습니다. 후보가 생기면 다시 판정합니다."
        : missingVerifiedPurchaseCostCount === 0
          ? "현재 발주 추천 후보의 원가 근거가 모두 VERIFIED입니다. 확정입고원가 또는 A등급 구매전용 원가근거만 인정합니다."
          : `발주 추천 후보 ${rows.length}개 중 ${missingVerifiedPurchaseCostCount}개는 검증원가 근거가 없어 차단합니다. 상품출시 화면의 수기 원가·과거 캐시·계획 원가는 근거가 연결되기 전까지 자동 승격하지 않습니다.`;
  return {
    generatedAt: new Date().toISOString(),
    state,
    message,
    purchaseCandidateCount: rows.length,
    verifiedPurchaseCostCount: verified.length,
    missingVerifiedPurchaseCostCount,
    confirmedReceiptCount: rows.filter(
      (row) => row.purchaseCostTrustSource === "CONFIRMED_RECEIPT",
    ).length,
    legacyVerifiedCount: rows.filter(
      (row) =>
        row.purchaseCostTrustSource === "LEGACY_VERIFIED_COST_EVIDENCE",
    ).length,
    sourceOrderVerifiedCount: rows.filter(
      (row) =>
        row.purchaseCostTrustSource ===
        "SOURCE_ORDER_VERIFIED_COST_EVIDENCE",
    ).length,
    fingerprint: fingerprint({
      priorityGeneratedAt: priority.generatedAt,
      inventoryContentFingerprint:
        priority.source?.inventoryContentFingerprint ?? null,
      rows,
    }),
    businessWritesEnabled: false,
    priceWritesEnabled: false,
    inventoryWritesEnabled: false,
    receiptWritesEnabled: false,
    rows,
  };
}
