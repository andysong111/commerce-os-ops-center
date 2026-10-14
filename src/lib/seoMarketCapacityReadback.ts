import { PRODUCT_GROUP_MARKET_REGISTRY } from "./productGroupMarketRegistry.ts";
import { SEO_MARKET_CAPACITY_MAX_AGE_HOURS } from "./seoListingLifecyclePolicy.ts";

export const SEO_MARKET_CAPACITY_READBACK_SOURCE =
  "shopling-market-capacity-readback-v1";

const HOUR_MS = 3_600_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;

export type SeoMarketCapacityObservationStatus =
  | "verified"
  | "unknown"
  | "error";

export type SeoMarketCapacityPreparedRow = {
  market_account_key: string;
  market_code: string;
  market_name: string;
  account_label: string;
  maximum_listing_count: number | null;
  active_listing_count: number | null;
  in_flight_count: number;
  observation_status: SeoMarketCapacityObservationStatus;
  collector_message: string;
};

export type SeoMarketCapacityPreparedSnapshot = {
  snapshotId: string;
  observedAt: string;
  source: typeof SEO_MARKET_CAPACITY_READBACK_SOURCE;
  rows: SeoMarketCapacityPreparedRow[];
  suppliedCount: number;
  missingCount: number;
};

export class SeoMarketCapacityReadbackError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SeoMarketCapacityReadbackError";
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, max = 300) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function integer(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function seoMarketAccountKey(mallKey: string, accountLabel: string) {
  return `${mallKey.trim()}:${accountLabel.normalize("NFKC").trim()}`;
}

export const SEO_MARKET_CAPACITY_ACCOUNTS = PRODUCT_GROUP_MARKET_REGISTRY.map(
  (account) => ({
    marketAccountKey: seoMarketAccountKey(account.mallKey, account.accountIdLabel),
    marketCode: account.mallKey,
    marketName: account.marketName,
    accountLabel: account.accountIdLabel,
  }),
).filter(
  (account, index, accounts) =>
    accounts.findIndex(
      (candidate) => candidate.marketAccountKey === account.marketAccountKey,
    ) === index,
);

const ACCOUNT_BY_KEY = new Map(
  SEO_MARKET_CAPACITY_ACCOUNTS.map((account) => [
    account.marketAccountKey,
    account,
  ]),
);

function observedInstant(value: unknown, now: Date) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_NOW_INVALID",
      "현재 시각을 확인할 수 없습니다.",
    );
  }
  const parsed = Date.parse(text(value, 80));
  if (!Number.isFinite(parsed)) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_TIME_INVALID",
      "마켓 등록수 확인 시각이 올바르지 않습니다.",
    );
  }
  if (parsed > nowMs + CLOCK_SKEW_MS) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_TIME_IN_FUTURE",
      "마켓 등록수 확인 시각이 현재보다 미래입니다.",
    );
  }
  if (nowMs - parsed > SEO_MARKET_CAPACITY_MAX_AGE_HOURS * HOUR_MS) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_STALE",
      `${SEO_MARKET_CAPACITY_MAX_AGE_HOURS}시간을 지난 마켓 등록수 증거는 저장하지 않습니다.`,
    );
  }
  return new Date(parsed).toISOString();
}

function preparedObservation(
  raw: UnknownRecord,
  account: (typeof SEO_MARKET_CAPACITY_ACCOUNTS)[number],
): SeoMarketCapacityPreparedRow {
  const requestedStatus = text(raw.status, 20);
  if (
    requestedStatus &&
    !["verified", "unknown", "error"].includes(requestedStatus)
  ) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_STATUS_INVALID",
      `${account.marketName} ${account.accountLabel}의 확인 상태가 올바르지 않습니다.`,
    );
  }
  const status: SeoMarketCapacityObservationStatus =
    requestedStatus === "verified" || requestedStatus === "error"
      ? requestedStatus
      : "unknown";
  const maximum = integer(raw.maximumListingCount);
  const active = integer(raw.activeListingCount);
  const inFlight = integer(raw.inFlightCount ?? 0);
  if (status === "verified" && (maximum === null || active === null)) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_VERIFIED_COUNTS_REQUIRED",
      `${account.marketName} ${account.accountLabel}의 최대 등록수와 현재 등록수가 필요합니다.`,
    );
  }
  if (inFlight === null) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_IN_FLIGHT_INVALID",
      `${account.marketName} ${account.accountLabel}의 진행 중 수량이 올바르지 않습니다.`,
    );
  }
  return {
    market_account_key: account.marketAccountKey,
    market_code: account.marketCode,
    market_name: account.marketName,
    account_label: account.accountLabel,
    maximum_listing_count: status === "verified" ? maximum : null,
    active_listing_count: status === "verified" ? active : null,
    in_flight_count: inFlight,
    observation_status: status,
    collector_message: text(raw.message),
  };
}

export function prepareSeoMarketCapacitySnapshot(
  value: unknown,
  now = new Date(),
): SeoMarketCapacityPreparedSnapshot {
  const body = record(value);
  const snapshotId = text(body.snapshotId, 80);
  if (!UUID.test(snapshotId)) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_SNAPSHOT_ID_INVALID",
      "마켓 등록수 스냅샷 ID가 올바르지 않습니다.",
    );
  }
  if (text(body.source, 120) !== SEO_MARKET_CAPACITY_READBACK_SOURCE) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_SOURCE_INVALID",
      "지원하지 않는 마켓 등록수 수집기입니다.",
    );
  }
  const observedAt = observedInstant(body.observedAt, now);
  if (!Array.isArray(body.observations) || body.observations.length > 100) {
    throw new SeoMarketCapacityReadbackError(
      "CAPACITY_READBACK_OBSERVATIONS_INVALID",
      "마켓 등록수 관측 목록이 올바르지 않습니다.",
    );
  }

  const supplied = new Map<string, UnknownRecord>();
  for (const value of body.observations) {
    const observation = record(value);
    const key = text(observation.marketAccountKey, 180);
    if (!ACCOUNT_BY_KEY.has(key)) {
      throw new SeoMarketCapacityReadbackError(
        "CAPACITY_READBACK_ACCOUNT_UNKNOWN",
        `Commerce OS에 없는 마켓 계정입니다: ${key || "(비어 있음)"}`,
      );
    }
    if (supplied.has(key)) {
      throw new SeoMarketCapacityReadbackError(
        "CAPACITY_READBACK_ACCOUNT_DUPLICATED",
        `같은 마켓 계정이 두 번 포함됐습니다: ${key}`,
      );
    }
    supplied.set(key, observation);
  }

  const rows = SEO_MARKET_CAPACITY_ACCOUNTS.map((account) => {
    const observation = supplied.get(account.marketAccountKey);
    return observation
      ? preparedObservation(observation, account)
      : {
          market_account_key: account.marketAccountKey,
          market_code: account.marketCode,
          market_name: account.marketName,
          account_label: account.accountLabel,
          maximum_listing_count: null,
          active_listing_count: null,
          in_flight_count: 0,
          observation_status: "unknown" as const,
          collector_message: "이번 readback에서 계정을 확인하지 못했습니다.",
        };
  });
  return {
    snapshotId,
    observedAt,
    source: SEO_MARKET_CAPACITY_READBACK_SOURCE,
    rows,
    suppliedCount: supplied.size,
    missingCount: rows.length - supplied.size,
  };
}

export type SeoMarketCapacityReadbackVerification = {
  ok: boolean;
  matchedCount: number;
  reasonCode: string;
};

function sameInstant(value: unknown, expected: string) {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === expected;
}

export function verifySeoMarketCapacitySnapshotReadback(
  snapshot: SeoMarketCapacityPreparedSnapshot,
  value: unknown,
): SeoMarketCapacityReadbackVerification {
  if (!Array.isArray(value) || value.length !== snapshot.rows.length) {
    return {
      ok: false,
      matchedCount: 0,
      reasonCode: "CAPACITY_READBACK_ROW_COUNT_MISMATCH",
    };
  }

  const actualByKey = new Map<string, UnknownRecord>();
  for (const raw of value) {
    const row = record(raw);
    const key = text(row.market_account_key, 180);
    if (!key || actualByKey.has(key)) {
      return {
        ok: false,
        matchedCount: 0,
        reasonCode: "CAPACITY_READBACK_IDENTITY_MISMATCH",
      };
    }
    actualByKey.set(key, row);
  }

  let matchedCount = 0;
  for (const expected of snapshot.rows) {
    const actual = actualByKey.get(expected.market_account_key);
    const maximum = integer(actual?.maximum_listing_count);
    const active = integer(actual?.active_listing_count);
    const inFlight = integer(actual?.in_flight_count);
    if (
      !actual ||
      text(actual.snapshot_id, 80) !== snapshot.snapshotId ||
      text(actual.market_code, 80) !== expected.market_code ||
      text(actual.market_name, 180) !== expected.market_name ||
      text(actual.account_label, 180) !== expected.account_label ||
      maximum !== expected.maximum_listing_count ||
      active !== expected.active_listing_count ||
      inFlight !== expected.in_flight_count ||
      text(actual.observation_status, 20) !== expected.observation_status ||
      text(actual.source, 120) !== snapshot.source ||
      !sameInstant(actual.observed_at, snapshot.observedAt)
    ) {
      return {
        ok: false,
        matchedCount,
        reasonCode: "CAPACITY_READBACK_VALUE_MISMATCH",
      };
    }
    matchedCount += 1;
  }

  return {
    ok: true,
    matchedCount,
    reasonCode: "CAPACITY_READBACK_VERIFIED",
  };
}
