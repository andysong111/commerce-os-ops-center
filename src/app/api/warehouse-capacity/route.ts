import {
  WarehouseCapacityBridgeError,
  getWarehouseCapacitySnapshot,
  isWarehouseCapacityWriteAction,
  warehouseCapacityBridgeConfigured,
  writeWarehouseCapacity,
} from "@/lib/warehouseCapacityBridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bridgeErrorResponse(error: unknown) {
  if (error instanceof WarehouseCapacityBridgeError) {
    return Response.json(
      {
        ok: false,
        configured: warehouseCapacityBridgeConfigured(),
        error: error.code,
        message: error.message,
      },
      {
        status: error.status,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }

  return Response.json(
    {
      ok: false,
      configured: warehouseCapacityBridgeConfigured(),
      error: "WAREHOUSE_CAPACITY_PROXY_FAILED",
      message: "창고 수용능력 연결 처리 중 오류가 발생했습니다.",
    },
    {
      status: 500,
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}

export async function GET() {
  try {
    const snapshot = await getWarehouseCapacitySnapshot();
    return Response.json(
      {
        ok: true,
        configured: true,
        snapshot,
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("REQUEST_BODY_OBJECT_REQUIRED");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json(
      {
        ok: false,
        configured: warehouseCapacityBridgeConfigured(),
        error: "INVALID_REQUEST_BODY",
        message: "요청 형식이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  if (!isWarehouseCapacityWriteAction(body.action)) {
    return Response.json(
      {
        ok: false,
        configured: warehouseCapacityBridgeConfigured(),
        error: "WAREHOUSE_CAPACITY_ACTION_INVALID",
        message: "허용되지 않은 창고 수용능력 작업입니다.",
      },
      { status: 400 },
    );
  }

  try {
    const payload = await writeWarehouseCapacity(body);
    return Response.json(
      {
        ...payload,
        ok: true,
        configured: true,
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}
