import { NextRequest } from "next/server";
import {
  selectLatestSeoReadyProducts,
  summarizeSeoListingCanaryReadiness,
  summarizeSeoListingLifecycle,
  summarizeSeoRegistrationOutcomes,
  summarizeSeoVerifiedExposureProgress,
} from "@/lib/seoListingAutomationDashboard";
import {
  calculateSeoPortfolioCapacity,
  SEO_LISTING_COOLDOWN_DAYS,
  SEO_LISTING_EXPOSURE_DAYS,
  SEO_LISTING_MAX_ATTEMPTS,
  SEO_LISTING_RULE_VERSION,
  SEO_MARKET_CAPACITY_MAX_AGE_HOURS,
  type SeoMarketCapacityInput,
} from "@/lib/seoListingLifecyclePolicy";
import {
  planSeoScheduledPortfolioRun,
  SEO_REGISTRATION_FALLBACK_BATCH_LIMIT,
} from "@/lib/seoListingScheduledRun";
import {
  calculateSeoShoplingProductDbCapacity,
  SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS,
} from "@/lib/seoShoplingProductDbCapacity";
import { reconcileSeoListingLifecycleShadow } from "@/lib/seoListingLifecycleReconciliationServer";
import { refreshSeoListingLifecycleShadowDaily } from "@/lib/seoListingLifecycleDailyRefreshServer";
import { listSeoRunJobs } from "@/lib/seoRunJobServer";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;
type StorageError = { message: string; code?: string } | null;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reconciliationSummary(value: unknown) {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as UnknownRecord)
      : {};
  return {
    generatedAt: row.generatedAt,
    source: row.source,
    productsExamined: row.productsExamined,
    productsSeeded: row.productsSeeded,
    productsSkippedExisting: row.productsSkippedExisting,
    productsNeedingReview: row.productsNeedingReview,
    liveRecordCount: row.liveRecordCount,
    protectedRecordCount: row.protectedRecordCount,
    reviewRecordCount: row.reviewRecordCount,
    insertedRecordCount: row.insertedRecordCount,
    insertedEventCount: row.insertedEventCount,
    internalWriteApplied: row.internalWriteApplied,
    shoplingReadback: row.shoplingReadback,
    legacyOnboarding:
      row.legacyOnboarding && typeof row.legacyOnboarding === "object"
        ? row.legacyOnboarding
        : null,
    productReviews: Array.isArray(row.productReviews)
      ? row.productReviews
      : [],
    externalMarketWrite: false,
  };
}

function dailyRefreshSummary(value: unknown) {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as UnknownRecord)
      : {};
  return {
    generatedAt: row.generatedAt,
    source: row.source,
    productsExamined: row.productsExamined,
    recordsExamined: row.recordsExamined,
    refreshedRecordCount: row.refreshedRecordCount,
    updatedRecordCount: row.updatedRecordCount,
    protectedRecordCount: row.protectedRecordCount,
    reviewRecordCount: row.reviewRecordCount,
    verifiedDayEventCount: row.verifiedDayEventCount,
    shadowDueRecordCount: row.shadowDueRecordCount,
    insertedEventCount: row.insertedEventCount,
    insertedShadowActionCount: row.insertedShadowActionCount,
    internalWriteApplied: row.internalWriteApplied,
    shoplingReadback: row.shoplingReadback,
    externalMarketWrite: false,
  };
}

function missingLifecycleSchema(error: StorageError) {
  const message = text(error?.message).toLowerCase();
  const code = text(error?.code).toUpperCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

function throwUnexpectedStorageError(label: string, error: StorageError) {
  if (!error || missingLifecycleSchema(error)) return;
  throw new Error(`${label}:${error.message}`);
}

function capacityInput(row: UnknownRecord): SeoMarketCapacityInput {
  return {
    marketAccountKey: text(row.market_account_key),
    marketName: text(row.market_name),
    accountLabel: text(row.account_label),
    maximumListingCount: numberOrNull(row.maximum_listing_count),
    activeListingCount: numberOrNull(row.active_listing_count),
    inFlightCount: numberOrNull(row.in_flight_count),
    safetyBuffer: numberOrNull(row.safety_buffer),
    observationStatus:
      row.observation_status === "verified" ||
      row.observation_status === "error"
        ? row.observation_status
        : "unknown",
    observedAt: text(row.observed_at) || null,
    requiredForAutoBatch: row.required_for_auto_batch !== false,
  };
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return Response.json(
      {
        ok: false,
        code: "SUPABASE_ADMIN_NOT_CONFIGURED",
        message: "자동 물갈이 현황 저장소가 연결되지 않았습니다.",
      },
      { status: 503 },
    );
  }

  try {
    const [
      jobs,
      policyResult,
      capacityResult,
      shoplingProductDbResult,
      lifecycleResult,
      dailyTaskResult,
      canaryActionResult,
    ] = await Promise.all([
        listSeoRunJobs(context, { includeArchived: false, limit: 1000 }),
        admin
          .from("seo_listing_rotation_policies")
          .select("owner_id,mode,enabled,exposure_days,cooldown_days,max_attempts,timezone,updated_at")
          .eq("owner_id", context.identity.userId)
          .maybeSingle(),
        admin
          .from("seo_market_account_capacities")
          .select(
            "snapshot_id,market_account_key,market_code,market_name,account_label,maximum_listing_count,active_listing_count,in_flight_count,safety_buffer,required_for_auto_batch,observation_status,observed_at,source,updated_at",
          )
          .eq("owner_id", context.identity.userId)
          .order("market_name")
          .limit(100),
        admin
          .from("seo_shopling_product_db_capacities")
          .select(
            "owner_id,snapshot_id,maximum_product_code_count,used_product_code_count,observation_status,observed_at,source,updated_at",
          )
          .eq("owner_id", context.identity.userId)
          .maybeSingle(),
        admin
          .from("seo_listing_lifecycle_records")
          .select(
            "id,market_account_key,launch_item_id,model_number,product_name,state,attempt_count,current_run_id,goods_key,live_started_at,last_verified_live_at,sales_count_during_attempt,next_eligible_at,exposure_verified,requires_review,review_reason,evidence,evaluated_at,updated_at",
          )
          .eq("owner_id", context.identity.userId)
          .order("evaluated_at", { ascending: false })
          .limit(1000),
        admin
          .from("ops_dispatch_tasks")
          .select(
            "task_key,enabled,next_run_at,last_status,last_started_at,last_finished_at,last_error,consecutive_failures,updated_at",
          )
          .eq("task_key", "seo-listing-lifecycle-shadow-refresh")
          .maybeSingle(),
        admin
          .from("seo_listing_rotation_actions")
          .select(
            "id,lifecycle_record_id,market_account_key,launch_item_id,run_id,goods_key,action_type,status,shadow_mode,dedupe_key,scheduled_for,claimed_at,executed_at,readback_verified_at,evidence",
          )
          .eq("owner_id", context.identity.userId)
          .order("scheduled_for", { ascending: true })
          .limit(3000),
      ]);

    throwUnexpectedStorageError("SEO_LISTING_POLICY_READ_FAILED", policyResult.error);
    throwUnexpectedStorageError("SEO_MARKET_CAPACITY_READ_FAILED", capacityResult.error);
    throwUnexpectedStorageError(
      "SEO_SHOPLING_PRODUCT_DB_CAPACITY_READ_FAILED",
      shoplingProductDbResult.error,
    );
    throwUnexpectedStorageError("SEO_LISTING_LIFECYCLE_READ_FAILED", lifecycleResult.error);
    throwUnexpectedStorageError(
      "SEO_LISTING_CANARY_ACTION_READ_FAILED",
      canaryActionResult.error,
    );

    const schemaReady = ![
      policyResult.error,
      capacityResult.error,
      shoplingProductDbResult.error,
      lifecycleResult.error,
      canaryActionResult.error,
    ].some(missingLifecycleSchema);
    const policyRow =
      policyResult.data && typeof policyResult.data === "object"
        ? (policyResult.data as UnknownRecord)
        : null;
    const capacityRows = Array.isArray(capacityResult.data)
      ? (capacityResult.data as UnknownRecord[])
      : [];
    const shoplingProductDbRow =
      shoplingProductDbResult.data &&
      typeof shoplingProductDbResult.data === "object"
        ? (shoplingProductDbResult.data as UnknownRecord)
        : null;
    const lifecycleRows = Array.isArray(lifecycleResult.data)
      ? (lifecycleResult.data as UnknownRecord[])
      : [];
    const dailyTaskRow =
      dailyTaskResult.data && typeof dailyTaskResult.data === "object"
        ? (dailyTaskResult.data as UnknownRecord)
        : null;
    const canaryActionRows = Array.isArray(canaryActionResult.data)
      ? (canaryActionResult.data as UnknownRecord[])
      : [];
    const readyProducts = selectLatestSeoReadyProducts(jobs);
    const capacity = calculateSeoPortfolioCapacity(
      capacityRows.map(capacityInput),
      new Date(),
    );
    const shoplingProductDb = calculateSeoShoplingProductDbCapacity(
      shoplingProductDbRow,
      new Date(),
    );
    const lifecycle = summarizeSeoListingLifecycle(lifecycleRows);
    const exposureProgress =
      summarizeSeoVerifiedExposureProgress(lifecycleRows);
    const canaryReadiness = summarizeSeoListingCanaryReadiness(
      lifecycleRows,
      canaryActionRows,
      {
        exposureDays: SEO_LISTING_EXPOSURE_DAYS,
        requiredMarketListingCount: 6,
        readbackMaxAgeHours: 24,
      },
    );
    const registration = summarizeSeoRegistrationOutcomes(jobs);
    const dailyTaskFailures = numberOrNull(
      dailyTaskRow?.consecutive_failures,
    );
    const dailyTaskLastError = text(dailyTaskRow?.last_error);
    const dailyTaskLastStatus = text(dailyTaskRow?.last_status) || "unknown";
    const dailyTaskEnabled = dailyTaskRow?.enabled === true;
    const dailyTaskHealthy =
      dailyTaskEnabled &&
      (dailyTaskFailures ?? 0) === 0 &&
      dailyTaskLastStatus !== "failure" &&
      !dailyTaskLastError;
    const policyMatchesCode =
      !policyRow ||
      (numberOrNull(policyRow.exposure_days) === SEO_LISTING_EXPOSURE_DAYS &&
        numberOrNull(policyRow.cooldown_days) === SEO_LISTING_COOLDOWN_DAYS &&
        numberOrNull(policyRow.max_attempts) === SEO_LISTING_MAX_ATTEMPTS);
    const systemBlocked = !schemaReady || !policyMatchesCode;
    const scheduledPlan = planSeoScheduledPortfolioRun({
      readyProducts,
      lifecycleRows,
      safeBatchCount: capacity.safeBatchCount,
      capacityBlocked: systemBlocked || capacity.blocked,
      allowBoundedRegistrationWithoutCapacity:
        !systemBlocked && capacity.blocked,
      fallbackBatchCount: SEO_REGISTRATION_FALLBACK_BATCH_LIMIT,
      shoplingProductDbSafeNewProductCount:
        shoplingProductDb.safeNewProductCount,
      shoplingProductDbBlocked: shoplingProductDb.blocked,
      shoplingProductDbReasonCode: shoplingProductDb.reasonCode,
      now: new Date(),
    });
    const warnings = [
      "SHADOW_ONLY_NO_MARKET_WRITE",
      ...(!schemaReady ? ["LIFECYCLE_SCHEMA_NOT_APPLIED"] : []),
      ...(!policyRow ? ["POLICY_ROW_NOT_CREATED"] : []),
      ...(!policyMatchesCode ? ["POLICY_VERSION_MISMATCH"] : []),
      ...(dailyTaskResult.error
        ? ["DAILY_SHADOW_REFRESH_STATUS_UNAVAILABLE"]
        : []),
      ...(!dailyTaskResult.error && !dailyTaskRow
        ? ["DAILY_SHADOW_REFRESH_TASK_MISSING"]
        : []),
      ...(dailyTaskRow && !dailyTaskEnabled
        ? ["DAILY_SHADOW_REFRESH_TASK_DISABLED"]
        : []),
      ...(dailyTaskRow && !dailyTaskHealthy
        ? ["DAILY_SHADOW_REFRESH_LAST_RUN_FAILED"]
        : []),
      ...(canaryReadiness.blockedProductCount > 0
        ? ["CANARY_CANDIDATE_EVIDENCE_INCOMPLETE"]
        : []),
      ...(scheduledPlan.capacityFallbackActive
        ? ["REGISTRATION_ONLY_FALLBACK_ACTIVE"]
        : []),
      ...(shoplingProductDb.blocked ? [shoplingProductDb.reasonCode] : []),
      ...capacity.reasonCodes,
    ];

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      schemaReady,
      mode: "shadow",
      autoExecutionEnabled: false,
      policy: {
        exposureDays: SEO_LISTING_EXPOSURE_DAYS,
        cooldownDays: SEO_LISTING_COOLDOWN_DAYS,
        maxAttempts: SEO_LISTING_MAX_ATTEMPTS,
        capacityMaxAgeHours: SEO_MARKET_CAPACITY_MAX_AGE_HOURS,
        shoplingProductDbMaxAgeHours:
          SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS,
        ruleVersion: SEO_LISTING_RULE_VERSION,
      },
      summary: {
        seoReadyProductCount: readyProducts.length,
        shadowRegistrationCount: scheduledPlan.selectedProducts.length,
        scheduledRegistrationCount: scheduledPlan.selectedProducts.length,
        eligibleRegistrationCount: scheduledPlan.eligibleRegistrationCount,
        excludedByLifecycleCount: scheduledPlan.excludedByLifecycleCount,
        limitedByCapacityCount: scheduledPlan.limitedByCapacityCount,
        soldOutDeleteDueCount: scheduledPlan.soldOutDeleteDueCount,
        relistDueCount: scheduledPlan.relistDueCount,
        relistFreshCodeReadyCount: scheduledPlan.relistFreshCodeReadyCount,
        relistFreshCodeSelectedCount:
          scheduledPlan.relistFreshCodeSelectedCount,
        relistFreshCodeBlockedCount:
          scheduledPlan.relistFreshCodeBlockedCount,
        protectedProductCount: scheduledPlan.protectedProductCount,
        cooldownProductCount: scheduledPlan.cooldownProductCount,
        reviewProductCount: scheduledPlan.reviewProductCount,
        capacityFallbackActive: scheduledPlan.capacityFallbackActive,
        scheduledBatchLimit: scheduledPlan.capacityFallbackActive
          ? Math.min(
              SEO_REGISTRATION_FALLBACK_BATCH_LIMIT,
              shoplingProductDb.safeNewProductCount,
            )
          : Math.min(
              capacity.safeBatchCount,
              shoplingProductDb.safeNewProductCount,
            ),
        registeredProductCount: registration.registeredProductCount,
        registrationFailedProductCount:
          registration.registrationFailedProductCount,
        processingProductCount: registration.processingProductCount,
        verifiedSalesCount: lifecycle.verifiedSalesCount,
        safeBatchCount: capacity.safeBatchCount,
        marketCount: capacity.markets.length,
        blockedMarketCount: capacity.markets.filter((market) => market.blocked)
          .length,
        lifecycle: lifecycle.counts,
        requiresReviewCount: lifecycle.requiresReviewCount,
        legacyManagedProductCount: lifecycle.legacyManagedProductCount,
        legacyReviewProductCount: lifecycle.legacyReviewProductCount,
      },
      operations: {
        dailyRefresh: {
          enabled: dailyTaskEnabled,
          healthy: dailyTaskHealthy,
          lastStatus: dailyTaskLastStatus,
          nextRunAt: text(dailyTaskRow?.next_run_at) || null,
          lastStartedAt: text(dailyTaskRow?.last_started_at) || null,
          lastFinishedAt: text(dailyTaskRow?.last_finished_at) || null,
          consecutiveFailures: dailyTaskFailures ?? 0,
          externalMarketWrite: false,
        },
        exposureProgress,
        canaryReadiness,
      },
      markets: capacity.markets,
      shoplingProductDb,
      readyProducts: readyProducts.slice(0, 30),
      scheduledRun: {
        executable: scheduledPlan.selectedProducts.length > 0,
        reasonCode: scheduledPlan.reasonCode,
        runIds: scheduledPlan.selectedProducts.map((product) => product.runId),
        products: scheduledPlan.selectedProducts,
        cadenceLabel: "재고 동기화가 끝난 뒤 하루 1회",
        capacityMode: scheduledPlan.capacityFallbackActive
          ? "bounded_registration_only"
          : shoplingProductDb.blocked
            ? "shopling_product_db_blocked"
            : "verified_market_capacity",
        externalDeleteEnabled: false,
      },
      warnings: [...new Set(warnings)],
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_LISTING_LIFECYCLE_DASHBOARD_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "자동 물갈이 현황을 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const action =
    body && typeof body === "object" && !Array.isArray(body)
      ? text((body as UnknownRecord).action)
      : "";
  if (
    ![
      "prepare_scheduled_run",
      "preview_shadow_reconciliation",
      "apply_shadow_reconciliation",
      "refresh_shadow_daily",
    ].includes(action)
  ) {
    return Response.json(
      {
        ok: false,
        code: "SEO_LIFECYCLE_ACTION_INVALID",
        message: "지원하지 않는 자동운영 요청입니다.",
      },
      { status: 400 },
    );
  }

  if (action === "refresh_shadow_daily") {
    const authenticated = await requireSeoTitleLedgerContext(request);
    if (!authenticated.ok) return authenticated.response;
    try {
      const refresh = await refreshSeoListingLifecycleShadowDaily(
        authenticated.value.identity.userId,
        { apply: true },
      );
      return Response.json({
        ok: true,
        refresh: dailyRefreshSummary(refresh),
        externalMarketWrite: false,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: "SEO_LIFECYCLE_DAILY_REFRESH_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "자동 물갈이 일일 근거 확인에 실패했습니다.",
          externalMarketWrite: false,
        },
        { status: 500 },
      );
    }
  }

  if (
    action === "preview_shadow_reconciliation" ||
    action === "apply_shadow_reconciliation"
  ) {
    const authenticated = await requireSeoTitleLedgerContext(request);
    if (!authenticated.ok) return authenticated.response;
    try {
      const reconciliation = await reconcileSeoListingLifecycleShadow(
        authenticated.value,
        { apply: action === "apply_shadow_reconciliation" },
      );
      return Response.json({
        ok: true,
        reconciliation: reconciliationSummary(reconciliation),
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: "SEO_LIFECYCLE_RECONCILIATION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "자동 물갈이 근거 대사에 실패했습니다.",
          externalMarketWrite: false,
        },
        { status: 500 },
      );
    }
  }

  let reconciliation: UnknownRecord = {};
  try {
    const authenticated = await requireSeoTitleLedgerContext(request);
    if (!authenticated.ok) return authenticated.response;
    reconciliation = reconciliationSummary(
      await reconcileSeoListingLifecycleShadow(authenticated.value, {
        apply: true,
      }),
    );
  } catch (error) {
    reconciliation = {
      ok: false,
      code: "SEO_LIFECYCLE_RECONCILIATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "자동 물갈이 내부표 갱신에 실패했습니다.",
      externalMarketWrite: false,
    };
  }
  const dashboardResponse = await GET(request);
  const dashboard = (await dashboardResponse.json().catch(() => ({}))) as UnknownRecord;
  if (!dashboardResponse.ok || dashboard.ok !== true) {
    return Response.json(dashboard, { status: dashboardResponse.status });
  }
  const scheduledRun =
    dashboard.scheduledRun && typeof dashboard.scheduledRun === "object"
      ? (dashboard.scheduledRun as UnknownRecord)
      : {};
  const runIds = Array.isArray(scheduledRun.runIds)
    ? scheduledRun.runIds.map(text).filter(Boolean)
    : [];
  return Response.json({
    ok: true,
    preparedAt: dashboard.generatedAt,
    scheduledRun,
    summary: dashboard.summary,
    warnings: [
      ...(Array.isArray(dashboard.warnings) ? dashboard.warnings : []),
      ...(reconciliation.ok === false
        ? ["SHADOW_RECONCILIATION_FAILED"]
        : []),
    ],
    reconciliation,
    externalMarketWrite: false,
    requiresBrowserHandoff: runIds.length > 0,
  });
}
