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
  launch_item_id?: unknown;
  state?: unknown;
  requires_review?: unknown;
  sales_count_during_attempt?: unknown;
  evidence?: unknown;
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
