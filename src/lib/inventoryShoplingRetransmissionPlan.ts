export type RetransmissionPlanRow = {
  barcode: string;
  productName: string;
  modelNo: string | null;
  productKind: "OPTION" | "SINGLE";
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  desiredSince: string;
  syncNeeded: boolean;
  syncBlocked: boolean;
  inventoryQuantityKnown?: boolean;
  manualStatusOnly?: boolean;
  salesCoverageReady: boolean;
};

export type RetransmissionItemMode = "REPLAY" | "EXISTING_PENDING";
export type ShoplingStockRetransmissionItem = {
  jobId: string;
  barcode: string;
  productName: string;
  modelNo: string | null;
  productKind: "OPTION" | "SINGLE";
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  desiredSince: string;
  mode: RetransmissionItemMode;
  directOperatorCommand?: boolean;
};
export type ShoplingStockRetransmissionRequest = {
  requestId: string;
  occurredAt: string;
  reportFingerprint: string;
  reason: string;
  items: ShoplingStockRetransmissionItem[];
};

export type RetransmissionCurrentIdentity = {
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  productKind: "OPTION" | "SINGLE";
  desiredSince: string;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

const CANONICAL_COVERAGE_BLOCK_REASON =
  "품절 초기화 이후의 Canonical 판매 범위를 완전히 확인하지 못했습니다.";

export function isCurrentShoplingRetransmissionIdentity(
  current: RetransmissionCurrentIdentity | undefined,
  item: Pick<
    ShoplingStockRetransmissionItem,
    | "desiredStatus"
    | "productKind"
    | "desiredSince"
    | "directOperatorCommand"
  >,
) {
  if (
    !current ||
    current.desiredStatus !== item.desiredStatus ||
    current.productKind !== item.productKind ||
    current.desiredSince !== item.desiredSince
  ) {
    return false;
  }
  if (!current.syncBlocked) return true;
  return Boolean(
    item.directOperatorCommand === true &&
      current.syncBlockReason === CANONICAL_COVERAGE_BLOCK_REASON,
  );
}

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function buildShoplingStockRetransmissionRequest(
  report: {
    state: "READY" | "BLOCKED";
    fingerprint: string;
    rows: RetransmissionPlanRow[];
  },
  requestId: string,
  occurredAt: string,
  reason: string,
): ShoplingStockRetransmissionRequest {
  if (report.state !== "READY") {
    throw new Error("정확재고 원장이 READY가 아니므로 재전송 목록을 만들 수 없습니다.");
  }
  const eligible = report.rows.filter(
    (row) =>
      !row.syncBlocked &&
      (row.manualStatusOnly === true ||
        (row.inventoryQuantityKnown !== false && row.salesCoverageReady)),
  );
  if (!eligible.length) {
    throw new Error("현재 확정된 품절·판매중 재전송 대상이 없습니다.");
  }
  const safeRequestId = clean(requestId).replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 180);
  if (!safeRequestId) throw new Error("재전송 요청번호가 없습니다.");
  return {
    requestId: safeRequestId,
    occurredAt,
    reportFingerprint: report.fingerprint,
    reason: clean(reason).slice(0, 500),
    items: eligible
      .map((row) => {
        const mode: RetransmissionItemMode = row.syncNeeded
          ? "EXISTING_PENDING"
          : "REPLAY";
        return {
          jobId:
            mode === "EXISTING_PENDING"
              ? `stock-sync:${row.barcode}:${row.desiredStatus}:${row.desiredSince}`
              : `stock-resend:${safeRequestId}:${row.barcode}:${row.desiredStatus}`,
          barcode: row.barcode,
          productName: row.productName,
          modelNo: row.modelNo,
          productKind: row.productKind,
          desiredStatus: row.desiredStatus,
          desiredSince: row.desiredSince,
          mode,
        };
      })
      .sort((left, right) => left.barcode.localeCompare(right.barcode, "ko")),
  };
}
