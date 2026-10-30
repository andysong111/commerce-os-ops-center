import type { SeoRunJobRow } from "@/lib/seoRunJobServer";
import type { SeoListingLifecycleState } from "@/lib/seoListingLifecyclePolicy";

export type SeoReadyProduct = {
  runId: string;
  launchItemId: string;
  modelNumber: string;
  productName: string;
  runCreatedAt: string;
};

export type SeoListingLifecycleSummaryRow = {
  id?: unknown;
  launch_item_id?: unknown;
  market_account_key?: unknown;
  model_number?: unknown;
  product_name?: unknown;
  goods_key?: unknown;
  state?: unknown;
  exposure_verified?: unknown;
  requires_review?: unknown;
  sales_count_during_attempt?: unknown;
  current_run_id?: unknown;
  last_verified_live_at?: unknown;
  evidence?: unknown;
};

export type SeoListingCanaryActionRow = {
  id?: unknown;
  lifecycle_record_id?: unknown;
  market_account_key?: unknown;
  launch_item_id?: unknown;
  goods_key?: unknown;
  action_type?: unknown;
  status?: unknown;
  shadow_mode?: unknown;
  run_id?: unknown;
  dedupe_key?: unknown;
  scheduled_for?: unknown;
  claimed_at?: unknown;
  executed_at?: unknown;
  readback_verified_at?: unknown;
  evidence?: unknown;
};

export type SeoListingCanaryBlockReason =
  | "MARKET_LISTING_COUNT_MISMATCH"
  | "LIFECYCLE_EVIDENCE_INCOMPLETE"
  | "CURRENT_RUN_ID_MISSING_OR_MISMATCHED"
  | "LISTING_IDENTITY_MISSING_OR_DUPLICATED"
  | "LIVE_READBACK_MISSING_OR_STALE"
  | "CURRENT_RUN_ACTION_PAIR_INCOMPLETE"
  | "ACTION_DEDUPE_KEY_MISSING_OR_DUPLICATED"
  | "ACTIVE_OR_UNCERTAIN_ACTION_EXISTS";

export type SeoListingCanaryOptions = {
  exposureDays?: number;
  requiredMarketListingCount?: number;
  readbackMaxAgeHours?: number;
  now?: Date;
};

export type SeoVerifiedExposureProgress = {
  trackedProductCount: number;
  maxVerifiedExposureDays: number;
  dueSoonProductCount: number;
  progressBands: {
    days0To29: number;
    days30To49: number;
    days50To59: number;
    days60Plus: number;
  };
};

export type SeoListingCanaryReadiness = {
  preflightVersion: "seo-listing-canary-preflight-v1";
  dueProductCount: number;
  readyProductCount: number;
  blockedProductCount: number;
  requiredMarketListingCount: number;
  requiredActionCount: number;
  readbackMaxAgeHours: number;
  blockingReasonCounts: Partial<Record<SeoListingCanaryBlockReason, number>>;
  approvalRequired: true;
  externalMarketWrite: false;
  executionLocked: true;
  autoRetryOnUncertain: false;
  recoveryMode: "STOP_AND_CONFIRM_READBACK";
  executionSteps: readonly [
    "RECHECK_LIVE_AND_ZERO_SALES",
    "SOLD_OUT",
    "VERIFY_SOLD_OUT_READBACK",
    "DELETE",
    "VERIFY_DELETE_READBACK",
  ];
  selectedCandidate: null | {
    launchItemId: string;
    modelNumber: string;
    productName: string;
    currentRunId: string;
    marketListingCount: number;
    actionCount: number;
    dedupeKeyCount: number;
    verifiedExposureDays: number;
    latestLiveReadbackAt: string;
    scheduledFor: string;
  };
};

export const SEO_LISTING_CANARY_REQUIRED_MARKET_LISTING_COUNT = 6;
export const SEO_LISTING_CANARY_READBACK_MAX_AGE_HOURS = 24;
export const SEO_LISTING_CANARY_EXECUTION_STEPS = [
  "RECHECK_LIVE_AND_ZERO_SALES",
  "SOLD_OUT",
  "VERIFY_SOLD_OUT_READBACK",
  "DELETE",
  "VERIFY_DELETE_READBACK",
] as const;

const ACTIVE_OR_UNCERTAIN_ACTION_STATUSES = new Set([
  "pending",
  "claimed",
  "confirm_needed",
]);

const STATES: SeoListingLifecycleState[] = [
  "READY",
  "LIVE",
  "COOLDOWN",
  "PROTECTED",
  "RETIRE_CANDIDATE",
  "EXCEPTION",
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function exactNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function instant(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshPastInstant(value: unknown, nowMs: number, maxAgeMs: number) {
  const parsed = instant(value);
  return parsed > 0 && parsed <= nowMs && nowMs - parsed <= maxAgeMs;
}

function addBlockingReason(
  reasons: Set<SeoListingCanaryBlockReason>,
  reason: SeoListingCanaryBlockReason,
) {
  reasons.add(reason);
}

function jobInstant(job: { run_created_at: string; created_at: string }) {
  return instant(job.run_created_at) || instant(job.created_at);
}

export function selectLatestSeoReadyProducts(
  jobs: Array<
    Pick<
      SeoRunJobRow,
      | "run_id"
      | "launch_item_id"
      | "model_number"
      | "product_name"
      | "status"
      | "registration_status"
      | "run_created_at"
      | "created_at"
    >
  >,
) {
  const latestByProduct = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    const launchItemId = text(job.launch_item_id);
    if (!launchItemId) continue;
    const current = latestByProduct.get(launchItemId);
    const jobTime = jobInstant(job);
    const currentTime = current ? jobInstant(current) : -1;
    if (
      !current ||
      jobTime > currentTime ||
      (jobTime === currentTime && text(job.run_id) > text(current.run_id))
    ) {
      latestByProduct.set(launchItemId, job);
    }
  }

  return [...latestByProduct.values()]
    .filter(
      (job) => job.status === "ready" && job.registration_status === "idle",
    )
    .sort((left, right) => {
      const timeDifference = jobInstant(left) - jobInstant(right);
      return timeDifference || text(left.run_id).localeCompare(text(right.run_id));
    })
    .map(
      (job): SeoReadyProduct => ({
        runId: text(job.run_id),
        launchItemId: text(job.launch_item_id),
        modelNumber: text(job.model_number),
        productName: text(job.product_name),
        runCreatedAt: text(job.run_created_at),
      }),
    );
}

export function summarizeSeoListingLifecycle(
  rows: SeoListingLifecycleSummaryRow[],
) {
  const counts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<
    SeoListingLifecycleState,
    number
  >;
  let requiresReviewCount = 0;
  let verifiedSalesCount = 0;
  const legacyManagedProducts = new Set<string>();
  const legacyReviewProducts = new Set<string>();
  for (const row of rows) {
    const state = text(row.state) as SeoListingLifecycleState;
    if (STATES.includes(state)) counts[state] += 1;
    if (row.requires_review === true) requiresReviewCount += 1;
    if (
      text(record(row.evidence).source) ===
      "seo-listing-legacy-shadow-onboarding-v1"
    ) {
      const launchItemId = text(row.launch_item_id);
      if (launchItemId) legacyManagedProducts.add(launchItemId);
      if (launchItemId && row.requires_review === true) {
        legacyReviewProducts.add(launchItemId);
      }
    }
    const salesCount = Number(row.sales_count_during_attempt);
    if (Number.isSafeInteger(salesCount) && salesCount > 0) {
      verifiedSalesCount += salesCount;
    }
  }
  return {
    counts,
    requiresReviewCount,
    verifiedSalesCount,
    legacyManagedProductCount: legacyManagedProducts.size,
    legacyReviewProductCount: legacyReviewProducts.size,
  };
}

export function summarizeSeoVerifiedExposureProgress(
  rows: SeoListingLifecycleSummaryRow[],
): SeoVerifiedExposureProgress {
  const daysByProduct = new Map<string, number>();
  for (const row of rows) {
    if (text(row.state) !== "LIVE") continue;
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId) continue;
    const verifiedExposureDays = nonNegativeInteger(
      record(row.evidence).verifiedExposureDays,
    );
    daysByProduct.set(
      launchItemId,
      Math.max(daysByProduct.get(launchItemId) ?? 0, verifiedExposureDays),
    );
  }

  const progress: SeoVerifiedExposureProgress = {
    trackedProductCount: daysByProduct.size,
    maxVerifiedExposureDays: 0,
    dueSoonProductCount: 0,
    progressBands: {
      days0To29: 0,
      days30To49: 0,
      days50To59: 0,
      days60Plus: 0,
    },
  };
  for (const verifiedExposureDays of daysByProduct.values()) {
    progress.maxVerifiedExposureDays = Math.max(
      progress.maxVerifiedExposureDays,
      verifiedExposureDays,
    );
    if (verifiedExposureDays >= 60) {
      progress.progressBands.days60Plus += 1;
    } else if (verifiedExposureDays >= 50) {
      progress.progressBands.days50To59 += 1;
      progress.dueSoonProductCount += 1;
    } else if (verifiedExposureDays >= 30) {
      progress.progressBands.days30To49 += 1;
    } else {
      progress.progressBands.days0To29 += 1;
    }
  }
  return progress;
}

export function summarizeSeoListingCanaryReadiness(
  lifecycleRows: SeoListingLifecycleSummaryRow[],
  actionRows: SeoListingCanaryActionRow[],
  options: number | SeoListingCanaryOptions = {},
): SeoListingCanaryReadiness {
  const configuration =
    typeof options === "number" ? { exposureDays: options } : options;
  const exposureDays = Math.max(
    1,
    nonNegativeInteger(configuration.exposureDays ?? 60),
  );
  const requiredMarketListingCount = Math.max(
    1,
    nonNegativeInteger(
      configuration.requiredMarketListingCount ??
        SEO_LISTING_CANARY_REQUIRED_MARKET_LISTING_COUNT,
    ),
  );
  const readbackMaxAgeHours = Math.max(
    1,
    nonNegativeInteger(
      configuration.readbackMaxAgeHours ??
        SEO_LISTING_CANARY_READBACK_MAX_AGE_HOURS,
    ),
  );
  const nowMs = (configuration.now ?? new Date()).getTime();
  const readbackMaxAgeMs = readbackMaxAgeHours * 60 * 60 * 1000;
  const lifecycleByProduct = new Map<
    string,
    SeoListingLifecycleSummaryRow[]
  >();
  for (const row of lifecycleRows) {
    const launchItemId = text(row.launch_item_id);
    const lifecycleRecordId = text(row.id);
    if (!launchItemId || !lifecycleRecordId) continue;
    const rows = lifecycleByProduct.get(launchItemId) ?? [];
    rows.push(row);
    lifecycleByProduct.set(launchItemId, rows);
  }

  const actionsByLifecycleRecord = new Map<
    string,
    SeoListingCanaryActionRow[]
  >();
  for (const row of actionRows) {
    const lifecycleRecordId = text(row.lifecycle_record_id);
    if (!lifecycleRecordId) continue;
    const rows = actionsByLifecycleRecord.get(lifecycleRecordId) ?? [];
    rows.push(row);
    actionsByLifecycleRecord.set(lifecycleRecordId, rows);
  }

  const readyCandidates: Array<
    NonNullable<SeoListingCanaryReadiness["selectedCandidate"]>
  > = [];
  const blockingReasonCounts: Partial<
    Record<SeoListingCanaryBlockReason, number>
  > = {};
  let dueProductCount = 0;
  for (const [launchItemId, rows] of lifecycleByProduct) {
    const dueRows = rows.filter((row) => {
      const verifiedExposureDays = nonNegativeInteger(
        record(row.evidence).verifiedExposureDays,
      );
      return (
        text(row.state) === "LIVE" &&
        row.exposure_verified === true &&
        row.requires_review !== true &&
        exactNonNegativeInteger(row.sales_count_during_attempt) === 0 &&
        verifiedExposureDays >= exposureDays
      );
    });
    if (dueRows.length === 0) continue;
    dueProductCount += 1;
    const blockingReasons = new Set<SeoListingCanaryBlockReason>();
    if (rows.length !== requiredMarketListingCount) {
      addBlockingReason(blockingReasons, "MARKET_LISTING_COUNT_MISMATCH");
    }
    if (dueRows.length !== rows.length) {
      addBlockingReason(blockingReasons, "LIFECYCLE_EVIDENCE_INCOMPLETE");
    }

    const currentRunIds = new Set(
      rows.map((row) => text(row.current_run_id)).filter(Boolean),
    );
    if (currentRunIds.size !== 1 || rows.some((row) => !text(row.current_run_id))) {
      addBlockingReason(
        blockingReasons,
        "CURRENT_RUN_ID_MISSING_OR_MISMATCHED",
      );
    }
    const currentRunId = [...currentRunIds][0] ?? "";
    const goodsKeys = rows.map((row) => text(row.goods_key));
    const marketAccountKeys = rows.map((row) => text(row.market_account_key));
    if (
      goodsKeys.some((value) => !value) ||
      marketAccountKeys.some((value) => !value) ||
      new Set(goodsKeys).size !== rows.length ||
      new Set(marketAccountKeys).size !== rows.length
    ) {
      addBlockingReason(
        blockingReasons,
        "LISTING_IDENTITY_MISSING_OR_DUPLICATED",
      );
    }

    const liveReadbacks = rows.map((row) => text(row.last_verified_live_at));
    if (
      rows.some((row) => {
        const evidence = record(row.evidence);
        return (
          !isFreshPastInstant(
            row.last_verified_live_at,
            nowMs,
            readbackMaxAgeMs,
          ) ||
          text(evidence.shoplingSaleStatus) !== "B" ||
          evidence.externalMarketWrite !== false
        );
      })
    ) {
      addBlockingReason(blockingReasons, "LIVE_READBACK_MISSING_OR_STALE");
    }

    const candidateActions: SeoListingCanaryActionRow[] = [];
    for (const lifecycleRow of rows) {
      const lifecycleRecordId = text(lifecycleRow.id);
      const goodsKey = text(lifecycleRow.goods_key);
      const marketAccountKey = text(lifecycleRow.market_account_key);
      if (!lifecycleRecordId || !goodsKey || !marketAccountKey) {
        addBlockingReason(
          blockingReasons,
          "LISTING_IDENTITY_MISSING_OR_DUPLICATED",
        );
        continue;
      }
      const allRecordActions =
        actionsByLifecycleRecord.get(lifecycleRecordId) ?? [];
      if (
        allRecordActions.some((action) =>
          ACTIVE_OR_UNCERTAIN_ACTION_STATUSES.has(text(action.status)),
        )
      ) {
        addBlockingReason(
          blockingReasons,
          "ACTIVE_OR_UNCERTAIN_ACTION_EXISTS",
        );
      }
      const currentRunActions = allRecordActions.filter(
        (action) => text(action.run_id) === currentRunId,
      );
      const matchingActions = currentRunActions.filter(
        (action) =>
          text(action.launch_item_id) === launchItemId &&
          text(action.goods_key) === goodsKey &&
          text(action.market_account_key) === marketAccountKey &&
          text(action.status) === "shadow" &&
          action.shadow_mode === true &&
          record(action.evidence).externalMarketWrite === false,
      );
      const soldOutActions = matchingActions.filter(
        (action) => text(action.action_type) === "SOLD_OUT",
      );
      const deleteActions = matchingActions.filter(
        (action) => text(action.action_type) === "DELETE",
      );
      const requiredActions = [...soldOutActions, ...deleteActions];
      if (
        currentRunActions.length !== 2 ||
        matchingActions.length !== 2 ||
        soldOutActions.length !== 1 ||
        deleteActions.length !== 1 ||
        requiredActions.some(
          (action) =>
            !text(action.scheduled_for) ||
            !instant(action.scheduled_for) ||
            instant(action.scheduled_for) > nowMs + 5 * 60 * 1000 ||
            Boolean(
              text(action.claimed_at) ||
                text(action.executed_at) ||
                text(action.readback_verified_at),
            ),
        )
      ) {
        addBlockingReason(
          blockingReasons,
          "CURRENT_RUN_ACTION_PAIR_INCOMPLETE",
        );
        continue;
      }
      candidateActions.push(...requiredActions);
    }

    const dedupeKeys = candidateActions.map((action) => text(action.dedupe_key));
    if (
      dedupeKeys.some((value) => !value) ||
      new Set(dedupeKeys).size !== candidateActions.length
    ) {
      addBlockingReason(
        blockingReasons,
        "ACTION_DEDUPE_KEY_MISSING_OR_DUPLICATED",
      );
    }

    if (blockingReasons.size > 0) {
      for (const reason of blockingReasons) {
        blockingReasonCounts[reason] =
          (blockingReasonCounts[reason] ?? 0) + 1;
      }
      continue;
    }

    const verifiedExposureDays = Math.min(
      ...rows.map((row) =>
        nonNegativeInteger(record(row.evidence).verifiedExposureDays),
      ),
    );
    const scheduledFor = candidateActions
      .map((row) => text(row.scheduled_for))
      .filter(Boolean)
      .sort()[0] ?? "";
    readyCandidates.push({
      launchItemId,
      modelNumber: text(rows[0]?.model_number),
      productName: text(rows[0]?.product_name),
      currentRunId,
      marketListingCount: rows.length,
      actionCount: candidateActions.length,
      dedupeKeyCount: new Set(dedupeKeys).size,
      verifiedExposureDays,
      latestLiveReadbackAt: liveReadbacks.sort().at(-1) ?? "",
      scheduledFor,
    });
  }

  readyCandidates.sort(
    (left, right) =>
      left.scheduledFor.localeCompare(right.scheduledFor) ||
      left.launchItemId.localeCompare(right.launchItemId),
  );
  return {
    preflightVersion: "seo-listing-canary-preflight-v1",
    dueProductCount,
    readyProductCount: readyCandidates.length,
    blockedProductCount: dueProductCount - readyCandidates.length,
    requiredMarketListingCount,
    requiredActionCount: requiredMarketListingCount * 2,
    readbackMaxAgeHours,
    blockingReasonCounts,
    approvalRequired: true,
    externalMarketWrite: false,
    executionLocked: true,
    autoRetryOnUncertain: false,
    recoveryMode: "STOP_AND_CONFIRM_READBACK",
    executionSteps: SEO_LISTING_CANARY_EXECUTION_STEPS,
    selectedCandidate: readyCandidates[0] ?? null,
  };
}

export function summarizeSeoRegistrationOutcomes(
  jobs: Array<
    Pick<
      SeoRunJobRow,
      | "run_id"
      | "launch_item_id"
      | "status"
      | "registration_status"
      | "run_created_at"
      | "created_at"
    >
  >,
) {
  const latestByProduct = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    const launchItemId = text(job.launch_item_id);
    if (!launchItemId) continue;
    const current = latestByProduct.get(launchItemId);
    if (
      !current ||
      jobInstant(job) > jobInstant(current) ||
      (jobInstant(job) === jobInstant(current) &&
        text(job.run_id) > text(current.run_id))
    ) {
      latestByProduct.set(launchItemId, job);
    }
  }
  const latest = [...latestByProduct.values()];
  return {
    registeredProductCount: latest.filter(
      (job) => job.registration_status === "success",
    ).length,
    registrationFailedProductCount: latest.filter(
      (job) => job.registration_status === "failed",
    ).length,
    processingProductCount: latest.filter(
      (job) =>
        job.status === "queued" ||
        job.status === "running" ||
        ["submitting", "queued", "running"].includes(job.registration_status),
    ).length,
  };
}
