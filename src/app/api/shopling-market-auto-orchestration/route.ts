import { after, NextRequest } from "next/server";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  createMarketAutoOrchestration,
  createMarketOnlyOrchestration,
  heartbeatMarketAutoAgent,
  listMarketAutoOrchestrations,
  MARKET_AUTO_AGENT_BRIDGE,
  pollMarketAutoAgent,
  reconnectMarketAutoOrchestration,
  reportMarketAutoAgent,
  validMarketAutoAgentId,
  validMarketAutoToken,
} from "@/lib/shoplingMarketAutoOrchestrationServer";
import { runCoalescedSeoRunShoplingWorkerPulse } from "@/lib/seoRunShoplingWorkerPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
function text(value: unknown) {
  return String(value ?? "").trim();
}

async function wakeShoplingWorker(userId: string) {
  await wakeOpsDispatchTask("seo-run-worker", 0).catch(() => false);
  await runCoalescedSeoRunShoplingWorkerPulse({
    workerId: `one-click:${userId.slice(0, 8)}:${crypto.randomUUID()}`,
    leaseSeconds: 150,
  }).catch((error) => {
    console.error("[shopling-market-auto] Shopling registration worker failed", error);
  });
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  try {
    const orchestrations = await listMarketAutoOrchestrations(
      authenticated.value.identity.userId,
    );
    return Response.json({ ok: true, orchestrations });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "market_auto_list_failed",
        message: error instanceof Error ? error.message : "원클릭 상태 조회 실패",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action) || "create";

  if (["agent_poll", "agent_heartbeat", "agent_report"].includes(action)) {
    if (text(body.bridge) !== MARKET_AUTO_AGENT_BRIDGE) {
      return Response.json(
        { ok: false, error: "unsupported_market_auto_agent_bridge" },
        { status: 400 },
      );
    }
    const token = validMarketAutoToken(body.token);
    const agentId = validMarketAutoAgentId(body.agentId);
    if (!token || !agentId) {
      return Response.json(
        { ok: false, error: "invalid_market_auto_agent_identity" },
        { status: 400 },
      );
    }
    try {
      const result =
        action === "agent_poll"
          ? await pollMarketAutoAgent(token, agentId)
          : action === "agent_heartbeat"
            ? await heartbeatMarketAutoAgent(token, agentId)
            : await reportMarketAutoAgent(
                token,
                agentId,
                body.a19Evidence,
                body.a19AuditReceipt,
              );
      return Response.json({ ok: true, bridge: MARKET_AUTO_AGENT_BRIDGE, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "market auto agent failed";
      const status = message.includes("not_found") ? 404 : message.includes("lease_mismatch") ? 409 : 503;
      return Response.json({ ok: false, error: message }, { status });
    }
  }

  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  if (!["create", "create_market_only", "reconnect"].includes(action)) {
    return Response.json({ ok: false, error: "unsupported_market_auto_action" }, { status: 400 });
  }
  try {
    const created = action === "reconnect"
      ? await reconnectMarketAutoOrchestration(
          authenticated.value,
          body.orchestrationId,
          body.handoffToken,
        )
      : action === "create_market_only"
      ? await createMarketOnlyOrchestration(
          authenticated.value,
          body.runIds,
          body.handoffToken,
        )
      : await createMarketAutoOrchestration(
          authenticated.value,
          body.runIds,
          body.handoffToken,
        );
    if ("needsWorkerWake" in created && created.needsWorkerWake) {
      after(() => wakeShoplingWorker(authenticated.value.identity.userId));
    }
    const createdRecord = record(created);
    return Response.json({
      ok: true,
      ...created,
      message:
        action === "reconnect"
          ? createdRecord.needsHandoff === true
            ? "멈춘 원클릭 작업의 브라우저 인계 토큰을 안전하게 다시 발급했습니다."
            : createdRecord.activeAgent === true
              ? "브라우저 에이전트가 이미 원클릭 마켓전송을 처리하고 있습니다."
              : "원클릭 작업이 이미 종료되었습니다."
        : action === "create_market_only"
          ? "이미 Shopling 등록·재조회가 끝난 상품의 마켓전송만 재개했습니다. SEO와 Shopling 상품등록은 다시 실행하지 않습니다."
          : "Shopling 업로드 → 마켓전송 원클릭 작업을 만들었습니다. v0.3.30 브라우저 에이전트가 이후 단계를 자동으로 이어갑니다.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "원클릭 작업 생성 실패";
    const conflict = /없습니다|충족|빠졌|중복|일치하지|이미|검증되지|올바르지|다른/.test(message);
    return Response.json(
      { ok: false, error: "market_auto_create_failed", message },
      { status: conflict ? 409 : 503 },
    );
  }
}
