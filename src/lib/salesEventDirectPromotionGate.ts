import { createHash } from "node:crypto";
import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";

export type SalesEventDirectPromotionMode = "canary" | "full";

export type SalesEventDirectPromotionGate = {
  generatedAt: string;
  state: "BLOCKED" | "CANDIDATE_CLEAN" | "CANARY_VERIFIED";
  safeToApply: boolean;
  candidateSalesRequestId: string | null;
  candidatePlanFingerprint: string | null;
  candidateEventFingerprint: string | null;
  candidateParityFingerprint: null;
  evidenceFingerprint: null;
  promotionFingerprint: string | null;
  message: string;
};

function promotionFingerprint(input: {
  mode: SalesEventDirectPromotionMode;
  requestId: string;
  planFingerprint: string;
  eventFingerprint: string;
  sourceEventCount: number;
  canaryVerified: boolean;
}) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")}`;
}

/**
 * Monthly purchase preparation already builds a deterministic sales-event plan,
 * rejects unmapped/ambiguous rows, and rebuilds the plan immediately before a
 * write. The operator-confirmed canary plus Product Master readback is the
 * promotion boundary. The historical 360-day direct-parity rescan remains an
 * optional diagnostic and no longer blocks an ordinary monthly purchase run.
 */
export async function loadSalesEventDirectPromotionGate(
  mode: SalesEventDirectPromotionMode,
): Promise<SalesEventDirectPromotionGate> {
  const status = await loadProductMasterShoplingSalesEventSyncStatus();
  const report = status.report;
  const expectedState = mode === "canary" ? "READY_CANARY" : "READY_FULL";
  const ready =
    status.configured &&
    status.state === expectedState &&
    Boolean(status.requestId) &&
    Boolean(report) &&
    report!.unmappedRows === 0 &&
    report!.identityConflictCount === 0 &&
    (mode === "canary" || status.canaryVerified);

  if (!ready || !status.requestId || !report) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      safeToApply: false,
      candidateSalesRequestId: status.requestId,
      candidatePlanFingerprint: report?.planFingerprint ?? null,
      candidateEventFingerprint: report?.eventFingerprint ?? null,
      candidateParityFingerprint: null,
      evidenceFingerprint: null,
      promotionFingerprint: null,
      message:
        mode === "canary"
          ? `판매 후보가 카나리 준비 상태가 아닙니다: ${status.state}`
          : `검증된 1건 카나리가 없어 전체 반영을 차단합니다: ${status.state}`,
    };
  }

  const state = mode === "canary" ? "CANDIDATE_CLEAN" : "CANARY_VERIFIED";
  return {
    generatedAt: new Date().toISOString(),
    state,
    safeToApply: true,
    candidateSalesRequestId: status.requestId,
    candidatePlanFingerprint: report.planFingerprint,
    candidateEventFingerprint: report.eventFingerprint,
    candidateParityFingerprint: null,
    evidenceFingerprint: null,
    promotionFingerprint: promotionFingerprint({
      mode,
      requestId: status.requestId,
      planFingerprint: report.planFingerprint,
      eventFingerprint: report.eventFingerprint,
      sourceEventCount: report.sourceEventCount,
      canaryVerified: status.canaryVerified,
    }),
    message:
      mode === "canary"
        ? "미연결·identity 충돌이 없는 판매 후보입니다. 1건 카나리 적재가 가능합니다."
        : "같은 판매 후보의 1건 카나리 검증이 끝나 전체 적재가 가능합니다.",
  };
}
