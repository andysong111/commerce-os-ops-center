import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  loadMonthlyPurchasePreparationState,
  saveMonthlyPurchasePreparationSchedule,
} from "@/lib/monthlyPurchasePreparation";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  return isSameOriginOpsRequest(request);
}

function message(error: unknown) {
  const code = error instanceof Error ? error.message : String(error ?? "");
  if (code === "MONTHLY_PURCHASE_PREPARATION_DAY_INVALID") {
    return "매달 실행일은 1일부터 28일 사이로 입력하세요.";
  }
  if (code === "MONTHLY_PURCHASE_PREPARATION_HOUR_INVALID") {
    return "준비 시작 시각은 0시부터 23시 사이로 입력하세요.";
  }
  return "월간 발주 준비 일정을 저장하지 못했습니다.";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    return Response.json(
      { ok: true, ...(await loadMonthlyPurchasePreparationState()) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "MONTHLY_PURCHASE_PREPARATION_STATUS_FAILED",
        message: message(error),
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) {
      return Response.json(
        { ok: false, code: "BODY_INVALID", message: "일정 입력을 확인하세요." },
        { status: 400 },
      );
    }
    const schedule = await saveMonthlyPurchasePreparationSchedule({
      enabled: body.enabled,
      dayOfMonth: body.dayOfMonth,
      startHour: body.startHour,
    });
    const wakeRequested = schedule.enabled
      ? await wakeOpsDispatchTask("monthly-purchase-preparation", 0).catch(() => false)
      : false;
    return Response.json(
      {
        ok: true,
        schedule,
        wakeRequested,
        message: schedule.enabled
          ? `매달 ${schedule.dayOfMonth}일 ${schedule.startHour}시에 발주자료 자동 준비를 시작합니다.`
          : "월간 발주자료 자동 준비를 껐습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: error instanceof Error ? error.message : "SCHEDULE_SAVE_FAILED",
        message: message(error),
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
