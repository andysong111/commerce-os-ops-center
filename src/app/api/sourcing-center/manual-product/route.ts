import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { registerManualSourcingProduct } from "@/lib/sourcingManualProductIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "MANUAL_PRODUCT_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = await request.json().catch(() => ({}));
    const result = await registerManualSourcingProduct(body);
    return Response.json(result, {
      status: result.duplicate ? 200 : 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "MANUAL_PRODUCT_REGISTRATION_FAILED";
    const code = raw.split(":", 1)[0] || "MANUAL_PRODUCT_REGISTRATION_FAILED";
    const timeout = code === "MANUAL_PRODUCT_ENGINE_TIMEOUT";
    return Response.json(
      {
        ok: false,
        code,
        message: timeout
          ? "소싱 DB 응답이 지연되고 있습니다. 입력은 이 브라우저에 그대로 보존됐으니 잠시 후 다시 시도하세요."
          : code.includes("REQUIRED") || code.includes("INVALID")
            ? "1688 링크, 상품명, 옵션명과 옵션별 수납 형태를 다시 확인하세요."
            : "신규상품 후보를 저장하지 못했습니다. 입력은 보존됐으니 소싱엔진 상태를 확인한 뒤 다시 시도하세요.",
        externalOrderExecuted: false,
      },
      {
        status: code.includes("REQUIRED") || code.includes("INVALID") ? 400 : timeout ? 504 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
