import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";
import {
  loadCandidateDemandParityStatus,
  type CandidateDemandParityStatus,
} from "@/lib/stage8CandidateDemandParity";
import {
  loadCandidateMismatchEvidenceStatus,
  type CandidateMismatchEvidenceStatus,
} from "@/lib/stage8CandidateMismatchEvidence";
import {
  loadCandidatePromotionGate,
  type CandidatePromotionGate,
} from "@/lib/stage8CandidatePromotionGate";
import {
  loadPostApplyCanonicalReconciliation,
  type PostApplyCanonicalReconciliation,
} from "@/lib/stage8PostApplyCanonicalReconciliation";
import {
  loadInventoryVerificationPriority,
  type InventoryVerificationPriority,
} from "@/lib/stage8InventoryVerificationPriority";

export type PurchaseCycleProgressStage = {
  number: number;
  label: string;
  state: "DONE" | "RUNNING" | "WAITING" | "BLOCKED" | "OWNER_ACTION";
  message: string;
  href: string;
};

export type PurchaseCycleProgressReport = {
  generatedAt: string;
  state:
    | "AUTOMATIC_PROGRESS"
    | "OWNER_ACTION_REQUIRED"
    | "BLOCKED_REVIEW"
    | "READ_ONLY_READY";
  currentStage: number;
  operatorActionRequired: boolean;
  operatorAction: string | null;
  operatorHref: string | null;
  writesEnabled: false;
  stages: PurchaseCycleProgressStage[];
  source: {
    salesState: string;
    salesRequestId: string | null;
    salesProgress: number;
    salesAnalysisAsOf: string | null;
    salesPlanFingerprint: string | null;
    parityState: string | null;
    evidenceState: string | null;
    promotionState: string | null;
    reconciliationState: string | null;
    purchaseEvidenceState: string | null;
  };
};

function stage(
  number: number,
  label: string,
  state: PurchaseCycleProgressStage["state"],
  message: string,
  href: string,
): PurchaseCycleProgressStage {
  return { number, label, state, message, href };
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 500);
}

async function safeRead<T>(reader: () => Promise<T>) {
  try {
    return { value: await reader(), error: null as string | null };
  } catch (error) {
    return { value: null as T | null, error: safeMessage(error) };
  }
}

function prewriteAutomatic(
  parity: CandidateDemandParityStatus | null,
  evidence: CandidateMismatchEvidenceStatus | null,
) {
  return (
    parity?.state === "QUEUED" ||
    parity?.state === "RUNNING" ||
    evidence?.state === "QUEUED" ||
    evidence?.state === "RUNNING"
  );
}

export async function loadPurchaseCycleProgress(): Promise<PurchaseCycleProgressReport> {
  const sales = await loadProductMasterShoplingSalesEventSyncStatus();
  let parity: CandidateDemandParityStatus | null = null;
  let evidence: CandidateMismatchEvidenceStatus | null = null;
  let gate: CandidatePromotionGate | null = null;
  let reconciliation: PostApplyCanonicalReconciliation | null = null;
  let purchase: InventoryVerificationPriority | null = null;

  const stages: PurchaseCycleProgressStage[] = [
    stage(1, "최신 360일 판매후보 수집", "WAITING", "판매후보 수집 전", "/stage8-sales-events"),
    stage(2, "Candidate parity·원주문행 근거", "WAITING", "판매후보 완료 후 자동 검증", "/stage8-candidate-demand-parity"),
    stage(3, "Product Master CANARY → FULL", "WAITING", "쓰기 전 게이트 통과 후 소유자 승인 필요", "/stage8-sales-events"),
    stage(4, "Persisted canonical 최종 대사", "WAITING", "FULL 반영 후 자동 재조회", "/stage8-postapply-canonical-reconciliation"),
    stage(5, "확정원가·재고·발주 Shadow", "WAITING", "최종 대사 완료 후 자동 점검", "/stage8-inventory-verification-priority"),
    stage(6, "10월 발주 소량 미리보기", "WAITING", "9월 마감·현금 상한 확인 후 읽기 전용 계산", "/purchase-cycle-preflight"),
    stage(7, "실제 주문·입고 검증", "WAITING", "최종 승인 전 실행 잠금", "/fast-purchase-mvp"),
  ];

  let state: PurchaseCycleProgressReport["state"] = "AUTOMATIC_PROGRESS";
  let currentStage = 1;
  let operatorActionRequired = false;
  let operatorAction: string | null = null;
  let operatorHref: string | null = null;

  if (sales.state === "QUEUED" || sales.state === "RUNNING") {
    stages[0] = stage(
      1,
      "최신 360일 판매후보 수집",
      "RUNNING",
      `${sales.completedRanges}/${sales.totalRanges}개 source range 수집 중 · 자동 진행`,
      "/stage8-sales-events",
    );
  } else if (
    sales.state === "FAILED" ||
    sales.state === "BLOCKED" ||
    sales.state === "STORAGE_NOT_READY"
  ) {
    stages[0] = stage(1, "최신 360일 판매후보 수집", "BLOCKED", sales.message, "/stage8-sales-events");
    state = "BLOCKED_REVIEW";
    operatorActionRequired = true;
    operatorAction = "판매후보 수집 차단 사유 확인";
    operatorHref = "/stage8-sales-events";
  } else if (
    sales.state === "READY_CANARY" ||
    sales.state === "READY_FULL" ||
    sales.state === "COMPLETED"
  ) {
    stages[0] = stage(
      1,
      "최신 360일 판매후보 수집",
      "DONE",
      `수집 완료 · request ${sales.requestId ?? "-"}`,
      "/stage8-sales-events",
    );

    const [parityRead, evidenceRead, gateRead] = await Promise.all([
      safeRead(loadCandidateDemandParityStatus),
      safeRead(loadCandidateMismatchEvidenceStatus),
      safeRead(loadCandidatePromotionGate),
    ]);
    parity = parityRead.value;
    evidence = evidenceRead.value;
    gate = gateRead.value;

    if (gate?.safeToApply) {
      stages[1] = stage(
        2,
        "Candidate parity·원주문행 근거",
        "DONE",
        "현재 candidate의 쓰기 전 근거 게이트 통과",
        "/stage8-candidate-promotion-gate",
      );
    } else if (prewriteAutomatic(parity, evidence)) {
      currentStage = 2;
      stages[1] = stage(
        2,
        "Candidate parity·원주문행 근거",
        "RUNNING",
        `parity ${parity?.state ?? "-"} · evidence ${evidence?.state ?? "-"} · 자동 진행`,
        "/stage8-candidate-demand-parity",
      );
    } else if (sales.state !== "COMPLETED") {
      currentStage = 2;
      stages[1] = stage(
        2,
        "Candidate parity·원주문행 근거",
        "BLOCKED",
        gate?.message ?? parityRead.error ?? evidenceRead.error ?? gateRead.error ?? "쓰기 전 근거 확인 필요",
        "/stage8-candidate-promotion-gate",
      );
      state = "BLOCKED_REVIEW";
      operatorActionRequired = true;
      operatorAction = "Candidate parity·근거 차단 사유 확인";
      operatorHref = "/stage8-candidate-promotion-gate";
    }

    if (sales.state === "READY_CANARY" && gate?.safeToApply) {
      currentStage = 3;
      stages[2] = stage(
        3,
        "Product Master CANARY → FULL",
        "OWNER_ACTION",
        "현재 candidate의 promotion gate가 통과했습니다. 1건 CANARY는 명시적 승인 없이는 실행되지 않습니다.",
        "/stage8-sales-events",
      );
      state = "OWNER_ACTION_REQUIRED";
      operatorActionRequired = true;
      operatorAction = "1건 CANARY 적재 승인";
      operatorHref = "/stage8-sales-events";
    } else if (sales.state === "READY_FULL" && gate?.safeToApply) {
      currentStage = 3;
      stages[2] = stage(
        3,
        "Product Master CANARY → FULL",
        "OWNER_ACTION",
        "CANARY 검증 완료. 동일 plan fingerprint의 FULL 반영은 별도 명시적 승인이 필요합니다.",
        "/stage8-sales-events",
      );
      state = "OWNER_ACTION_REQUIRED";
      operatorActionRequired = true;
      operatorAction = "검증된 FULL 적재 승인";
      operatorHref = "/stage8-sales-events";
    } else if (sales.state === "COMPLETED") {
      stages[2] = stage(
        3,
        "Product Master CANARY → FULL",
        "DONE",
        "명시적 승인된 FULL 반영·검증 이력 확인",
        "/stage8-sales-events",
      );

      const recRead = await safeRead(loadPostApplyCanonicalReconciliation);
      reconciliation = recRead.value;
      if (reconciliation?.ready) {
        stages[3] = stage(
          4,
          "Persisted canonical 최종 대사",
          "DONE",
          "candidate와 persisted canonical 원장 완전 대사 확인",
          "/stage8-postapply-canonical-reconciliation",
        );

        const purchaseRead = await safeRead(loadInventoryVerificationPriority);
        purchase = purchaseRead.value;
        if (purchase?.state === "READY" && purchase.purchaseShadowReady) {
          stages[4] = stage(
            5,
            "확정원가·재고·발주 Shadow",
            "DONE",
            `발주후보 ${purchase.purchaseRecommendationCount} · 실행근거 준비 ${purchase.operationallyReadyPurchaseCount}`,
            "/stage8-inventory-verification-priority",
          );
          currentStage = 6;
          stages[5] = stage(
            6,
            "10월 발주 소량 미리보기",
            "OWNER_ACTION",
            "예정일의 최신 현금 상한과 9월 마감 예산을 입력해 읽기 전용 미리보기를 확정합니다.",
            "/purchase-cycle-preflight",
          );
          state = "READ_ONLY_READY";
          operatorActionRequired = false;
        } else {
          currentStage = 5;
          stages[4] = stage(
            5,
            "확정원가·재고·발주 Shadow",
            "BLOCKED",
            purchase?.message ?? purchaseRead.error ?? "발주 근거 점검 실패",
            "/stage8-inventory-verification-priority",
          );
          state = "BLOCKED_REVIEW";
          operatorActionRequired = true;
          operatorAction = "원가·재고·발주 Shadow 차단 사유 확인";
          operatorHref = "/stage8-inventory-verification-priority";
        }
      } else {
        currentStage = 4;
        stages[3] = stage(
          4,
          "Persisted canonical 최종 대사",
          reconciliation?.state === "WAITING" ? "RUNNING" : "BLOCKED",
          reconciliation?.message ?? recRead.error ?? "persisted 대사 확인 실패",
          "/stage8-postapply-canonical-reconciliation",
        );
        state =
          reconciliation?.state === "WAITING"
            ? "AUTOMATIC_PROGRESS"
            : "BLOCKED_REVIEW";
        operatorActionRequired = reconciliation?.state !== "WAITING";
        if (operatorActionRequired) {
          operatorAction = "Persisted canonical 대사 차단 사유 확인";
          operatorHref = "/stage8-postapply-canonical-reconciliation";
        }
      }
    }
  } else {
    stages[0] = stage(1, "최신 360일 판매후보 수집", "WAITING", sales.message, "/stage8-sales-events");
  }

  return {
    generatedAt: new Date().toISOString(),
    state,
    currentStage,
    operatorActionRequired,
    operatorAction,
    operatorHref,
    writesEnabled: false,
    stages,
    source: {
      salesState: sales.state,
      salesRequestId: sales.requestId,
      salesProgress: sales.progress,
      salesAnalysisAsOf: sales.analysisAsOf,
      salesPlanFingerprint: sales.report?.planFingerprint ?? null,
      parityState: parity?.state ?? null,
      evidenceState: evidence?.state ?? null,
      promotionState: gate?.state ?? null,
      reconciliationState: reconciliation?.state ?? null,
      purchaseEvidenceState: purchase?.state ?? null,
    },
  };
}
