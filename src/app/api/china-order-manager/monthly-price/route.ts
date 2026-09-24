import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { monthlyMonth, monthlyRecord, MONTHLY_PRICE_POLICY } from "@/lib/monthlyPriceCore";
import { loadMonthlyPriceSources } from "@/lib/monthlyPriceSource";
import { createMonthlyPriceRun, resumeMonthlyPriceRunPreflight, loadMonthlyPriceStatus, loadMonthlyPriceRun, loadMonthlyPriceRunStatus, type MonthlyPriceItem } from "@/lib/monthlyPriceStore";
import { monthlyPriceItemAction } from "@/lib/monthlyPriceActions";
import { reviewLegacyMonthlyTransmission } from "@/lib/monthlyPriceLegacyReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers }); }
function publicStatus(value: Awaited<ReturnType<typeof loadMonthlyPriceStatus>>) {
  const run = value.run;
  return { run: run ? { id: run.id, month: run.cycle_month, sourceHash: run.source_hash, createdAt: run.created_at, warnings: run.source_snapshot.warnings, policy: run.policy_version } : null,
    items: value.items.map((item: MonthlyPriceItem) => ({ id: item.id, goodsKey: item.goods_key, state: item.state, candidate: item.candidate, plan: item.plan, writeIndex: item.write_index, errorCode: item.error_code, transmission: item.transmission, updatedAt: item.updated_at })) };
}
function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "MONTHLY_PRICE_FAILED";
  return json({ ok: false, code: /^[A-Z0-9_]+$/.test(code) ? code : "MONTHLY_PRICE_FAILED" }, /BUSY|STALE|CHANGED|UNCERTAIN/.test(code) ? 409 : 400);
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const month = monthlyMonth(params.get("month")), runId = params.get("runId");
    if (runId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) throw new Error("MONTHLY_PRICE_ID_INVALID");
      const run = await loadMonthlyPriceRun(runId);
      if (run.cycle_month !== month || run.policy_version !== MONTHLY_PRICE_POLICY) throw new Error("MONTHLY_PRICE_RUN_SCOPE_INVALID");
      return json({ ok: true, ...publicStatus(await loadMonthlyPriceRunStatus(run)) });
    }
    return json({ ok: true, ...publicStatus(await loadMonthlyPriceStatus(month)) });
  }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return json({ ok: false, code: "MONTHLY_PRICE_UNAUTHORIZED" }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 100000) return json({ ok: false, code: "MONTHLY_PRICE_PAYLOAD_TOO_LARGE" }, 413);
    const payload = monthlyRecord(JSON.parse(raw));
    if (payload.policy !== MONTHLY_PRICE_POLICY) return json({ ok: false, code: "MONTHLY_PRICE_POLICY_STALE" }, 409);
    if (payload.action === "preview") {
      const sources = await loadMonthlyPriceSources(payload.month);
      return json({ ok: true, readOnly: true, sources });
    }
    if (payload.action === "start") {
      // Repeated clicks load the same immutable source/plan run, not a fresh
      // "latest proposal" from another month or a percentage adjustment twice.
      const sources = await loadMonthlyPriceSources(payload.month);
      return json({ ok: true, ...publicStatus(await createMonthlyPriceRun(sources)) });
    }
    if (payload.action === "resumePreflight") {
      const sources = await loadMonthlyPriceSources(payload.month);
      return json({ ok: true, ...publicStatus(await resumeMonthlyPriceRunPreflight(String(payload.runId ?? ""), sources)) });
    }
    if (payload.action === "reviewLegacyTransmission") {
      return json({ ok: true, item: await reviewLegacyMonthlyTransmission(payload) });
    }
    return json({ ok: true, item: await monthlyPriceItemAction(payload) });
  } catch (error) { return errorResponse(error); }
}
