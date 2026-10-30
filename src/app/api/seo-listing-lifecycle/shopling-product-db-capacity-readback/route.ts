import { NextRequest } from "next/server";
import {
  prepareSeoShoplingProductDbSnapshot,
  SeoShoplingProductDbReadbackError,
  verifySeoShoplingProductDbSnapshotReadback,
} from "@/lib/seoShoplingProductDbCapacity";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READBACK_COLUMNS = [
  "owner_id",
  "snapshot_id",
  "maximum_product_code_count",
  "used_product_code_count",
  "observation_status",
  "observed_at",
  "source",
].join(",");

function failure(code: string, message: string, status: number) {
  return Response.json(
    { ok: false, code, message, externalMarketWrite: false },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;

  let snapshot: ReturnType<typeof prepareSeoShoplingProductDbSnapshot>;
  try {
    snapshot = prepareSeoShoplingProductDbSnapshot(
      await request.json().catch(() => null),
    );
  } catch (error) {
    if (error instanceof SeoShoplingProductDbReadbackError) {
      return failure(error.code, error.message, 400);
    }
    return failure(
      "SHOPLING_PRODUCT_DB_READBACK_REQUEST_INVALID",
      "샵플링 상품 DB 수량 요청을 확인할 수 없습니다.",
      400,
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return failure(
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "샵플링 상품 DB 수량 저장소가 연결되지 않았습니다.",
      503,
    );
  }

  // Never retry an ambiguous write. Reconcile the exact snapshot once instead.
  const written = await admin.rpc("ingest_seo_shopling_product_db_capacity", {
    p_owner_id: context.identity.userId,
    p_snapshot_id: snapshot.snapshotId,
    p_observed_at: snapshot.observedAt,
    p_source: snapshot.source,
    p_maximum_product_code_count: snapshot.maximumProductCodeCount,
    p_used_product_code_count: snapshot.usedProductCodeCount,
    p_evidence: snapshot.evidence,
  });
  const readback = await admin
    .from("seo_shopling_product_db_capacities")
    .select(READBACK_COLUMNS)
    .eq("owner_id", context.identity.userId)
    .eq("snapshot_id", snapshot.snapshotId)
    .limit(1)
    .maybeSingle();
  const verification = readback.error
    ? {
        ok: false,
        reasonCode: "SHOPLING_PRODUCT_DB_STORAGE_READ_FAILED",
      }
    : verifySeoShoplingProductDbSnapshotReadback(snapshot, readback.data);

  if (verification.ok) {
    return Response.json({
      ok: true,
      snapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      maximumProductCodeCount: snapshot.maximumProductCodeCount,
      usedProductCodeCount: snapshot.usedProductCodeCount,
      reconciledAfterWriteError: Boolean(written.error),
      verification: verification.reasonCode,
      externalMarketWrite: false,
    });
  }

  if (written.error) {
    return failure(
      "SHOPLING_PRODUCT_DB_READBACK_CONFIRM_NEEDED",
      "저장 결과가 불명확하고 동일 확인번호 재조회로도 확인되지 않았습니다. 자동 재시도하지 않습니다.",
      503,
    );
  }
  return failure(
    "SHOPLING_PRODUCT_DB_READBACK_VERIFY_FAILED",
    "저장은 완료됐지만 같은 확인번호의 상품 DB 수량이 일치하지 않습니다.",
    409,
  );
}
