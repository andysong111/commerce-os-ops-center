import {
  createProductMasterShoplingSalesEventSyncRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
  productMasterShoplingSalesEventSyncConfigured,
  runProductMasterShoplingSalesEventSyncStep,
} from "@/lib/productMasterShoplingSalesEventSync";
import {
  SALES_EVENT_DEFAULT_CHUNK_DAYS,
  SALES_EVENT_LEGACY_CHUNK_DAYS,
  SALES_EVENT_MINIMUM_CHUNK_DAYS,
  hydrateProductMasterShoplingSalesEventRecovery,
  recoverProductMasterShoplingSalesEventRequest,
} from "@/lib/productMasterShoplingSalesEventRecovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 3;
const EXTRA_STEP_START_BUDGET_MS = 12_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runProductMasterShoplingSalesEventSyncStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesEventSyncStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

function recoveryMessage(result: {
  reason?: string;
  chunkDays?: number;
  attemptsInPreviousTier?: number;
  reusedChunks?: number;
}) {
  const reused = Number(result.reusedChunks ?? 0);
  const reuseNote = reused > 0 ? ` 이전 성공 구간 ${reused}개는 다시 읽지 않고 재사용합니다.` : "";
  if (result.reason === "RETRY_SAME_TIER") {
    return `${result.chunkDays}일 Shopling 조회를 같은 분석시점으로 안전 재시도합니다. 이 구간 크기의 ${Number(result.attemptsInPreviousTier ?? 0) + 1}번째 요청입니다.${reuseNote}`;
  }
  if (result.chunkDays === SALES_EVENT_DEFAULT_CHUNK_DAYS) {
    return `${SALES_EVENT_LEGACY_CHUNK_DAYS}일 Shopling 주문 조회가 실패해 같은 분석시점을 유지한 채 ${SALES_EVENT_DEFAULT_CHUNK_DAYS}일 단위로 안전 재접수했습니다.${reuseNote}`;
  }
  if (result.chunkDays === SALES_EVENT_MINIMUM_CHUNK_DAYS) {
    return `7일 Shopling 주문 조회도 반복 실패해 같은 분석시점을 유지한 채 2일 단위로 최종 안전 재접수했습니다.${reuseNote}`;
  }
  return `Shopling 주문 조회를 더 작은 안전 구간으로 재접수했습니다.${reuseNote}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!productMasterShoplingSalesEventSyncConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "판매 이벤트 연동 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (current.state === "IDLE") {
      const created = await createProductMasterShoplingSalesEventSyncRequest();
      return Response.json({
        ok: true,
        configured: true,
        processed: true,
        state: "QUEUED",
        requestId: created.requestId,
        chunkDays: SALES_EVENT_DEFAULT_CHUNK_DAYS,
        totalRanges: created.ranges.length,
        message: "최근 360일 정확한 주문행 판매 이벤트 수집을 자동 접수했습니다.",
      });
    }
    if (current.state === "FAILED") {
      const recovered = await recoverProductMasterShoplingSalesEventRequest();
      if (recovered.recovered) {
        return Response.json({
          ok: true,
          configured: true,
          processed: true,
          state: "QUEUED",
          ...recovered,
          message: recoveryMessage(recovered),
        });
      }
      if (recovered.reason === "MINIMUM_RANGE_EXHAUSTED") {
        return Response.json({
          ok: true,
          configured: true,
          processed: false,
          state: "FAILED",
          requestId: recovered.requestId,
          chunkDays: recovered.chunkDays,
          message:
            "2일 Shopling 주문 조회도 반복 실패해 자동 축소 재시도를 종료했습니다. 실제 데이터 쓰기는 없으며 원인 진단이 필요합니다.",
        });
      }
    }
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      const hydrated = await hydrateProductMasterShoplingSalesEventRecovery();
      return Response.json({
        ok: true,
        configured: true,
        hydrated,
        ...(await runBoundedBurst()),
      });
    }
    return Response.json({
      ok: true,
      configured: true,
      processed: false,
      state: current.state,
      message: current.message,
      planFingerprint: current.report?.planFingerprint ?? null,
      blockerCount: current.blockerCount,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "SALES_EVENT_CRON_FAILED",
        message: error instanceof Error ? error.message : "판매 이벤트 Worker 실행 실패",
      },
      { status: 500 },
    );
  }
}
