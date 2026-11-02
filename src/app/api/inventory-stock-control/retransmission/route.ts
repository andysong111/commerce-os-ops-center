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

const RETRY_EXCEPTIONS_ACTION = "RETRY_EXCEPTIONS";

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
    const action = String(body.action || "").trim().toUpperCase();
    if (action === RETRY_EXCEPTIONS_ACTION) {
      const sourceRequestId = String(body.sourceRequestId || "").trim();
      const source = state.batches.find((batch) => batch.requestId === sourceRequestId);
      if (!source || source.requestId !== latest?.requestId) {
        throw new Error("최신 Shopling 재전송 요청과 재시도 원본 요청번호가 일치하지 않습니다.");
      }
      const retryable = source.items.filter((item) =>
        ["FAILED", "UNCERTAIN"].includes(String(item.state || "")),
      );
      if (!retryable.length) {
        throw new Error("실패 또는 불확실 상태인 재전송 항목이 없어 재시도 목록을 만들지 않았습니다.");
      }
      const occurredAt = new Date().toISOString();
      const requestId = `owner-retry-${occurredAt.replace(/[^0-9]/g, "")}-${randomUUID()}`;
      const retryableByBarcode = new Map(
        retryable.map((item) => [`${item.barcode}:${item.desiredStatus}:${item.desiredSince}`, item]),
      );
      const fullRequest = buildShoplingStockRetransmissionRequest(
        report,
        requestId,
        occurredAt,
        String(body.reason || `운영자 승인 재전송 ${sourceRequestId}의 실패·불확실 항목만 안전 재시도`),
      );
      const retransmission = {
        ...fullRequest,
        items: fullRequest.items
          .filter((item) => retryableByBarcode.has(`${item.barcode}:${item.desiredStatus}:${item.desiredSince}`))
          .map((item) => ({
            ...item,
            jobId: `stock-resend:${requestId}:${item.barcode}:${item.desiredStatus}`,
            mode: "REPLAY" as const,
          })),
      };
      if (retransmission.items.length !== retryable.length) {
        throw new Error("현재 원장과 실패·불확실 재전송 항목의 정확한 신원이 일치하지 않아 재시도를 차단했습니다.");
      }
      await storeShoplingStockRetransmissionRequest(retransmission);
      const verification = await loadShoplingStockRetransmissionState(report);
      const verified = verification.batches.find((batch) => batch.requestId === requestId);
      if (!verified || verified.items.length !== retryable.length || verified.items.some((item) => item.state !== "PENDING")) {
        throw new Error("실패·불확실 재시도 목록 저장 후 재조회 검증에 실패했습니다.");
      }
      return Response.json(
        {
          ok: true,
          duplicate: false,
          request: verified,
          sourceRequestId,
          message: `기존 성공·대기 항목은 건드리지 않고 실패·불확실 ${verified.items.length}건만 새 작업번호로 재큐잉했습니다.`,
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }
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
