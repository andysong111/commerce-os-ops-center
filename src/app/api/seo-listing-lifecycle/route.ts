import { NextRequest } from "next/server";
import {
  selectLatestSeoReadyProducts,
  summarizeSeoListingLifecycle,
  summarizeSeoRegistrationOutcomes,
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
    const [jobs, policyResult, capacityResult, lifecycleResult] =
      await Promise.all([
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
          .from("seo_listing_lifecycle_records")
          .select(
            "id,market_account_key,launch_item_id,model_number,product_name,state,attempt_count,current_run_id,goods_key,live_started_at,last_verified_live_at,sales_count_during_attempt,next_eligible_at,exposure_verified,requires_review,review_reason,evaluated_at,updated_at",
          )
          .eq("owner_id", context.identity.userId)
          .order("evaluated_at", { ascending: false })
          .limit(1000),
      ]);

    throwUnexpectedStorageError("SEO_LISTING_POLICY_READ_FAILED", policyResult.error);
    throwUnexpectedStorageError("SEO_MARKET_CAPACITY_READ_FAILED", capacityResult.error);
    throwUnexpectedStorageError("SEO_LISTING_LIFECYCLE_READ_FAILED", lifecycleResult.error);

    const schemaReady = ![
      policyResult.error,
      capacityResult.error,
      lifecycleResult.error,
    ].some(missingLifecycleSchema);
    const policyRow =
      policyResult.data && typeof policyResult.data === "object"
        ? (policyResult.data as UnknownRecord)
        : null;
    const capacityRows = Array.isArray(capacityResult.data)
      ? (capacityResult.data as UnknownRecord[])
      : [];
    const lifecycleRows = Array.isArray(lifecycleResult.data)
      ? (lifecycleResult.data as UnknownRecord[])
      : [];
    const readyProducts = selectLatestSeoReadyProducts(jobs);
    const capacity = calculateSeoPortfolioCapacity(
      capacityRows.map(capacityInput),
      new Date(),
    );
    const lifecycle = summarizeSeoListingLifecycle(lifecycleRows);
    const registration = summarizeSeoRegistrationOutcomes(jobs);
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
      now: new Date(),
    });
    const warnings = [
      "SHADOW_ONLY_NO_MARKET_WRITE",
      ...(!schemaReady ? ["LIFECYCLE_SCHEMA_NOT_APPLIED"] : []),
      ...(!policyRow ? ["POLICY_ROW_NOT_CREATED"] : []),
      ...(!policyMatchesCode ? ["POLICY_VERSION_MISMATCH"] : []),
      ...(scheduledPlan.capacityFallbackActive
        ? ["REGISTRATION_ONLY_FALLBACK_ACTIVE"]
        : []),
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
        protectedProductCount: scheduledPlan.protectedProductCount,
        cooldownProductCount: scheduledPlan.cooldownProductCount,
        reviewProductCount: scheduledPlan.reviewProductCount,
        capacityFallbackActive: scheduledPlan.capacityFallbackActive,
        scheduledBatchLimit: scheduledPlan.capacityFallbackActive
          ? SEO_REGISTRATION_FALLBACK_BATCH_LIMIT
          : capacity.safeBatchCount,
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
      },
      markets: capacity.markets,
      readyProducts: readyProducts.slice(0, 30),
      scheduledRun: {
        executable: scheduledPlan.selectedProducts.length > 0,
        reasonCode: scheduledPlan.reasonCode,
        runIds: scheduledPlan.selectedProducts.map((product) => product.runId),
        products: scheduledPlan.selectedProducts,
        cadenceLabel: "재고 동기화가 끝난 뒤 하루 1회",
        capacityMode: scheduledPlan.capacityFallbackActive
          ? "bounded_registration_only"
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
  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "prepare_scheduled_run") {
    return Response.json(
      {
        ok: false,
        code: "SEO_LIFECYCLE_ACTION_INVALID",
        message: "지원하지 않는 자동운영 요청입니다.",
      },
      { status: 400 },
    );
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
    warnings: dashboard.warnings,
    externalMarketWrite: false,
    requiresBrowserHandoff: runIds.length > 0,
  });
}
