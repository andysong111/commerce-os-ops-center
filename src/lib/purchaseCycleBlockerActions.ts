import type { PurchaseCandidateOmissionReviewRow } from "./purchaseCandidateOmissionAudit.ts";

export type PurchaseCycleRoughStockTarget = {
  barcode: string;
  productName: string;
};

export type PurchaseCycleBlockerAction = {
  title: string;
  message: string;
  href?: string;
  hrefLabel?: string;
  roughStockTargets?: PurchaseCycleRoughStockTarget[];
};

type PurchaseCycleBlockerActionReport = {
  blockers: string[];
  omissionReview: PurchaseCandidateOmissionReviewRow[];
};

const SALES_SOURCE_BLOCKERS = new Set([
  "SOURCE_CHANGED_OR_MISSING",
  "SALES_SOURCE_STALE_OR_FUTURE",
  "SALES_PROMOTION_NOT_VERIFIED",
  "PRODUCT_MASTER_FULL_READBACK_REQUIRED",
  "PURCHASE_SOURCE_CONTEXT_MISMATCH",
  "PURCHASE_SHADOW_NOT_READY",
]);

const INVENTORY_SOURCE_BLOCKERS = new Set([
  "INVENTORY_EVIDENCE_STALE_OR_UNPINNED",
  "INVENTORY_PRIORITY_READ_FAILED",
]);

const omissionRowLabel = (row: PurchaseCandidateOmissionReviewRow) =>
  `${row.barcode} ${row.productName}`;

export function purchaseCycleBlockerActions(
  report: PurchaseCycleBlockerActionReport | null,
  explain: (code: string) => string,
): PurchaseCycleBlockerAction[] {
  if (!report?.blockers.length) return [];

  const actions: PurchaseCycleBlockerAction[] = [];
  const unhandled = new Set(report.blockers);

  if (unhandled.delete("PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED")) {
    const blockingRows = report.omissionReview.filter((row) => row.severity === "BLOCKING");
    const inventoryConflicts = blockingRows.filter((row) =>
      row.reasons.includes("SHOPLING_ZERO_LEDGER_POSITIVE"),
    );
    const otherBlockingRows = blockingRows.filter((row) =>
      !row.reasons.includes("SHOPLING_ZERO_LEDGER_POSITIVE"),
    );

    if (inventoryConflicts.length > 0) {
      const products = inventoryConflicts.slice(0, 5).map(omissionRowLabel).join(", ");
      const remainder = Math.max(0, inventoryConflicts.length - 5);
      actions.push({
        title: `재고 충돌 ${inventoryConflicts.length}종 확인`,
        message: `${products}${remainder ? ` 외 ${remainder}종` : ""}. 샵플링 재고는 0인데 재고원장은 양수입니다. 아래에서 대략재고를 선택하고 저장하면 같은 발주차시를 바로 다시 계산합니다. 판매자료를 다시 수집할 필요는 없습니다.`,
        roughStockTargets: inventoryConflicts.map((row) => ({
          barcode: row.barcode,
          productName: row.productName,
        })),
      });
    }

    if (otherBlockingRows.length > 0 || blockingRows.length === 0) {
      const products = otherBlockingRows.slice(0, 5).map(omissionRowLabel).join(", ");
      const remainder = Math.max(0, otherBlockingRows.length - 5);
      const reasons = [...new Set(otherBlockingRows.flatMap((row) => row.reasons))]
        .map(explain)
        .join(" ");
      actions.push({
        title: "발주후보 누락 근거 확인",
        message: otherBlockingRows.length > 0
          ? `${products}${remainder ? ` 외 ${remainder}종` : ""}. ${reasons} 아래 누락 검토표에서 상품별 근거를 확인한 뒤 다시 계산하세요.`
          : "판매 이력이 있는 상품의 발주후보 누락 근거가 남았습니다. 누락 검토표에서 상품별 사유를 확인한 뒤 다시 계산하세요.",
        href: "#purchase-omission-review",
        hrefLabel: "누락 검토표 보기",
      });
    }
  }

  const salesSourceCodes = [...unhandled].filter((code) => SALES_SOURCE_BLOCKERS.has(code));
  if (salesSourceCodes.length > 0) {
    salesSourceCodes.forEach((code) => unhandled.delete(code));
    actions.push({
      title: "최신 판매자료 준비",
      message: salesSourceCodes.map(explain).join(" "),
      href: "/stage8-sales-events",
      hrefLabel: "판매자료 상태 보기",
    });
  }

  const inventorySourceCodes = [...unhandled].filter((code) => INVENTORY_SOURCE_BLOCKERS.has(code));
  if (inventorySourceCodes.length > 0) {
    inventorySourceCodes.forEach((code) => unhandled.delete(code));
    actions.push({
      title: "재고 원본 준비 상태 확인",
      message: inventorySourceCodes.map(explain).join(" "),
      href: "/stage8-inventory-verification-priority",
      hrefLabel: "재고 검증 상태 보기",
    });
  }

  if (unhandled.size > 0) {
    actions.push({
      title: "발주안 안전조건 확인",
      message: [...unhandled].map(explain).join(" "),
    });
  }

  return actions;
}
