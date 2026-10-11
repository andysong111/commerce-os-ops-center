import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { validPurchaseCycleMonth } from "@/lib/purchaseCycleClosureCore";
import {
  loadPurchaseCycleClosure,
  purchaseCycleReadFailureSource,
} from "@/lib/purchaseCycleClosure";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0" } }); }
function errorChain(error: unknown) {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    messages.push(current.message.slice(0, 300));
    current = current.cause;
  }
  return messages;
}
function failure(error: unknown) {
  const source = purchaseCycleReadFailureSource(error);
  console.error("[purchase-cycle-status] ledger read failed", {
    code: "PURCHASE_CYCLE_PROOF_UNAVAILABLE",
    source,
    causes: errorChain(error),
  });
  return json({ ok: false, code: "PURCHASE_CYCLE_PROOF_UNAVAILABLE", source, message: "발주사이클 확인에 필요한 원장 일부를 읽지 못했습니다. 기존 데이터를 변경하거나 완료로 간주하지 않았습니다." }, 503);
}
export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const params = new URL(request.url).searchParams;
  const month = params.get("month") || seoulCalendarMonth(new Date());
  if (params.getAll("month").length > 1 || !validPurchaseCycleMonth(month)) return json({ ok: false, code: "PURCHASE_CYCLE_MONTH_INVALID" }, 400);
  try { return json({ ok: true, report: await loadPurchaseCycleClosure(month) }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["month", "action"].includes(key)) || body.action !== "REFRESH_STOCK_EVIDENCE" || !validPurchaseCycleMonth(body.month)) return json({ ok: false, code: "PURCHASE_CYCLE_REFRESH_INVALID" }, 400);
  // Explicit bounded evidence refresh only. Does not receive stock, finalize
  // budgets, execute orders, write prices or send Shopling sale states.
  try { return json({ ok: true, report: await loadPurchaseCycleClosure(body.month, true) }); } catch (error) { return failure(error); }
}
