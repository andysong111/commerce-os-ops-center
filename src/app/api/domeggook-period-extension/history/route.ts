import {
  DOMEGGOOK_RUN_OPERATION_TYPE,
  DOMEGGOOK_SETTINGS_OPERATION_TYPE,
  domeggookCloudStateFromRows,
} from "@/lib/domeggookPeriodExtensionCloud";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json({ ok: false, message: "운영 화면에서만 조회할 수 있습니다." }, { status: 401 });
  }
  const admin = await createSupabaseAdminClient();
  if (!admin) return Response.json({ ok: false, message: "운영 DB 연결이 없습니다." }, { status: 503 });
  const [settingsResult, runsResult] = await Promise.all([
    admin.from("commerce_operation_runs")
      .select("source_event_id,result_snapshot,started_at,finished_at")
      .eq("operation_type", DOMEGGOOK_SETTINGS_OPERATION_TYPE)
      .order("started_at", { ascending: false })
      .limit(1),
    admin.from("commerce_operation_runs")
      .select("source_event_id,result_snapshot,started_at,finished_at")
      .eq("operation_type", DOMEGGOOK_RUN_OPERATION_TYPE)
      .order("started_at", { ascending: false })
      .limit(90),
  ]);
  if (settingsResult.error || runsResult.error) {
    return Response.json({ ok: false, message: settingsResult.error?.message || runsResult.error?.message }, { status: 502 });
  }
  const settingsRows = Array.isArray(settingsResult.data) ? settingsResult.data : [];
  if (settingsRows.length === 0) {
    return Response.json({ ok: true, state: null });
  }
  return Response.json({
    ok: true,
    state: domeggookCloudStateFromRows(settingsRows[0], runsResult.data),
  });
}
