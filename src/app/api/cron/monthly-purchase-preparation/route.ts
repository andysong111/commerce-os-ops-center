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
        reusedRangeCount: prepared.reusedRangeCount,
        sourceReadRangeCount: prepared.sourceReadRangeCount,
        correctionDays: prepared.correctionDays,
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
      state: prepared.accepted
        ? "QUEUED"
        : prepared.alreadyActive
          ? "REUSED_ACTIVE_SOURCE"
          : "REUSED_FRESH_SOURCE",
      writesEnabled: false,
      approvalEnabled: false,
      cycleMonth: prepared.cycleMonth,
      requestId: prepared.requestId,
      analysisAsOf: prepared.analysisAsOf,
      reusedRangeCount: prepared.reusedRangeCount,
      sourceReadRangeCount: prepared.sourceReadRangeCount,
      correctionDays: prepared.correctionDays,
      salesWakeRequested,
      evidenceWakeRequested,
      message: prepared.accepted
        ? prepared.correctionDays
          ? `검증된 360일 판매근거 중 ${prepared.reusedRangeCount}개 구간을 재사용하고 최근 ${prepared.correctionDays}일을 포함한 ${prepared.sourceReadRangeCount}개 구간만 다시 읽기 시작했습니다. Product Master 원장 반영은 사람 승인 전까지 실행하지 않습니다.`
          : "재사용할 검증 기준자료가 없어 360일 최초 수집을 시작했습니다. Product Master 원장 반영은 사람 승인 전까지 실행하지 않습니다."
        : prepared.alreadyActive
          ? "이미 진행 중인 판매자료 작업을 그대로 이어갑니다. 중복 작업은 만들지 않았습니다."
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
