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
  state: "READY" | "BLOCKED";
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
  return {
    generatedAt: new Date().toISOString(),
    state: priority.state === "READY" ? "READY" : "BLOCKED",
    message:
      "Product Master의 확정입고원가 또는 A등급 구매전용 원가근거만 VERIFIED로 인정합니다. 상품출시 화면의 수기 원가·과거 캐시·계획 원가는 근거가 연결되기 전까지 자동 승격하지 않습니다.",
    purchaseCandidateCount: rows.length,
    verifiedPurchaseCostCount: verified.length,
    missingVerifiedPurchaseCostCount: rows.length - verified.length,
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
