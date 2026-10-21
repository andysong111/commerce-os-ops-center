import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  StorageSourcingBudgetSyncError,
  syncPreviousMonthRevenueToStorage,
} from "@/lib/storageSourcingBudgetSync";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAINTENANCE_LIMIT = 500;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "OPS 저장소 정리는 Production에서만 실행됩니다." },
      { status: 403 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET 설정이 없어 저장소 정리를 차단했습니다." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "OPS 저장소 정리 인증에 실패했습니다." },
      { status: 401 },
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Supabase 관리자 설정이 필요합니다." },
      { status: 503 },
    );
  }

  const result = await admin.rpc("run_ops_storage_maintenance", {
    p_limit: MAINTENANCE_LIMIT,
  });
  if (result.error) {
    console.error("[ops-storage-maintenance] RPC failed", result.error);
    return NextResponse.json(
      { ok: false, error: result.error.message },
      { status: 500 },
    );
  }

  // Budget refresh is deliberately attached to the existing dispatcher task rather than
  // adding another Vercel heartbeat. It is safe to retry because both the frozen Shopling
  // revenue source and Storage request ID are deterministic. A bridge failure must not turn
  // successful storage cleanup into a database-pressure failure; the next maintenance run
  // retries it and the warning remains visible in dispatcher result/logs.
  let sourcingBudget:
    | { ok: true; budgetMonth: string; sourceMonth: string; changed: boolean }
    | { ok: false; error: string };
  try {
    const synced = await syncPreviousMonthRevenueToStorage();
    sourcingBudget = {
      ok: true,
      budgetMonth: synced.budgetMonth,
      sourceMonth: synced.sourceMonth,
      changed: synced.changed,
    };
  } catch (error) {
    const code =
      error instanceof StorageSourcingBudgetSyncError
        ? error.code
        : "SOURCING_BUDGET_SYNC_FAILED";
    console.error("[ops-storage-maintenance] sourcing budget sync failed", {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    sourcingBudget = { ok: false, error: code };
  }

  return NextResponse.json({
    ok: true,
    result: result.data,
    sourcingBudget,
  });
}
