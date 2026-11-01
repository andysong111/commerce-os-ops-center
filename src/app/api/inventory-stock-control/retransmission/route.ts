import { randomUUID } from "node:crypto";
import { loadAuthoritativeInventoryStockReport } from "@/lib/inventoryStockAuthoritativeReport";
import {
  buildShoplingStockRetransmissionRequest,
  loadShoplingStockRetransmissionState,
  storeShoplingStockRetransmissionRequest,
} from "@/lib/inventoryShoplingRetransmission";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    { ok: false, message: "Shopling 재전송 목록 관리 권한이 필요합니다." },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

async function current() {
  const { report } = await loadAuthoritativeInventoryStockReport();
  if (report.state !== "READY") {
    throw new Error("정확재고 원장이 READY가 아니므로 재전송 대상을 확정할 수 없습니다.");
  }
  const preview = buildShoplingStockRetransmissionRequest(
    report,
    "preview",
    report.generatedAt,
    "현재 확정 상태 미리보기",
  );
  const state = await loadShoplingStockRetransmissionState(report);
  return { report, preview, state };
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const { preview, state } = await current();
    return Response.json(
      { ok: true, preview, ...state },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재전송 목록을 확인하지 못했습니다.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const { report, state } = await current();
    const latest = state.latest;
    if (
      latest &&
      latest.reportFingerprint === report.fingerprint &&
      latest.succeededCount < latest.items.length
    ) {
      return Response.json(
        {
          ok: true,
          duplicate: true,
          request: latest,
          message: `같은 현재 상태의 재전송 목록 ${latest.items.length}건이 이미 있습니다. 중복 목록은 만들지 않았습니다.`,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const occurredAt = new Date().toISOString();
    const retransmission = buildShoplingStockRetransmissionRequest(
      report,
      `owner-request-${occurredAt.replace(/[^0-9]/g, "")}-${randomUUID()}`,
      occurredAt,
      String(body.reason || "운영자 요청: 현재 확정된 품절·판매중 상태를 Shopling에 빠짐없이 재전송"),
    );
    const stored = await storeShoplingStockRetransmissionRequest(retransmission);
    const verification = await loadShoplingStockRetransmissionState(report);
    const verified = verification.batches.find(
      (batch) => batch.requestId === retransmission.requestId,
    );
    if (!verified || verified.items.length !== retransmission.items.length) {
      throw new Error("재전송 목록 저장 후 재조회 검증에 실패했습니다.");
    }
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        request: verified,
        message: `Shopling 재전송 목록 ${verified.items.length}건을 저장하고 재조회 확인했습니다. 재고 기준과 판매 이력은 변경하지 않았습니다.`,
      },
      {
        status: stored.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재전송 목록을 만들지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
