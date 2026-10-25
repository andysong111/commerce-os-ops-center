import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import {
  applyProductMasterShoplingSalesEvents,
  ensurePurchaseRunSalesRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
  runProductMasterShoplingSalesEventSyncStep,
} from "@/lib/productMasterShoplingSalesEventSync";
import { sameDayPurchaseRun, replaceablePriorPurchaseRun } from "@/lib/purchaseRunStartPolicy";
import { loadSalesEventDirectPromotionGate } from "@/lib/salesEventDirectPromotionGate";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";
import { PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS } from "@/lib/purchaseRunPreparationPolicy";
import {
  ensurePurchaseRunDemandRefreshRequest,
  loadProductDecisionLiveStatus,
  runProductDecisionLiveRefreshStep,
} from "@/lib/productDecisionLiveRefresh";

const SALES_STEPS_PER_REQUEST = 1;
const DEMAND_STEPS_PER_REQUEST = 1;

export type PurchaseRunPreparationStage =
  | "DEMAND"
  | "SALES"
  | "CANARY"
  | "FULL"
  | "RECONCILIATION"
  | "INVENTORY";

export class PurchaseRunPreparationStageError extends Error {
  readonly stage: PurchaseRunPreparationStage;
  override readonly cause: unknown;

  constructor(stage: PurchaseRunPreparationStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause ?? "PURCHASE_RUN_PREPARATION_FAILED"));
    this.name = "PurchaseRunPreparationStageError";
    this.stage = stage;
    this.cause = cause;
  }
}

export function purchaseRunPreparationErrorStage(error: unknown) {
  return error instanceof PurchaseRunPreparationStageError ? error.stage : null;
}

async function atPreparationStage<T>(
  stage: PurchaseRunPreparationStage,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    throw new PurchaseRunPreparationStageError(stage, error);
  }
}

export type PurchaseRunPreparationInput = {
  targetDate: string;
  cashLimitKrw: number | null;
  sourcingBudgetPercent: number;
};

export type PurchaseRunPreparationResult =
  | {
      state: "READY";
      stage: "EXISTING_DRAFT" | "DRAFT_BUILDER";
      progress: 100;
      message: string;
      draftUrl: string | null;
      builderUrl: string | null;
      externalOrderExecuted: false;
    }
  | {
      state: "PENDING";
      stage: "DEMAND" | "SALES" | "CANARY" | "FULL" | "RECONCILIATION";
      progress: number;
      message: string;
      externalOrderExecuted: false;
    }
  | {
      state: "BLOCKED";
      stage: "DEMAND" | "SALES" | "CANARY" | "FULL" | "RECONCILIATION" | "INVENTORY";
      progress: number;
      message: string;
      externalOrderExecuted: false;
    };

export function normalizePurchaseRunPreparationInput(
  value: unknown,
  targetDate: string,
): PurchaseRunPreparationInput {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const rawCash = body.cashLimitKrw;
  const cashLimitKrw = rawCash === null || rawCash === undefined || rawCash === ""
    ? null
    : Number(rawCash);
  const sourcingBudgetPercent = Number(body.sourcingBudgetPercent ?? 0);
  if (
    cashLimitKrw !== null &&
    (!Number.isSafeInteger(cashLimitKrw) || cashLimitKrw < 0 || cashLimitKrw > 10_000_000_000)
  ) {
    throw new Error("PURCHASE_RUN_CASH_INVALID");
  }
  if (
    !Number.isSafeInteger(sourcingBudgetPercent) ||
    sourcingBudgetPercent < 0 ||
    sourcingBudgetPercent > 100
  ) {
    throw new Error("PURCHASE_RUN_SOURCING_PERCENT_INVALID");
  }
  return { targetDate, cashLimitKrw, sourcingBudgetPercent };
}

function draftBuilderUrl(
  input: PurchaseRunPreparationInput,
  replaceDraftId: string | null,
) {
  const params = new URLSearchParams({
    check: "1",
    date: input.targetDate,
    sourcing: String(input.sourcingBudgetPercent),
    prepared: "1",
  });
  if (input.cashLimitKrw !== null) params.set("cash", String(input.cashLimitKrw));
  if (replaceDraftId) params.set("replace", replaceDraftId);
  return `/purchase-cycle-preflight?${params.toString()}`;
}

function blocked(
  stage: Extract<PurchaseRunPreparationResult, { state: "BLOCKED" }>["stage"],
  progress: number,
  message: string,
): PurchaseRunPreparationResult {
  return { state: "BLOCKED", stage, progress, message, externalOrderExecuted: false };
}

export async function advancePurchaseRunPreparation(
  input: PurchaseRunPreparationInput,
): Promise<PurchaseRunPreparationResult> {
  const ledger = await atPreparationStage("INVENTORY", () => loadFastPurchaseInternalDrafts());
  if (ledger.error) {
    return blocked("INVENTORY", 0, "기존 발주기록을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.");
  }
  const existing = sameDayPurchaseRun(ledger.drafts, input.targetDate);
  if (existing) {
    return {
      state: "READY",
      stage: "EXISTING_DRAFT",
      progress: 100,
      message: "오늘 만든 발주초안을 다시 엽니다.",
      draftUrl: `/china-order-manager/drafts/${encodeURIComponent(existing.draftId)}`,
      builderUrl: null,
      externalOrderExecuted: false,
    };
  }

  let demand = await atPreparationStage("DEMAND", () =>
    ensurePurchaseRunDemandRefreshRequest({
      maxAgeMs: PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS,
    }));
  if (demand.state === "QUEUED" || demand.state === "RUNNING") {
    for (let index = 0; index < DEMAND_STEPS_PER_REQUEST; index += 1) {
      const step = await atPreparationStage("DEMAND", () => runProductDecisionLiveRefreshStep());
      if (step.state !== "RUNNING") break;
    }
    demand = await atPreparationStage("DEMAND", () =>
      loadProductDecisionLiveStatus(demand.requestId));
    if (demand.state === "QUEUED" || demand.state === "RUNNING") {
      return {
        state: "PENDING",
        stage: "DEMAND",
        progress: Math.min(35, Math.round(demand.progress * 0.35)),
        message: `최신 주문·클레임을 읽고 있습니다. 주문 ${demand.orderCompleted}/${demand.orderTotal} · 클레임 ${demand.claimCompleted}/${demand.claimTotal}`,
        externalOrderExecuted: false,
      };
    }
  }
  if (demand.state !== "COMPLETED") {
    return blocked(
      "DEMAND",
      Math.min(35, Math.round(demand.progress * 0.35)),
      "최신 주문·클레임 자료를 준비하지 못했습니다. 같은 시작 버튼으로 다시 시도하세요.",
    );
  }

  await atPreparationStage("SALES", () => ensurePurchaseRunSalesRequest({
    targetDate: input.targetDate,
    maxAgeMs: PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS,
  }));
  let sales = await atPreparationStage("SALES", () =>
    loadProductMasterShoplingSalesEventSyncStatus());
  if (sales.state === "QUEUED" || sales.state === "RUNNING") {
    for (let index = 0; index < SALES_STEPS_PER_REQUEST; index += 1) {
      const step = await atPreparationStage("SALES", () =>
        runProductMasterShoplingSalesEventSyncStep());
      if (step.state !== "RUNNING") break;
    }
    sales = await atPreparationStage("SALES", () =>
      loadProductMasterShoplingSalesEventSyncStatus());
    if (sales.state === "QUEUED" || sales.state === "RUNNING") {
      return {
        state: "PENDING",
        stage: "SALES",
        progress: 35 + Math.min(35, Math.round(sales.progress * 0.35)),
        message:
          sales.totalRanges > 0 && sales.completedRanges >= sales.totalRanges
            ? sales.message
            : `최신 판매자료를 읽고 있습니다. ${sales.completedRanges}/${sales.totalRanges}개 구간 완료`,
        externalOrderExecuted: false,
      };
    }
  }

  if (sales.state === "READY_CANARY") {
    const gate = await atPreparationStage("CANARY", () =>
      loadSalesEventDirectPromotionGate("canary"));
    if (!gate.safeToApply || !gate.candidatePlanFingerprint) {
      return blocked("CANARY", 72, "판매자료 1건 확인에서 안전조건을 충족하지 못했습니다.");
    }
    const candidatePlanFingerprint = gate.candidatePlanFingerprint;
    const applied = await atPreparationStage("CANARY", () =>
      applyProductMasterShoplingSalesEvents(
        "canary",
        candidatePlanFingerprint,
      ));
    if (!applied.ok) {
      return blocked("CANARY", 72, applied.message || "상품마스터 판매자료 저장 준비가 필요합니다.");
    }
    return {
      state: "PENDING",
      stage: "CANARY",
      progress: 78,
      message: "판매자료 1건 대조를 통과했습니다. 전체 자료를 확인합니다.",
      externalOrderExecuted: false,
    };
  }

  if (sales.state === "READY_FULL") {
    const gate = await atPreparationStage("FULL", () =>
      loadSalesEventDirectPromotionGate("full"));
    if (!gate.safeToApply || !gate.candidatePlanFingerprint) {
      return blocked("FULL", 80, "전체 판매자료 반영 안전조건을 충족하지 못했습니다.");
    }
    const candidatePlanFingerprint = gate.candidatePlanFingerprint;
    const applied = await atPreparationStage("FULL", () =>
      applyProductMasterShoplingSalesEvents(
        "full",
        candidatePlanFingerprint,
      ));
    if (!applied.ok) {
      return blocked("FULL", 80, applied.message || "전체 판매자료 저장 준비가 필요합니다.");
    }
    return {
      state: "PENDING",
      stage: "FULL",
      progress: 88,
      message: "최신 판매자료 저장을 마쳤습니다. 클레임·재고·미입고 수량을 대조합니다.",
      externalOrderExecuted: false,
    };
  }

  if (sales.state !== "COMPLETED") {
    return blocked(
      "SALES",
      Math.min(70, sales.progress),
      sales.state === "BLOCKED"
        ? `판매상품 연결을 확인해야 하는 항목이 ${sales.blockerCount}건 있습니다.`
        : sales.message || "최신 판매자료 준비를 완료하지 못했습니다.",
    );
  }

  const reconciliation = await atPreparationStage("RECONCILIATION", () =>
    loadPostApplyCanonicalReconciliation());
  if (!reconciliation.ready) {
    return blocked("RECONCILIATION", 90, "저장한 판매자료와 발주 계산용 원장이 일치하지 않습니다.");
  }
  const inventory = await atPreparationStage("INVENTORY", () =>
    loadInventoryVerificationPriority(input.targetDate, {
      reconciliation,
    }));
  if (inventory.state !== "READY") {
    return blocked(
      "INVENTORY",
      95,
      inventory.omissionBlockingCount > 0
        ? `판매상품 ${inventory.omissionBlockingCount}종의 재고·발주근거를 확인해야 합니다.`
        : "재고·클레임·미입고 수량 대조를 완료하지 못했습니다.",
    );
  }

  const replaceable = replaceablePriorPurchaseRun(ledger.drafts, input.targetDate);
  return {
    state: "READY",
    stage: "DRAFT_BUILDER",
    progress: 100,
    message: "최신 판매·클레임·재고·미입고 자료 준비가 끝났습니다.",
    draftUrl: null,
    builderUrl: draftBuilderUrl(input, replaceable?.draftId ?? null),
    externalOrderExecuted: false,
  };
}
