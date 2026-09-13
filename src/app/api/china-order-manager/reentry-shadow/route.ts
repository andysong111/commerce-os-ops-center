import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { loadPurchaseCycleReentryShadow } from "@/lib/purchaseCycleReentryShadow";
import { reentryShadowMonths, validateReentryTargetMonth } from "@/lib/purchaseCycleReentryShadowCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;
const headers = { "cache-control": "no-store", "x-commerce-mode": "SHADOW_READ_ONLY" };

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return Response.json({ ok: false, code: "REENTRY_SHADOW_UNAUTHORIZED" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const now = new Date().toISOString();
  let target: string;
  try {
    // No cash/approval/action/refreshSales flags are accepted by the read path.
    if ([...params.keys()].some((key) => !["targetMonth", "_vercel_share"].includes(key)) || params.getAll("targetMonth").length > 1) throw new Error("INVALID_QUERY");
    target = validateReentryTargetMonth(params.get("targetMonth") ?? reentryShadowMonths(now).next, now);
  } catch {
    return Response.json({ ok: false, code: "REENTRY_SHADOW_QUERY_INVALID", message: "현재 월 또는 다음 발주월만 사전 점검할 수 있습니다." }, { status: 400, headers });
  }
  try {
    const report = await loadPurchaseCycleReentryShadow(target);
    return Response.json({ ok: report.state !== "BLOCKED", report }, { status: report.state === "BLOCKED" ? 503 : 200, headers });
  } catch {
    return Response.json({ ok: false, code: "REENTRY_SHADOW_UNAVAILABLE", message: "사전 점검 원본을 읽지 못했습니다. 어떤 발주·재고 변경도 실행하지 않았습니다." }, { status: 503, headers });
  }
}
// Explicitly reject writes; this module cannot create an approved purchase.
export async function POST() {
  return Response.json({ ok: false, code: "REENTRY_SHADOW_READ_ONLY" }, { status: 405, headers: { ...headers, allow: "GET" } });
}
