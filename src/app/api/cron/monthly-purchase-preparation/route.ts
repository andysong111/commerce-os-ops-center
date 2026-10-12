import {
  loadMonthlyPurchasePreparationState,
  MONTHLY_PURCHASE_PREPARATION_MAX_SOURCE_AGE_MS,
  recordMonthlyPurchasePreparationRun,
} from "@/lib/monthlyPurchasePreparation";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import { ensureMonthlyPurchasePreparationSalesRequest } from "@/lib/productMasterShoplingSalesEventSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const now = new Date();
    const state = await loadMonthlyPurchasePreparationState(now);
    if (!state.decision.due || !state.decision.cycleMonth) {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        state: state.schedule?.enabled ? "SCHEDULED" : "DISABLED",
        writesEnabled: false,
        approvalEnabled: false,
        schedule: state.schedule,
        lastRun: state.lastRun,
        nextScheduledAt: state.decision.nextScheduledAt,
        message: state.schedule?.enabled
          ? "다음 월간 발주자료 자동 준비 시각을 기다립니다."
          : "월간 발주자료 자동 준비 일정이 꺼져 있습니다.",
      });
    }

    const prepared = await ensureMonthlyPurchasePreparationSalesRequest({
      cycleMonth: state.decision.cycleMonth,
      maxAgeMs: MONTHLY_PURCHASE_PREPARATION_MAX_SOURCE_AGE_MS,
      now,
    });
    await recordMonthlyPurchasePreparationRun(
      {
        cycleMonth: state.decision.cycleMonth,
        requestId: prepared.requestId,
        analysisAsOf: prepared.analysisAsOf,
        accepted: prepared.accepted,
      },
      now,
    );
    const [salesWakeRequested, evidenceWakeRequested] = await Promise.all([
      wakeOpsDispatchTask("product-master-shopling-sales-events", 0).catch(() => false),
      wakeOpsDispatchTask("stage8-candidate-prewrite-evidence", 0).catch(() => false),
    ]);
    return Response.json({
      ok: true,
      processed: true,
      busy: prepared.state === "QUEUED" || prepared.state === "RUNNING",
      state: prepared.accepted ? "QUEUED" : "REUSED_FRESH_SOURCE",
      writesEnabled: false,
      approvalEnabled: false,
      cycleMonth: prepared.cycleMonth,
      requestId: prepared.requestId,
      analysisAsOf: prepared.analysisAsOf,
      salesWakeRequested,
      evidenceWakeRequested,
      message: prepared.accepted
        ? "월간 발주일 전에 최신 판매자료 수집과 두 번 대조를 자동 시작했습니다. Product Master 원장 반영은 사람 승인 전까지 실행하지 않습니다."
        : "이미 신선한 판매자료가 있어 중복 수집하지 않고 비교·근거 준비를 이어갑니다.",
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
        code: "MONTHLY_PURCHASE_PREPARATION_FAILED",
        message: safeMessage(error),
      },
      { status: 500 },
    );
  }
}
