import {
  authorizeDomeggookCloudSync,
  buildDomeggookCloudRows,
} from "@/lib/domeggookPeriodExtensionCloud";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!process.env.DOMEGGOOK_RECEIPT_SYNC_SECRET?.trim()) {
    return Response.json({ ok: false, code: "DOMEGGOOK_SYNC_UNCONFIGURED" }, { status: 503 });
  }
  if (!authorizeDomeggookCloudSync(request)) {
    return Response.json({ ok: false, code: "DOMEGGOOK_SYNC_UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const rows = buildDomeggookCloudRows(await request.json().catch(() => null));
    const admin = await createSupabaseAdminClient();
    if (!admin) throw new Error("Supabase 관리자 연결이 설정되지 않았습니다.");
    const settingsResult = await admin.from("commerce_operation_runs").upsert(
      rows.settingsRow,
      { onConflict: "source_event_id" },
    );
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (rows.runRows.length > 0) {
      const runsResult = await admin.from("commerce_operation_runs").upsert(
        rows.runRows,
        { onConflict: "source_event_id" },
      );
      if (runsResult.error) throw new Error(runsResult.error.message);
    }
    return Response.json({ ok: true, syncedRuns: rows.runRows.length });
  } catch (error) {
    return Response.json({
      ok: false,
      code: "DOMEGGOOK_SYNC_FAILED",
      message: error instanceof Error ? error.message : "실행기록 동기화 실패",
    }, { status: 400 });
  }
}
