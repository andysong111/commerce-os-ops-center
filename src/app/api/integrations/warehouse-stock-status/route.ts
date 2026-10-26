import { verifyWarehouseStockCommand } from "@/lib/warehouseStockCommandProof";
import {
  applyWarehouseOptionStatus,
  prepareWarehouseStockStatus,
  recordWarehouseStockResult,
  safeWarehouseStockError,
} from "@/lib/warehouseStockStatusService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 50_000) {
      return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const proof = verifyWarehouseStockCommand(request, body);
    if (!proof) {
      return json(
        {
          ok: false,
          code: "WAREHOUSE_STOCK_STATUS_UNAUTHORIZED",
          message: "서명된 창고 위치·B코드 판매상태 명령이 필요합니다.",
        },
        401,
      );
    }
    const action = String(body.action ?? "").trim();
    const result =
      action === "prepare" && proof.purpose === "prepare"
        ? await prepareWarehouseStockStatus(proof)
        : action === "apply_option_status" && proof.purpose === "execute"
          ? await applyWarehouseOptionStatus(proof, body.goodsKeys)
          : action === "record_result" && proof.purpose === "execute"
            ? await recordWarehouseStockResult(proof, body)
            : null;
    if (!result) return json({ ok: false, code: "ACTION_NOT_ALLOWED" }, 400);
    const { status, ...payload } = result;
    return json(payload, status);
  } catch (error) {
    const message = safeWarehouseStockError(error);
    return json(
      { ok: false, code: "WAREHOUSE_STOCK_STATUS_FAILED", message },
      message.includes("확인") || message.includes("차단") ? 409 : 400,
    );
  }
}
