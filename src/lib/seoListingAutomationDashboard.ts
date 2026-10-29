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
  scheduled_for?: unknown;
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
  dueProductCount: number;
  readyProductCount: number;
  blockedProductCount: number;
  approvalRequired: true;
  externalMarketWrite: false;
  selectedCandidate: null | {
    launchItemId: string;
    modelNumber: string;
    productName: string;
    marketListingCount: number;
    actionCount: number;
    verifiedExposureDays: number;
    scheduledFor: string;
  };
};

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
  for (const row of rows) {
    const state = text(row.state) as SeoListingLifecycleState;
    if (STATES.includes(state)) counts[state] += 1;
    if (row.requires_review === true) requiresReviewCount += 1;
    const salesCount = Number(row.sales_count_during_attempt);
    if (Number.isSafeInteger(salesCount) && salesCount > 0) {
      verifiedSalesCount += salesCount;
    }
  }
  return { counts, requiresReviewCount, verifiedSalesCount };
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
  exposureDays = 60,
): SeoListingCanaryReadiness {
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
    if (text(row.status) !== "shadow" || row.shadow_mode !== true) continue;
    const lifecycleRecordId = text(row.lifecycle_record_id);
    const actionType = text(row.action_type);
    if (
      !lifecycleRecordId ||
      (actionType !== "SOLD_OUT" && actionType !== "DELETE")
    ) {
      continue;
    }
    const rows = actionsByLifecycleRecord.get(lifecycleRecordId) ?? [];
    rows.push(row);
    actionsByLifecycleRecord.set(lifecycleRecordId, rows);
  }

  const readyCandidates: Array<
    NonNullable<SeoListingCanaryReadiness["selectedCandidate"]>
  > = [];
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
    if (dueRows.length !== rows.length) continue;

    const candidateActions: SeoListingCanaryActionRow[] = [];
    let complete = true;
    for (const lifecycleRow of rows) {
      const lifecycleRecordId = text(lifecycleRow.id);
      const goodsKey = text(lifecycleRow.goods_key);
      const marketAccountKey = text(lifecycleRow.market_account_key);
      if (!lifecycleRecordId || !goodsKey || !marketAccountKey) {
        complete = false;
        break;
      }
      const matchingActions = (
        actionsByLifecycleRecord.get(lifecycleRecordId) ?? []
      ).filter(
        (action) =>
          text(action.launch_item_id) === launchItemId &&
          text(action.goods_key) === goodsKey &&
          text(action.market_account_key) === marketAccountKey,
      );
      const soldOutActions = matchingActions.filter(
        (action) => text(action.action_type) === "SOLD_OUT",
      );
      const deleteActions = matchingActions.filter(
        (action) => text(action.action_type) === "DELETE",
      );
      const requiredActions = [...soldOutActions, ...deleteActions];
      if (
        soldOutActions.length !== 1 ||
        deleteActions.length !== 1 ||
        requiredActions.some(
          (action) => !text(action.scheduled_for) || !instant(action.scheduled_for),
        )
      ) {
        complete = false;
        break;
      }
      candidateActions.push(...requiredActions);
    }
    if (!complete) continue;

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
      marketListingCount: rows.length,
      actionCount: candidateActions.length,
      verifiedExposureDays,
      scheduledFor,
    });
  }

  readyCandidates.sort(
    (left, right) =>
      left.scheduledFor.localeCompare(right.scheduledFor) ||
      left.launchItemId.localeCompare(right.launchItemId),
  );
  return {
    dueProductCount,
    readyProductCount: readyCandidates.length,
    blockedProductCount: dueProductCount - readyCandidates.length,
    approvalRequired: true,
    externalMarketWrite: false,
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
