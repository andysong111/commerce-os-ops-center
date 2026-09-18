import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const sales = await loadProductMasterShoplingSalesEventSyncStatus();
    if (sales.state !== "COMPLETED") {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        state: "WAITING_FULL_APPLY",
        writesEnabled: false,
        approvalEnabled: false,
        message:
          "검증된 current candidate의 FULL Product Master 반영이 완료될 때까지 post-apply 발주 근거 점검을 대기합니다.",
        sales: {
          state: sales.state,
          requestId: sales.requestId,
          analysisAsOf: sales.analysisAsOf,
          planFingerprint: sales.report?.planFingerprint ?? null,
        },
      });
    }

    const reconciliation = await loadPostApplyCanonicalReconciliation();
    if (!reconciliation.ready) {
      return Response.json({
        ok: true,
        processed: true,
        busy: false,
        state:
          reconciliation.state === "WAITING"
            ? "WAITING_RECONCILIATION"
            : "BLOCKED_RECONCILIATION",
        writesEnabled: false,
        approvalEnabled: false,
        message: reconciliation.message,
        reconciliation: {
          state: reconciliation.state,
          ready: reconciliation.ready,
          candidateSalesRequestId: reconciliation.candidateSalesRequestId,
          analysisAsOf: reconciliation.analysisAsOf,
          candidatePlanFingerprint: reconciliation.candidatePlanFingerprint,
          persistedContentFingerprint:
            reconciliation.persistedContentFingerprint,
          reconciliationFingerprint:
            reconciliation.reconciliationFingerprint,
          fullApplyVerified: reconciliation.fullApplyVerified,
          rowMismatchCount: reconciliation.rowMismatchCount,
          missingPersistedCount: reconciliation.missingPersistedCount,
          extraPersistedNonZeroCount:
            reconciliation.extraPersistedNonZeroCount,
          failedChecks: reconciliation.checks.filter((check) => !check.passed),
        },
      });
    }

    const priority = await loadInventoryVerificationPriority();
    const source = priority.source ?? null;
    const ready =
      priority.state === "READY" &&
      priority.purchaseShadowReady === true &&
      Boolean(source?.inventoryGeneratedAt) &&
      Boolean(source?.inventoryContentFingerprint) &&
      source?.reconciliationFingerprint ===
        reconciliation.reconciliationFingerprint;

    return Response.json({
      ok: true,
      processed: true,
      busy: false,
      state: ready ? "READY_PURCHASE_EVIDENCE" : "BLOCKED_PURCHASE_EVIDENCE",
      writesEnabled: false,
      approvalEnabled: false,
      purchaseDraftEnabled: false,
      message: ready
        ? "공식 판매원장 재조회와 현재 재고·원가·발주 Shadow가 같은 원본으로 연결됐습니다. 실제 발주 미리보기와 승인은 별도입니다."
        : priority.message,
      reconciliation: {
        state: reconciliation.state,
        candidateSalesRequestId: reconciliation.candidateSalesRequestId,
        analysisAsOf: reconciliation.analysisAsOf,
        candidatePlanFingerprint: reconciliation.candidatePlanFingerprint,
        persistedContentFingerprint:
          reconciliation.persistedContentFingerprint,
        reconciliationFingerprint:
          reconciliation.reconciliationFingerprint,
      },
      purchaseEvidence: {
        state: priority.state,
        purchaseShadowReady: priority.purchaseShadowReady,
        managedActiveSkuCount: priority.managedActiveSkuCount,
        purchaseRecommendationCount: priority.purchaseRecommendationCount,
        operationallyReadyPurchaseCount:
          priority.operationallyReadyPurchaseCount,
        blockedPurchaseRecommendationCount:
          priority.blockedPurchaseRecommendationCount,
        provisionalPurchaseCount: priority.provisionalPurchaseCount,
        verifiedPurchaseCount: priority.verifiedPurchaseCount,
        reviewInventoryCount: priority.reviewInventoryCount,
        totalExpectedSpend: priority.totalExpectedSpend,
        operationallyReadyExpectedSpend:
          priority.operationallyReadyExpectedSpend,
        source: source
          ? {
              analysisAsOf: source.analysisAsOf,
              planningContentFingerprint:
                source.planningContentFingerprint,
              canonicalContentFingerprint:
                source.canonicalContentFingerprint,
              reconciliationFingerprint:
                source.reconciliationFingerprint,
              inventoryGeneratedAt: source.inventoryGeneratedAt ?? null,
              inventoryContentFingerprint:
                source.inventoryContentFingerprint ?? null,
              cycleMonth: source.cycleMonth,
              budgetMonth: source.budgetMonth,
              blockerKeys: source.blockerKeys,
            }
          : null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        processed: false,
        busy: false,
        state: "FAILED",
        writesEnabled: false,
        approvalEnabled: false,
        purchaseDraftEnabled: false,
        code: "STAGE8_POSTAPPLY_PURCHASE_READINESS_FAILED",
        message: safeMessage(error),
      },
      { status: 500 },
    );
  }
}
