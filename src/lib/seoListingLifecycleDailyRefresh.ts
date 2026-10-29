import { evaluateSeoListingLifecycle } from "./seoListingLifecyclePolicy.ts";

const SALES_EVIDENCE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;

export type SeoListingDailyRecordUpdate = {
  id: string;
  ownerId: string;
  launchItemId: string;
  marketAccountKey: string;
  previousState: string;
  state: string;
  lastVerifiedLiveAt: string | null;
  salesCountDuringAttempt: number;
  exposureVerified: boolean;
  requiresReview: boolean;
  reviewReason: string | null;
  evidence: UnknownRecord;
  evaluatedAt: string;
};

export type SeoListingDailyEvent = {
  lifecycleRecordId: string;
  ownerId: string;
  previousState: string;
  newState: string;
  action: "NONE" | "KEEP" | "REVIEW" | "SOLD_OUT_AND_DELETE";
  attemptCount: number;
  reasonCode: string;
  evidence: UnknownRecord;
  evaluatedAt: string;
};

export type SeoListingDailyShadowAction = {
  ownerId: string;
  lifecycleRecordId: string;
  marketAccountKey: string;
  launchItemId: string;
  runId: string;
  goodsKey: string;
  actionType: "SOLD_OUT" | "DELETE";
  dedupeKey: string;
  scheduledFor: string;
  reasonCode: string;
  evidence: UnknownRecord;
};

export type SeoListingDailyRefreshPlan = {
  generatedAt: string;
  source: "seo-listing-shadow-daily-refresh-v1";
  productsExamined: number;
  recordsExamined: number;
  refreshedRecordCount: number;
  protectedRecordCount: number;
  reviewRecordCount: number;
  verifiedDayEventCount: number;
  shadowDueRecordCount: number;
  recordUpdates: SeoListingDailyRecordUpdate[];
  events: SeoListingDailyEvent[];
  shadowActions: SeoListingDailyShadowAction[];
  externalMarketWrite: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function instant(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function seoulDay(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function latestBy<T extends UnknownRecord>(
  rows: T[],
  keyOf: (row: T) => string,
) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const previous = latest.get(key);
    const currentTime = Date.parse(text(row.updated_at)) || 0;
    const previousTime = Date.parse(text(previous?.updated_at)) || 0;
    if (!previous || currentTime >= previousTime) latest.set(key, row);
  }
  return latest;
}

function itemBarcodes(row: UnknownRecord | undefined) {
  if (!row) return [];
  return [
    ...new Set([
      text(row.barcode),
      ...stringArray(row.option_barcodes),
      ...stringArray(row.option_barcode_nos),
    ].filter(Boolean)),
  ];
}

function latestSaleEvidence(
  barcodes: string[],
  salesRowsByBarcode: Map<string, UnknownRecord>,
) {
  const rows = barcodes
    .map((barcode) => salesRowsByBarcode.get(barcode))
    .filter((row): row is UnknownRecord => Boolean(row));
  const lastSaleAt = rows
    .map((row) => instant(row.last_sale_at))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const observedAt = rows
    .map((row) => instant(row.evaluated_at) ?? instant(row.updated_at))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  return { lastSaleAt, observedAt };
}

function shoplingReason(row: UnknownRecord | undefined) {
  if (!row) return "SHOPLING_STATUS_MISSING";
  if (text(row.state) !== "READY") return "SHOPLING_STATUS_CONFLICT";
  const status = text(row.currentSaleStatus).toUpperCase();
  return status === "B" ? null : `SHOPLING_NOT_SELLING_${status || "UNKNOWN"}`;
}

function evidenceFresh(observedAt: string | null, nowMs: number) {
  if (!observedAt) return false;
  const observedMs = Date.parse(observedAt);
  return (
    Number.isFinite(observedMs) &&
    observedMs <= nowMs + CLOCK_SKEW_MS &&
    nowMs - observedMs <= SALES_EVIDENCE_MAX_AGE_MS
  );
}

function verifiedDayState(row: UnknownRecord, evidence: UnknownRecord) {
  const previousDay =
    text(evidence.lastVerifiedDay) ||
    seoulDay(text(row.last_verified_live_at)) ||
    null;
  const stored = integer(evidence.verifiedExposureDays, 0);
  const inferred =
    stored > 0
      ? stored
      : row.exposure_verified === true && instant(row.last_verified_live_at)
        ? 1
        : 0;
  return { previousDay, verifiedExposureDays: inferred };
}

function actionDedupeKey(
  row: UnknownRecord,
  actionType: "SOLD_OUT" | "DELETE",
) {
  return [
    "seo-listing-shadow-v1",
    text(row.owner_id),
    text(row.id),
    `attempt-${integer(row.attempt_count)}`,
    `live-${instant(row.live_started_at) || "missing"}`,
    actionType.toLowerCase(),
  ].join(":");
}

export function buildSeoListingDailyRefreshPlan(input: {
  lifecycleRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  salesRows: UnknownRecord[];
  shoplingStatuses: UnknownRecord[];
  now?: Date;
}): SeoListingDailyRefreshPlan {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("SEO_DAILY_REFRESH_INVALID_NOW");
  const generatedAt = now.toISOString();
  const today = seoulDay(now);
  if (!today) throw new TypeError("SEO_DAILY_REFRESH_INVALID_DAY");

  const itemsById = latestBy(input.launchItems, (row) => text(row.item_id));
  const salesByBarcode = latestBy(input.salesRows, (row) => text(row.barcode));
  const statusByGoodsKey = latestBy(
    input.shoplingStatuses,
    (row) => text(row.goodsKey),
  );
  const saleByLaunchItem = new Map<string, ReturnType<typeof latestSaleEvidence>>();
  for (const row of input.lifecycleRows) {
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId || saleByLaunchItem.has(launchItemId)) continue;
    saleByLaunchItem.set(
      launchItemId,
      latestSaleEvidence(itemBarcodes(itemsById.get(launchItemId)), salesByBarcode),
    );
  }

  const recordUpdates: SeoListingDailyRecordUpdate[] = [];
  const events: SeoListingDailyEvent[] = [];
  const shadowActions: SeoListingDailyShadowAction[] = [];
  const products = new Set<string>();
  const protectedProducts = new Set<string>();
  const reviewProducts = new Set<string>();
  let verifiedDayEventCount = 0;

  for (const row of input.lifecycleRows) {
    const state = text(row.state);
    if (state !== "LIVE" && state !== "PROTECTED") continue;
    const id = text(row.id);
    const ownerId = text(row.owner_id);
    const launchItemId = text(row.launch_item_id);
    const marketAccountKey = text(row.market_account_key);
    if (!id || !ownerId || !launchItemId || !marketAccountKey) continue;
    products.add(launchItemId);

    const evidence = object(row.evidence);
    const sale = saleByLaunchItem.get(launchItemId) ?? {
      lastSaleAt: null,
      observedAt: null,
    };
    const salesFresh = evidenceFresh(sale.observedAt, nowMs);
    const readbackReason = shoplingReason(
      statusByGoodsKey.get(text(row.goods_key)),
    );
    const liveStartedAt = instant(row.live_started_at);
    const saleAfterLive = Boolean(
      liveStartedAt &&
      sale.lastSaleAt &&
      Date.parse(sale.lastSaleAt) >= Date.parse(liveStartedAt),
    );
    const verified = readbackReason === null && salesFresh;
    const dayState = verifiedDayState(row, evidence);
    const isNewVerifiedDay = verified && dayState.previousDay !== today;
    const verifiedExposureDays =
      dayState.verifiedExposureDays + (isNewVerifiedDay ? 1 : 0);

    let nextState = state;
    let requiresReview = false;
    let reviewReason: string | null = null;
    let salesCount = integer(row.sales_count_during_attempt, 0);
    let lastVerifiedLiveAt = instant(row.last_verified_live_at);
    let eventAction: SeoListingDailyEvent["action"] = "NONE";
    let eventReason = "DAILY_LIVE_READBACK_VERIFIED";

    if (saleAfterLive && salesFresh) {
      nextState = "PROTECTED";
      salesCount = Math.max(1, salesCount);
      protectedProducts.add(launchItemId);
      eventAction = "KEEP";
      eventReason = "SALE_CONFIRMED_KEEP_LISTING";
      if (readbackReason) {
        requiresReview = true;
        reviewReason = readbackReason;
      }
    } else if (!salesFresh) {
      requiresReview = true;
      reviewReason = "SALES_EVIDENCE_MISSING_OR_STALE";
      eventAction = "REVIEW";
      eventReason = reviewReason;
    } else if (readbackReason) {
      requiresReview = true;
      reviewReason = readbackReason;
      eventAction = "REVIEW";
      eventReason = reviewReason;
    }

    if (nextState === "PROTECTED") protectedProducts.add(launchItemId);
    if (verified) lastVerifiedLiveAt = generatedAt;
    if (requiresReview) reviewProducts.add(launchItemId);
    const exposureVerified = row.exposure_verified === true || verified;

    const nextEvidence: UnknownRecord = {
      ...evidence,
      dailyRefreshSource: "seo-listing-shadow-daily-refresh-v1",
      dailyRefreshAt: generatedAt,
      shoplingReadbackAt: verified ? generatedAt : evidence.shoplingReadbackAt ?? null,
      shoplingSaleStatus: text(
        statusByGoodsKey.get(text(row.goods_key))?.currentSaleStatus,
      ),
      salesEvidenceAt: sale.observedAt,
      lastSaleAt: sale.lastSaleAt,
      salesEvidenceFresh: salesFresh,
      verifiedExposureDays,
      lastVerifiedDay: verified ? today : dayState.previousDay,
      externalMarketWrite: false,
    };

    const decision = evaluateSeoListingLifecycle(
      {
        state: nextState as "LIVE" | "PROTECTED",
        attemptCount: integer(row.attempt_count),
        liveStartedAt,
        lastVerifiedLiveAt,
        salesCountDuringAttempt: salesCount,
        exposureVerified,
        verifiedExposureDays,
      },
      now,
    );
    const shadowDue =
      nextState === "LIVE" &&
      verified &&
      !requiresReview &&
      decision.action === "SOLD_OUT_AND_DELETE";
    if (shadowDue) {
      eventAction = "SOLD_OUT_AND_DELETE";
      eventReason = decision.reasonCode;
      for (const actionType of ["SOLD_OUT", "DELETE"] as const) {
        shadowActions.push({
          ownerId,
          lifecycleRecordId: id,
          marketAccountKey,
          launchItemId,
          runId: text(row.current_run_id),
          goodsKey: text(row.goods_key),
          actionType,
          dedupeKey: actionDedupeKey(row, actionType),
          scheduledFor: generatedAt,
          reasonCode: decision.reasonCode,
          evidence: {
            verifiedExposureDays,
            lastVerifiedDay: today,
            liveStartedAt,
            lastVerifiedLiveAt,
            externalMarketWrite: false,
          },
        });
      }
    }

    const reviewChanged =
      row.requires_review !== requiresReview ||
      text(row.review_reason) !== text(reviewReason);
    const stateChanged = state !== nextState;
    const shouldUpdate = isNewVerifiedDay || reviewChanged || stateChanged;
    if (!shouldUpdate) continue;

    recordUpdates.push({
      id,
      ownerId,
      launchItemId,
      marketAccountKey,
      previousState: state,
      state: nextState,
      lastVerifiedLiveAt,
      salesCountDuringAttempt: salesCount,
      exposureVerified,
      requiresReview,
      reviewReason,
      evidence: nextEvidence,
      evaluatedAt: generatedAt,
    });
    events.push({
      lifecycleRecordId: id,
      ownerId,
      previousState: state,
      newState: nextState,
      action: eventAction,
      attemptCount: integer(row.attempt_count),
      reasonCode: eventReason,
      evidence: nextEvidence,
      evaluatedAt: generatedAt,
    });
    if (isNewVerifiedDay) verifiedDayEventCount += 1;
  }

  return {
    generatedAt,
    source: "seo-listing-shadow-daily-refresh-v1",
    productsExamined: products.size,
    recordsExamined: input.lifecycleRows.filter((row) =>
      ["LIVE", "PROTECTED"].includes(text(row.state)),
    ).length,
    refreshedRecordCount: recordUpdates.length,
    protectedRecordCount: protectedProducts.size,
    reviewRecordCount: reviewProducts.size,
    verifiedDayEventCount,
    shadowDueRecordCount: new Set(
      shadowActions.map((action) => action.lifecycleRecordId),
    ).size,
    recordUpdates,
    events,
    shadowActions,
    externalMarketWrite: false,
  };
}
