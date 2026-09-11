import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  getWarehouseCapacitySnapshot,
  WarehouseCapacityBridgeError,
} from "@/lib/warehouseCapacityBridge";
import {
  evaluateWarehouseIntakePreflight,
  parseWarehouseIntakeInput,
} from "@/lib/warehouseIntakePreflight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

// Advisory GET only: no SKU assignments, capacity reservations, order creation,
// inventory movements, lifecycle promotion or Shopling writes exist in this route.
export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return json({ ok: false, error: "WAREHOUSE_CAPACITY_UNAUTHORIZED", message: "OPS Center 화면에서 사전점검을 실행해 주세요." }, 401);
  }

  try {
    const params = new URL(request.url).searchParams;
    const raw: Record<string, unknown> = {};
    for (const key of ["productCount", "optionsPerProduct", "slotsPerSku", "committedSlots"]) {
      if (params.getAll(key).length !== 1) throw new Error(`INVALID_${key.toUpperCase()}`);
      raw[key] = params.get(key);
    }
    // Reject malformed requests before making an upstream call.
    const input = parseWarehouseIntakeInput(raw);
    const snapshot = await getWarehouseCapacitySnapshot();
    const preflight = evaluateWarehouseIntakePreflight(snapshot, input);
    return json({ ok: true, preflight });
  } catch (error) {
    if (error instanceof WarehouseCapacityBridgeError) {
      return json({ ok: false, error: error.code, message: error.message }, error.status);
    }
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return json({
        ok: false,
        error: error.message,
        message: "상품 수·상품당 옵션 수·옵션당 필요 위치는 1 이상, 미배정 입고·발주 선점 위치는 0 이상의 정수로 모두 입력해 주세요.",
      }, 400);
    }
    return json({ ok: false, error: "WAREHOUSE_INTAKE_PREFLIGHT_FAILED", message: "창고 수용량 사전점검에 실패했습니다. 다시 조회해 주세요." }, 500);
  }
}
