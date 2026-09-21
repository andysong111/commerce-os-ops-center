import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The old unscoped, no-channel-preimage dispatcher must not bypass the new
// mixed-inventory protection or reuse a pre-policy approval fingerprint.
export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return Response.json({ ok: false, code: "MONTHLY_PRICE_UNAUTHORIZED" }, { status: 401 });
  return Response.json({ ok: false, code: "MONTHLY_PRICE_EXECUTION_REQUIRED", message: "이전 가격조정안으로는 실행할 수 없습니다. 발주사이클의 월 처리 단계에서 ‘가격조정 실행’을 사용하세요. 해당 월 원가와 채널별 현재가를 다시 확인합니다." }, { status: 409, headers: { "cache-control": "no-store" } });
}
