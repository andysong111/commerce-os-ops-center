export const SEO_SHOPLING_PRODUCT_CODES_PER_PRODUCT = 6;
export const SEO_SHOPLING_PRODUCT_DB_SAFETY_BUFFER_CODES = 12;
export const SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS = 24;
export const SEO_SHOPLING_PRODUCT_DB_READBACK_SOURCE =
  "shopling-plan-dom-v1";

const HOUR_MS = 3_600_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;

export type SeoShoplingProductDbCapacity = {
  maximumProductCodeCount: number | null;
  usedProductCodeCount: number | null;
  availableProductCodeCount: number;
  overLimitProductCodeCount: number;
  safetyBufferProductCodeCount: number;
  productCodesPerProduct: number;
  safeNewProductCount: number;
  observationStatus: "verified" | "unknown" | "error";
  observedAt: string | null;
  stale: boolean;
  blocked: boolean;
  reasonCode: string;
};

export type SeoShoplingProductDbPreparedSnapshot = {
  snapshotId: string;
  maximumProductCodeCount: number;
  usedProductCodeCount: number;
  observedAt: string;
  source: typeof SEO_SHOPLING_PRODUCT_DB_READBACK_SOURCE;
  evidence: UnknownRecord;
};

export class SeoShoplingProductDbReadbackError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SeoShoplingProductDbReadbackError";
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

function instant(value: unknown) {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateSeoShoplingProductDbCapacity(
  value: unknown,
  now = new Date(),
): SeoShoplingProductDbCapacity {
  const row = record(value);
  const maximum = integer(row.maximum_product_code_count);
  const used = integer(row.used_product_code_count);
  const observationStatus =
    row.observation_status === "verified" || row.observation_status === "error"
      ? row.observation_status
      : "unknown";
  const observedAtMs = instant(row.observed_at);
  const nowMs = now.getTime();
  const stale =
    observedAtMs === null ||
    !Number.isFinite(nowMs) ||
    observedAtMs > nowMs + CLOCK_SKEW_MS ||
    nowMs - observedAtMs > SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS * HOUR_MS;

  let reasonCode = "SHOPLING_PRODUCT_DB_READY";
  if (observationStatus !== "verified") {
    reasonCode = "SHOPLING_PRODUCT_DB_READBACK_UNVERIFIED";
  } else if (maximum === null || maximum <= 0 || used === null) {
    reasonCode = "SHOPLING_PRODUCT_DB_COUNT_INVALID";
  } else if (stale) {
    reasonCode = "SHOPLING_PRODUCT_DB_READBACK_STALE";
  } else if (used >= maximum) {
    reasonCode = "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT";
  }

  const available =
    maximum === null || used === null ? 0 : Math.max(0, maximum - used);
  const overLimit =
    maximum === null || used === null ? 0 : Math.max(0, used - maximum);
  const safeAvailable = Math.max(
    0,
    available - SEO_SHOPLING_PRODUCT_DB_SAFETY_BUFFER_CODES,
  );
  const safeNewProductCount =
    reasonCode === "SHOPLING_PRODUCT_DB_READY"
      ? Math.floor(safeAvailable / SEO_SHOPLING_PRODUCT_CODES_PER_PRODUCT)
      : 0;
  if (
    reasonCode === "SHOPLING_PRODUCT_DB_READY" &&
    safeNewProductCount === 0
  ) {
    reasonCode = "SHOPLING_PRODUCT_DB_INSUFFICIENT_SAFE_SLOTS";
  }

  return {
    maximumProductCodeCount: maximum,
    usedProductCodeCount: used,
    availableProductCodeCount: available,
    overLimitProductCodeCount: overLimit,
    safetyBufferProductCodeCount:
      SEO_SHOPLING_PRODUCT_DB_SAFETY_BUFFER_CODES,
    productCodesPerProduct: SEO_SHOPLING_PRODUCT_CODES_PER_PRODUCT,
    safeNewProductCount,
    observationStatus,
    observedAt:
      observedAtMs === null ? null : new Date(observedAtMs).toISOString(),
    stale,
    blocked: reasonCode !== "SHOPLING_PRODUCT_DB_READY",
    reasonCode,
  };
}

export function prepareSeoShoplingProductDbSnapshot(
  value: unknown,
  now = new Date(),
): SeoShoplingProductDbPreparedSnapshot {
  const body = record(value);
  const snapshotId = text(body.snapshotId, 80);
  if (!UUID.test(snapshotId)) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_SNAPSHOT_ID_INVALID",
      "샵플링 상품 DB 확인번호가 올바르지 않습니다.",
    );
  }
  if (text(body.source, 120) !== SEO_SHOPLING_PRODUCT_DB_READBACK_SOURCE) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_SOURCE_INVALID",
      "지원하지 않는 샵플링 상품 DB 수집기입니다.",
    );
  }
  const maximum = integer(body.maximumProductCodeCount);
  const used = integer(body.usedProductCodeCount);
  if (maximum === null || maximum <= 0 || used === null) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_COUNTS_INVALID",
      "샵플링 상품 DB 최대 수와 사용 수를 확인할 수 없습니다.",
    );
  }
  const observedAtMs = instant(body.observedAt);
  const nowMs = now.getTime();
  if (observedAtMs === null || !Number.isFinite(nowMs)) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_TIME_INVALID",
      "샵플링 상품 DB 확인 시각이 올바르지 않습니다.",
    );
  }
  if (observedAtMs > nowMs + CLOCK_SKEW_MS) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_TIME_IN_FUTURE",
      "샵플링 상품 DB 확인 시각이 현재보다 미래입니다.",
    );
  }
  if (nowMs - observedAtMs > SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS * HOUR_MS) {
    throw new SeoShoplingProductDbReadbackError(
      "SHOPLING_PRODUCT_DB_READBACK_STALE",
      `${SEO_SHOPLING_PRODUCT_DB_MAX_AGE_HOURS}시간을 지난 상품 DB 수량은 저장하지 않습니다.`,
    );
  }

  const rawEvidence = record(body.evidence);
  return {
    snapshotId,
    maximumProductCodeCount: maximum,
    usedProductCodeCount: used,
    observedAt: new Date(observedAtMs).toISOString(),
    source: SEO_SHOPLING_PRODUCT_DB_READBACK_SOURCE,
    evidence: {
      pathname: text(rawEvidence.pathname, 240),
      pageTitle: text(rawEvidence.pageTitle, 200),
    },
  };
}

export function verifySeoShoplingProductDbSnapshotReadback(
  expected: SeoShoplingProductDbPreparedSnapshot,
  value: unknown,
) {
  const row = record(value);
  const observedAtMs = instant(row.observed_at);
  const matches =
    text(row.snapshot_id, 80) === expected.snapshotId &&
    integer(row.maximum_product_code_count) ===
      expected.maximumProductCodeCount &&
    integer(row.used_product_code_count) === expected.usedProductCodeCount &&
    text(row.observation_status, 20) === "verified" &&
    text(row.source, 120) === expected.source &&
    observedAtMs !== null &&
    new Date(observedAtMs).toISOString() === expected.observedAt;
  return {
    ok: matches,
    reasonCode: matches
      ? "SHOPLING_PRODUCT_DB_READBACK_VERIFIED"
      : "SHOPLING_PRODUCT_DB_READBACK_MISMATCH",
  };
}
