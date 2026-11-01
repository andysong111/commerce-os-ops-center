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
};
export type ShoplingStockRetransmissionRequest = {
  requestId: string;
  occurredAt: string;
  reportFingerprint: string;
  reason: string;
  items: ShoplingStockRetransmissionItem[];
};

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
