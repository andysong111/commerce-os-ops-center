import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return Response.json(config.body, { status: config.status });
  }

  try {
    const stored = await readProductLaunchState(
      config.value,
      identity.value.userId,
    );
    const state = stored?.state_payload;
    if (!state || typeof state !== "object") {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_REQUIRED",
          message: "먼저 신규 상품 출시 진행관리 데이터를 저장해 주세요.",
        },
        { status: 409 },
      );
    }

    const result = await pushCanonicalProductMasterSnapshotFromTrackerState(state, {
      skipBarcodeConflicts: true,
    });
    const skippedConflictCount = result.skippedBarcodeConflicts.length;
    return Response.json({
      ok: true,
      ...result,
      message:
        `상품 ${result.counts.products ?? 0}개, SKU ${result.counts.skus ?? 0}개, ` +
        `위치코드 변경 ${result.counts.skuBarcodeChanges ?? 0}개, ` +
        `샵플링 연결 ${result.counts.listingMappings ?? 0}개, ` +
        `확정 입고원가 ${result.counts.receiptCosts ?? 0}개를 상품마스터에 저장했습니다.` +
        (skippedConflictCount
          ? ` 위치코드가 겹친 상품 ${skippedConflictCount}개는 합치지 않고 건너뛰었습니다.`
          : ""),
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "UNKNOWN_PRODUCT_MASTER_SYNC_ERROR";
    const missingSecret = detail === "PRODUCT_MASTER_INTEGRATION_SECRET_MISSING";
    const migrationRequired = detail.includes("STABLE_SKU_MIGRATION_REQUIRED");
    const conflict =
      detail.includes("SKU_IDENTITY_CONFLICT") ||
      detail.includes("TRACKER_BARCODE_CONFLICT");
    return Response.json(
      {
        ok: false,
        code: missingSecret
          ? "PRODUCT_MASTER_INTEGRATION_NOT_CONFIGURED"
          : migrationRequired
            ? "PRODUCT_MASTER_STABLE_SKU_MIGRATION_REQUIRED"
            : conflict
              ? "PRODUCT_MASTER_SKU_CONFLICT"
              : "PRODUCT_MASTER_SYNC_FAILED",
        message: missingSecret
          ? "OPS Center에 PRODUCT_MASTER_INTEGRATION_SECRET 환경변수를 설정해 주세요."
          : migrationRequired
            ? "상품마스터 Supabase에 불변 SKU 마이그레이션 SQL을 먼저 적용해 주세요."
            : conflict
              ? `동일 위치코드가 서로 다른 SKU에 연결되어 동기화를 중단했습니다: ${detail}`
              : `상품마스터 동기화에 실패했습니다: ${detail}`,
      },
      { status: missingSecret ? 503 : conflict ? 409 : 502 },
    );
  }
}
