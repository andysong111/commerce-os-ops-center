import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { validPurchaseCycleMonth } from "@/lib/purchaseCycleClosureCore";
import { loadPurchaseCycleClosure } from "@/lib/purchaseCycleClosure";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0" } }); }
function failure() { return json({ ok: false, code: "PURCHASE_CYCLE_PROOF_UNAVAILABLE", message: "발주사이클 확인에 필요한 원장 일부를 읽지 못했습니다. 기존 데이터를 변경하거나 완료로 간주하지 않았습니다." }, 503); }
export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const params = new URL(request.url).searchParams;
  const month = params.get("month") || seoulCalendarMonth(new Date());
  if (params.getAll("month").length > 1 || !validPurchaseCycleMonth(month)) return json({ ok: false, code: "PURCHASE_CYCLE_MONTH_INVALID" }, 400);
  try { return json({ ok: true, report: await loadPurchaseCycleClosure(month) }); } catch { return failure(); }
}
export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["month", "action"].includes(key)) || body.action !== "REFRESH_STOCK_EVIDENCE" || !validPurchaseCycleMonth(body.month)) return json({ ok: false, code: "PURCHASE_CYCLE_REFRESH_INVALID" }, 400);
  // Explicit bounded evidence refresh only. Does not receive stock, finalize
  // budgets, execute orders, write prices or send Shopling sale states.
  try { return json({ ok: true, report: await loadPurchaseCycleClosure(body.month, true) }); } catch { return failure(); }
}
