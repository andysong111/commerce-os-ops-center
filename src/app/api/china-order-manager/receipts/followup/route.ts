import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { retryInternalChinaReceiptFollowup } from "@/lib/internalChinaReceiptFollowup";
import { validInternalReceiptId } from "@/lib/internalChinaReceiptFollowupCore";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "receiptId") || !validInternalReceiptId(body.receiptId)) return json({ ok: false, error: "RECEIPT_FOLLOWUP_REQUEST_INVALID", message: "저장된 입고번호만으로 후속 반영을 재시도할 수 있습니다." }, 400);
  try {
    const status = await retryInternalChinaReceiptFollowup(body.receiptId);
    return json({ ok: true, status, message: "입고수량을 다시 추가하지 않고 상품마스터 원가 반영을 재조회 검증했습니다." });
  } catch (error) {
    const candidate = error instanceof Error ? error.message.split(":", 1)[0] : "";
    const code = /^[A-Z0-9_]+$/.test(candidate) ? candidate : "RECEIPT_FOLLOWUP_FAILED";
    return json({ ok: false, error: code, message: "입고 원장은 그대로 유지했습니다. 후속 반영을 검증하지 못해 완료 처리하지 않았습니다." }, 503);
  }
}
