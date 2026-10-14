import { NextRequest } from "next/server";
import {
  prepareSeoMarketCapacitySnapshot,
  SeoMarketCapacityReadbackError,
  verifySeoMarketCapacitySnapshotReadback,
} from "@/lib/seoMarketCapacityReadback";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READBACK_COLUMNS = [
  "snapshot_id",
  "market_account_key",
  "market_code",
  "market_name",
  "account_label",
  "maximum_listing_count",
  "active_listing_count",
  "in_flight_count",
  "observation_status",
  "observed_at",
  "source",
].join(",");

function failure(code: string, message: string, status: number) {
  return Response.json({ ok: false, code, message }, { status });
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;

  let snapshot: ReturnType<typeof prepareSeoMarketCapacitySnapshot>;
  try {
    snapshot = prepareSeoMarketCapacitySnapshot(
      await request.json().catch(() => null),
    );
  } catch (error) {
    if (error instanceof SeoMarketCapacityReadbackError) {
      return failure(error.code, error.message, 400);
    }
    return failure(
      "CAPACITY_READBACK_REQUEST_INVALID",
      "마켓 등록수 스냅샷 요청을 확인할 수 없습니다.",
      400,
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return failure(
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "마켓 등록수 스냅샷 저장소가 연결되지 않았습니다.",
      503,
    );
  }

  // A write timeout is ambiguous. Never retry this RPC: always reconcile by the
  // exact owner + snapshot identity below before reporting the outcome.
  const written = await admin.rpc("ingest_seo_market_account_capacities", {
    p_owner_id: context.identity.userId,
    p_snapshot_id: snapshot.snapshotId,
    p_observed_at: snapshot.observedAt,
    p_source: snapshot.source,
    p_observations: snapshot.rows,
  });
  const readback = await admin
    .from("seo_market_account_capacities")
    .select(READBACK_COLUMNS)
    .eq("owner_id", context.identity.userId)
    .eq("snapshot_id", snapshot.snapshotId)
    .limit(100);
  const verification = readback.error
    ? {
        ok: false,
        matchedCount: 0,
        reasonCode: "CAPACITY_READBACK_STORAGE_READ_FAILED",
      }
    : verifySeoMarketCapacitySnapshotReadback(snapshot, readback.data);

  if (verification.ok) {
    const affectedCount = Number(written.data);
    return Response.json({
      ok: true,
      snapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      accountCount: snapshot.rows.length,
      suppliedCount: snapshot.suppliedCount,
      missingCount: snapshot.missingCount,
      affectedCount: Number.isSafeInteger(affectedCount) ? affectedCount : null,
      reconciledAfterWriteError: Boolean(written.error),
      verification: verification.reasonCode,
      externalMarketWrite: false,
    });
  }

  if (written.error) {
    return Response.json(
      {
        ok: false,
        code: "CAPACITY_READBACK_CONFIRM_NEEDED",
        message:
          "저장 결과가 불명확하고 동일 스냅샷 재조회로도 확인되지 않았습니다. 자동 재시도하지 않습니다.",
        snapshotId: snapshot.snapshotId,
        verification: verification.reasonCode,
        matchedCount: verification.matchedCount,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      ok: false,
      code: "CAPACITY_READBACK_VERIFY_FAILED",
      message:
        "저장 호출은 완료됐지만 동일 스냅샷의 전체 마켓 계정이 일치하지 않습니다.",
      snapshotId: snapshot.snapshotId,
      verification: verification.reasonCode,
      matchedCount: verification.matchedCount,
    },
    { status: 409 },
  );
}
