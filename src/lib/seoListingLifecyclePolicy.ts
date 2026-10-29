export const SEO_LISTING_EXPOSURE_DAYS = 60;
export const SEO_LISTING_COOLDOWN_DAYS = 90;
export const SEO_LISTING_MAX_ATTEMPTS = 3;
export const SEO_MARKET_CAPACITY_MAX_AGE_HOURS = 24;
export const SEO_LISTING_RULE_VERSION = "seo-listing-rotation-v1-shadow";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export type SeoListingLifecycleState =
  | "READY"
  | "LIVE"
  | "COOLDOWN"
  | "PROTECTED"
  | "RETIRE_CANDIDATE"
  | "EXCEPTION";

export type SeoListingLifecycleAction =
  | "NONE"
  | "REGISTER"
  | "SOLD_OUT_AND_DELETE"
  | "RELIST"
  | "KEEP"
  | "REVIEW";

export type SeoListingLifecycleInput = {
  state: SeoListingLifecycleState;
  attemptCount: number;
  liveStartedAt?: string | null;
  lastVerifiedLiveAt?: string | null;
  salesCountDuringAttempt?: number | null;
  nextEligibleAt?: string | null;
  exposureVerified?: boolean;
  verifiedExposureDays?: number | null;
  technicalFailure?: boolean;
};

export type SeoListingLifecycleDecision = {
  state: SeoListingLifecycleState;
  action: SeoListingLifecycleAction;
  attemptCount: number;
  exposureDays: number | null;
  nextEligibleAt: string | null;
  requiresReview: boolean;
  reasonCode: string;
};

export type SeoMarketCapacityInput = {
  marketAccountKey: string;
  marketName?: string;
  accountLabel?: string;
  maximumListingCount: number | null;
  activeListingCount: number | null;
  inFlightCount?: number | null;
  safetyBuffer?: number | null;
  observationStatus?: "verified" | "unknown" | "error";
  observedAt?: string | null;
  requiredForAutoBatch?: boolean;
};

export type SeoMarketCapacityDecision = SeoMarketCapacityInput & {
  availableListingCount: number;
  blocked: boolean;
  stale: boolean;
  reasonCode: string;
};

export type SeoPortfolioCapacityDecision = {
  markets: SeoMarketCapacityDecision[];
  safeBatchCount: number;
  blocked: boolean;
  reasonCodes: string[];
};

function parseInstant(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function plusDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS).toISOString();
}

function validNow(now: Date) {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new TypeError("SEO_LISTING_INVALID_NOW");
  return time;
}

export function evaluateSeoListingLifecycle(
  input: SeoListingLifecycleInput,
  now = new Date(),
): SeoListingLifecycleDecision {
  const nowMs = validNow(now);
  const attemptCount = nonNegativeInteger(input.attemptCount);
  const salesCount = nonNegativeInteger(input.salesCountDuringAttempt ?? 0);
  const base = {
    attemptCount: attemptCount ?? 0,
    exposureDays: null,
    nextEligibleAt: null,
  } satisfies Pick<
    SeoListingLifecycleDecision,
    "attemptCount" | "exposureDays" | "nextEligibleAt"
  >;

  if (attemptCount === null || attemptCount > SEO_LISTING_MAX_ATTEMPTS) {
    return {
      ...base,
      state: "EXCEPTION",
      action: "REVIEW",
      requiresReview: true,
      reasonCode: "INVALID_ATTEMPT_COUNT",
    };
  }
  if (salesCount === null) {
    return {
      ...base,
      attemptCount,
      state: "EXCEPTION",
      action: "REVIEW",
      requiresReview: true,
      reasonCode: "INVALID_SALES_COUNT",
    };
  }
  if (input.technicalFailure) {
    return {
      ...base,
      attemptCount,
      state: "EXCEPTION",
      action: "REVIEW",
      requiresReview: true,
      reasonCode: "TECHNICAL_FAILURE_ATTEMPT_NOT_CONSUMED",
    };
  }
  if (
    attemptCount === 0 &&
    ["LIVE", "COOLDOWN", "PROTECTED"].includes(input.state)
  ) {
    return {
      ...base,
      attemptCount,
      state: "EXCEPTION",
      action: "REVIEW",
      requiresReview: true,
      reasonCode: "VERIFIED_ATTEMPT_REQUIRED_FOR_STATE",
    };
  }
  if (
    input.state === "RETIRE_CANDIDATE" &&
    attemptCount < SEO_LISTING_MAX_ATTEMPTS
  ) {
    return {
      ...base,
      attemptCount,
      state: "EXCEPTION",
      action: "REVIEW",
      requiresReview: true,
      reasonCode: "RETIRE_CANDIDATE_ATTEMPTS_INCOMPLETE",
    };
  }
  if (salesCount > 0) {
    return {
      ...base,
      attemptCount,
      state: "PROTECTED",
      action: "KEEP",
      requiresReview: false,
      reasonCode: "SALE_CONFIRMED_KEEP_LISTING",
    };
  }
  if (input.state === "PROTECTED") {
    return {
      ...base,
      attemptCount,
      state: "PROTECTED",
      action: "KEEP",
      requiresReview: false,
      reasonCode: "PROTECTED_LISTING",
    };
  }
  if (input.state === "RETIRE_CANDIDATE") {
    return {
      ...base,
      attemptCount,
      state: "RETIRE_CANDIDATE",
      action: "NONE",
      requiresReview: false,
      reasonCode: "AWAITING_RETIRE_REVIEW",
    };
  }
  if (input.state === "READY") {
    if (attemptCount >= SEO_LISTING_MAX_ATTEMPTS) {
      return {
        ...base,
        attemptCount,
        state: "RETIRE_CANDIDATE",
        action: "NONE",
        requiresReview: false,
        reasonCode: "MAX_ATTEMPTS_REACHED",
      };
    }
    return {
      ...base,
      attemptCount,
      state: "READY",
      action: attemptCount === 0 ? "REGISTER" : "RELIST",
      requiresReview: false,
      reasonCode: attemptCount === 0 ? "READY_FOR_FIRST_LISTING" : "READY_FOR_RELIST",
    };
  }
  if (input.state === "COOLDOWN") {
    const eligibleAtMs = parseInstant(input.nextEligibleAt);
    if (eligibleAtMs === null) {
      return {
        ...base,
        attemptCount,
        state: "EXCEPTION",
        action: "REVIEW",
        requiresReview: true,
        reasonCode: "COOLDOWN_END_MISSING",
      };
    }
    if (attemptCount >= SEO_LISTING_MAX_ATTEMPTS) {
      return {
        ...base,
        attemptCount,
        state: "RETIRE_CANDIDATE",
        action: "NONE",
        requiresReview: false,
        reasonCode: "MAX_ATTEMPTS_REACHED",
      };
    }
    if (nowMs < eligibleAtMs) {
      return {
        ...base,
        attemptCount,
        state: "COOLDOWN",
        action: "NONE",
        nextEligibleAt: new Date(eligibleAtMs).toISOString(),
        requiresReview: false,
        reasonCode: "COOLDOWN_IN_PROGRESS",
      };
    }
    return {
      ...base,
      attemptCount,
      state: "READY",
      action: "RELIST",
      requiresReview: false,
      reasonCode: "COOLDOWN_COMPLETE",
    };
  }
  if (input.state === "LIVE") {
    const liveStartedAtMs = parseInstant(input.liveStartedAt);
    const lastVerifiedLiveAtMs = parseInstant(input.lastVerifiedLiveAt);
    const verifiedExposureDays =
      input.verifiedExposureDays === undefined ||
      input.verifiedExposureDays === null
        ? null
        : nonNegativeInteger(input.verifiedExposureDays);
    if (
      input.verifiedExposureDays !== undefined &&
      input.verifiedExposureDays !== null &&
      verifiedExposureDays === null
    ) {
      return {
        ...base,
        attemptCount,
        state: "EXCEPTION",
        action: "REVIEW",
        requiresReview: true,
        reasonCode: "INVALID_VERIFIED_EXPOSURE_DAYS",
      };
    }
    if (
      input.exposureVerified !== true ||
      liveStartedAtMs === null ||
      lastVerifiedLiveAtMs === null ||
      liveStartedAtMs > nowMs + CLOCK_SKEW_MS ||
      lastVerifiedLiveAtMs > nowMs + CLOCK_SKEW_MS ||
      lastVerifiedLiveAtMs < liveStartedAtMs
    ) {
      return {
        ...base,
        attemptCount,
        state: "EXCEPTION",
        action: "REVIEW",
        requiresReview: true,
        reasonCode: "LIVE_EXPOSURE_NOT_VERIFIED",
      };
    }
    const exposureDays =
      verifiedExposureDays ??
      Math.max(
        0,
        Math.floor(
          (Math.min(nowMs, lastVerifiedLiveAtMs) - liveStartedAtMs) / DAY_MS,
        ),
      );
    if (exposureDays < SEO_LISTING_EXPOSURE_DAYS) {
      return {
        ...base,
        attemptCount,
        exposureDays,
        state: "LIVE",
        action: "NONE",
        requiresReview: false,
        reasonCode: "EXPOSURE_WINDOW_IN_PROGRESS",
      };
    }
    if (attemptCount >= SEO_LISTING_MAX_ATTEMPTS) {
      return {
        ...base,
        attemptCount,
        exposureDays,
        state: "RETIRE_CANDIDATE",
        action: "SOLD_OUT_AND_DELETE",
        requiresReview: false,
        reasonCode: "THIRD_UNSOLD_WINDOW_COMPLETE",
      };
    }
    return {
      ...base,
      attemptCount,
      exposureDays,
      state: "COOLDOWN",
      action: "SOLD_OUT_AND_DELETE",
      nextEligibleAt: plusDays(now, SEO_LISTING_COOLDOWN_DAYS),
      requiresReview: false,
      reasonCode: "UNSOLD_WINDOW_COMPLETE_START_COOLDOWN",
    };
  }

  return {
    ...base,
    attemptCount,
    state: "EXCEPTION",
    action: "REVIEW",
    requiresReview: true,
    reasonCode: "UNSUPPORTED_LIFECYCLE_STATE",
  };
}

export function calculateSeoMarketCapacity(
  input: SeoMarketCapacityInput,
  now = new Date(),
): SeoMarketCapacityDecision {
  const nowMs = validNow(now);
  const maximum = nonNegativeInteger(input.maximumListingCount);
  const active = nonNegativeInteger(input.activeListingCount);
  const inFlight = nonNegativeInteger(input.inFlightCount ?? 0);
  const buffer = nonNegativeInteger(input.safetyBuffer ?? 0);
  const observedAtMs = parseInstant(input.observedAt);
  const status = input.observationStatus ?? "unknown";
  const stale =
    observedAtMs === null ||
    observedAtMs > nowMs + CLOCK_SKEW_MS ||
    nowMs - observedAtMs > SEO_MARKET_CAPACITY_MAX_AGE_HOURS * HOUR_MS;

  let reasonCode = "CAPACITY_AVAILABLE";
  if (!String(input.marketAccountKey ?? "").trim()) reasonCode = "MARKET_ACCOUNT_KEY_MISSING";
  else if (status !== "verified") reasonCode = "CAPACITY_NOT_VERIFIED";
  else if ([maximum, active, inFlight, buffer].some((value) => value === null)) {
    reasonCode = "CAPACITY_COUNT_INVALID";
  } else if (stale) reasonCode = "CAPACITY_STALE";
  else if ((active ?? 0) > (maximum ?? 0)) reasonCode = "ACTIVE_COUNT_EXCEEDS_MAXIMUM";

  const blocked = reasonCode !== "CAPACITY_AVAILABLE";
  return {
    ...input,
    maximumListingCount: maximum,
    activeListingCount: active,
    inFlightCount: inFlight,
    safetyBuffer: buffer,
    availableListingCount: blocked
      ? 0
      : Math.max(0, (maximum ?? 0) - (active ?? 0) - (inFlight ?? 0) - (buffer ?? 0)),
    blocked,
    stale,
    reasonCode,
  };
}

export function calculateSeoPortfolioCapacity(
  inputs: SeoMarketCapacityInput[],
  now = new Date(),
): SeoPortfolioCapacityDecision {
  const markets = inputs.map((input) => calculateSeoMarketCapacity(input, now));
  const required = markets.filter((market) => market.requiredForAutoBatch !== false);
  if (!required.length) {
    return {
      markets,
      safeBatchCount: 0,
      blocked: true,
      reasonCodes: ["REQUIRED_MARKET_CAPACITY_MISSING"],
    };
  }
  const blockedMarkets = required.filter((market) => market.blocked);
  if (blockedMarkets.length) {
    return {
      markets,
      safeBatchCount: 0,
      blocked: true,
      reasonCodes: [...new Set(blockedMarkets.map((market) => market.reasonCode))],
    };
  }
  return {
    markets,
    safeBatchCount: Math.min(
      ...required.map((market) => market.availableListingCount),
    ),
    blocked: false,
    reasonCodes: [],
  };
}
