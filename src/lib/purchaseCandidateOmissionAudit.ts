export type PurchaseCandidateOmissionReason =
  | "PURCHASE_SHADOW_ROW_MISSING"
  | "SALES_ITEM_DATA_HOLD"
  | "SOLD_OUT_ACTIVE_SALES_NOT_RECOMMENDED"
  | "SHOPLING_ZERO_LEDGER_POSITIVE"
  | "RECOMMENDATION_EVIDENCE_BLOCKED"
  | "SUPPLIER_LINK_MISSING"
  | "CHINA_OPTION_MISSING"
  | "SOURCE_METADATA_CONFLICT";

export type PurchaseCandidateOmissionReviewRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  severity: "BLOCKING" | "PREPARATION";
  reasons: PurchaseCandidateOmissionReason[];
  salesQuantity30: number;
  salesQuantity90: number;
  salesQuantity365: number;
  planningInventoryQuantity: number;
  ledgerInventoryQuantity: number | null;
  shoplingQuantity: number | null;
  shoplingSyncedAt: string | null;
  purchaseStatus: string | null;
  recommendedQuantity: number;
  openCommitment: number;
};

type PlanningProduct = {
  barcode?: unknown;
  modelNo?: unknown;
  productName?: unknown;
  skuActive?: boolean;
  inventoryQuantity?: unknown;
  salesQuantity30?: unknown;
  salesQuantity90?: unknown;
  salesQuantity365?: unknown;
  orderDecision?: unknown;
  recommendedOrderQuantity?: unknown;
};

type PriorityRow = {
  barcode: string;
  purchaseStatus: string;
  originalPurchaseStatus?: string;
  recommendedQty: number;
  openCommitment: number;
};

type InventoryRow = {
  inventoryQuantity: number;
};

type SourceMetadata = {
  supplierLink: string;
  chinaOption: string;
  conflict: boolean;
  shoplingQuantity: number | null;
  shoplingSyncedAt: string | null;
};

export type PurchaseCandidateOmissionAuditInput = {
  planningProducts: PlanningProduct[];
  priorityRows: PriorityRow[];
  inventoryByBarcode: Map<string, InventoryRow>;
  sourceMetadataByBarcode: Map<string, SourceMetadata>;
  sourceMetadataAvailable: boolean;
};

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function planningRecommendsOrder(product: PlanningProduct) {
  const decision = text(product.orderDecision).toUpperCase();
  return (
    quantity(product.recommendedOrderQuantity) > 0 ||
    decision.includes("발주 추천") ||
    decision.includes("RECOMMEND") ||
    decision === "ORDER"
  );
}

export function buildPurchaseCandidateOmissionReview(
  input: PurchaseCandidateOmissionAuditInput,
): PurchaseCandidateOmissionReviewRow[] {
  const priorityByBarcode = new Map(
    input.priorityRows.map((row) => [barcode(row.barcode), row] as const),
  );
  const result: PurchaseCandidateOmissionReviewRow[] = [];

  for (const product of input.planningProducts) {
    const key = barcode(product.barcode);
    if (!MANAGED_BARCODE.test(key) || product.skuActive === false) continue;
    const salesQuantity30 = quantity(product.salesQuantity30);
    const salesQuantity90 = quantity(product.salesQuantity90);
    const salesQuantity365 = quantity(product.salesQuantity365);
    if (salesQuantity30 + salesQuantity90 + salesQuantity365 <= 0) continue;

    const priority = priorityByBarcode.get(key);
    const inventory = input.inventoryByBarcode.get(key);
    const metadata = input.sourceMetadataByBarcode.get(key);
    const recentSales = salesQuantity30 > 0 || salesQuantity90 > 0;
    const recommendedQuantity = priority
      ? quantity(priority.recommendedQty)
      : quantity(product.recommendedOrderQuantity);
    const openCommitment = quantity(priority?.openCommitment);
    const accountedAsCandidate = Boolean(
      priority?.purchaseStatus === "발주 추천" && recommendedQuantity > 0,
    );
    const reasons: PurchaseCandidateOmissionReason[] = [];
    let blocking = false;

    if (!priority) {
      reasons.push("PURCHASE_SHADOW_ROW_MISSING");
      blocking ||= recentSales || planningRecommendsOrder(product);
    }
    if (
      priority &&
      [priority.purchaseStatus, priority.originalPurchaseStatus].some(
        (status) => text(status).includes("데이터 부족"),
      )
    ) {
      reasons.push("SALES_ITEM_DATA_HOLD");
      blocking ||= recentSales;
    }
    if (planningRecommendsOrder(product) && !accountedAsCandidate) {
      reasons.push("RECOMMENDATION_EVIDENCE_BLOCKED");
      blocking = true;
    }
    if (
      recentSales &&
      quantity(product.inventoryQuantity) === 0 &&
      openCommitment === 0 &&
      !accountedAsCandidate
    ) {
      reasons.push("SOLD_OUT_ACTIVE_SALES_NOT_RECOMMENDED");
      blocking = true;
    }
    if (
      metadata?.shoplingQuantity === 0 &&
      quantity(inventory?.inventoryQuantity) > 0
    ) {
      reasons.push("SHOPLING_ZERO_LEDGER_POSITIVE");
      blocking = true;
    }
    if (input.sourceMetadataAvailable) {
      if (!metadata?.supplierLink) reasons.push("SUPPLIER_LINK_MISSING");
      if (!metadata?.chinaOption) reasons.push("CHINA_OPTION_MISSING");
      if (metadata?.conflict) reasons.push("SOURCE_METADATA_CONFLICT");
    }
    if (!reasons.length) continue;

    result.push({
      barcode: key,
      modelNo: text(product.modelNo) || null,
      productName: text(product.productName) || key,
      severity: blocking ? "BLOCKING" : "PREPARATION",
      reasons,
      salesQuantity30,
      salesQuantity90,
      salesQuantity365,
      planningInventoryQuantity: quantity(product.inventoryQuantity),
      ledgerInventoryQuantity: inventory
        ? quantity(inventory.inventoryQuantity)
        : null,
      shoplingQuantity: metadata?.shoplingQuantity ?? null,
      shoplingSyncedAt: metadata?.shoplingSyncedAt ?? null,
      purchaseStatus: priority?.purchaseStatus ?? null,
      recommendedQuantity,
      openCommitment,
    });
  }

  return result.sort(
    (left, right) =>
      Number(right.severity === "BLOCKING") -
        Number(left.severity === "BLOCKING") ||
      right.salesQuantity365 - left.salesQuantity365 ||
      right.salesQuantity90 - left.salesQuantity90 ||
      left.barcode.localeCompare(right.barcode),
  );
}
