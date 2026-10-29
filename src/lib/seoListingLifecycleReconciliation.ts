export const SEO_LISTING_SHADOW_EXPECTED_PROFILES = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
] as const;

export const SEO_LISTING_SHADOW_RECONCILIATION_SOURCE =
  "seo-listing-shadow-bootstrap-v1";

const GOODS_KEY = /^\d+$/;
const SALES_EVIDENCE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REGISTRATION_PROVEN_STATES = new Set(["sent", "already_registered"]);

type UnknownRecord = Record<string, unknown>;

export type SeoListingShadowSeedRecord = {
  owner_id: string;
  market_account_key: string;
  launch_item_id: string;
  model_number: string;
  product_name: string;
  state: "LIVE" | "PROTECTED" | "EXCEPTION";
  attempt_count: number;
  current_run_id: string;
  goods_key: string;
  market_listing_id: string;
  live_started_at: string | null;
  last_verified_live_at: string | null;
  sales_count_during_attempt: number;
  next_eligible_at: null;
  exposure_verified: boolean;
  requires_review: boolean;
  review_reason: string | null;
  evidence: UnknownRecord;
  rule_version: "seo-listing-rotation-v1-shadow";
  evaluated_at: string;
  updated_at: string;
};

export type SeoListingShadowReconciliationPlan = {
  generatedAt: string;
  source: typeof SEO_LISTING_SHADOW_RECONCILIATION_SOURCE;
  writesEnabled: false;
  productsExamined: number;
  productsSeeded: number;
  productsSkippedExisting: number;
  productsNeedingReview: number;
  liveRecordCount: number;
  protectedRecordCount: number;
  reviewRecordCount: number;
  records: SeoListingShadowSeedRecord[];
  productReviews: Array<{
    launchItemId: string;
    modelNumber: string;
    reason: string;
  }>;
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

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function goodsKeysFromJob(row: UnknownRecord) {
  const payload = object(row.registration_payload);
  const source = Array.isArray(payload.goodsKeys)
    ? payload.goodsKeys
    : Array.isArray(payload.registeredGoodsKeys)
      ? payload.registeredGoodsKeys
      : [];
  return [...new Set(source.map(text).filter((value) => GOODS_KEY.test(value)))];
}

export function extractSeoRegistrationGoodsKeys(rows: UnknownRecord[]) {
  return [
    ...new Set(
      rows
        .filter((row) => text(row.registration_status) === "success")
        .flatMap(goodsKeysFromJob),
    ),
  ];
}

function latestSuccessfulJobs(rows: UnknownRecord[]) {
  const latest = new Map<string, UnknownRecord>();
  for (const row of rows) {
    if (text(row.registration_status) !== "success") continue;
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId) continue;
    const key = `${text(row.owner_id)}\u0000${launchItemId}`;
    const previous = latest.get(key);
    const currentTime = Date.parse(text(row.updated_at)) || 0;
    const previousTime = Date.parse(text(previous?.updated_at)) || 0;
    if (
      !previous ||
      currentTime > previousTime ||
      (currentTime === previousTime && text(row.run_id) > text(previous.run_id))
    ) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
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

function registrationProven(row: UnknownRecord) {
  return (
    REGISTRATION_PROVEN_STATES.has(text(row.status)) &&
    REGISTRATION_PROVEN_STATES.has(text(row.market_status))
  );
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
  return {
    rows,
    lastSaleAt,
    observedAt,
    rollingQuantity: rows.reduce(
      (sum, row) => sum + nonNegativeNumber(row.sales_quantity_365),
      0,
    ),
  };
}

function statusReason(row: UnknownRecord | undefined) {
  if (!row) return "SHOPLING_STATUS_MISSING";
  if (text(row.state) !== "READY") return "SHOPLING_STATUS_CONFLICT";
  if (text(row.currentSaleStatus).toUpperCase() !== "B") {
    return `SHOPLING_NOT_SELLING_${text(row.currentSaleStatus).toUpperCase() || "UNKNOWN"}`;
  }
  return null;
}

export function buildSeoListingShadowReconciliationPlan(input: {
  ownerId: string;
  jobs: UnknownRecord[];
  marketLedgerRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  salesRows: UnknownRecord[];
  shoplingStatuses: UnknownRecord[];
  existingLifecycleRows?: UnknownRecord[];
  now?: Date;
}): SeoListingShadowReconciliationPlan {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("SEO_RECONCILIATION_INVALID_NOW");
  const generatedAt = now.toISOString();
  const jobs = latestSuccessfulJobs(input.jobs);
  const ledgerByGoodsKey = latestBy(
    input.marketLedgerRows,
    (row) => `${text(row.owner_id)}\u0000${text(row.goods_key)}`,
  );
  const itemsById = latestBy(
    input.launchItems,
    (row) => `${text(row.owner_id)}\u0000${text(row.item_id)}`,
  );
  const salesByBarcode = latestBy(input.salesRows, (row) => text(row.barcode));
  const statusesByGoodsKey = latestBy(
    input.shoplingStatuses,
    (row) => text(row.goodsKey),
  );
  const existing = new Set(
    (input.existingLifecycleRows ?? []).map(
      (row) =>
        `${text(row.owner_id)}\u0000${text(row.market_account_key)}\u0000${text(row.launch_item_id)}`,
    ),
  );

  const records: SeoListingShadowSeedRecord[] = [];
  const productReviews: SeoListingShadowReconciliationPlan["productReviews"] = [];
  let productsSkippedExisting = 0;
  let productsSeeded = 0;

  for (const job of jobs) {
    const ownerId = text(job.owner_id) || text(input.ownerId);
    const launchItemId = text(job.launch_item_id);
    const modelNumber = text(job.model_number);
    const productName = text(job.product_name);
    const goodsKeys = goodsKeysFromJob(job);
    const item = itemsById.get(`${ownerId}\u0000${launchItemId}`);
    const sale = latestSaleEvidence(itemBarcodes(item), salesByBarcode);
    const saleEvidenceFresh = Boolean(
      sale.observedAt &&
      nowMs - Date.parse(sale.observedAt) <= SALES_EVIDENCE_MAX_AGE_MS &&
      Date.parse(sale.observedAt) <= nowMs + 5 * 60_000,
    );
    const ledgers = goodsKeys
      .map((goodsKey) => ledgerByGoodsKey.get(`${ownerId}\u0000${goodsKey}`))
      .filter((row): row is UnknownRecord => Boolean(row));
    const profiles = new Set(ledgers.map((row) => text(row.profile)));
    const shapeValid =
      goodsKeys.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
      ledgers.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
      SEO_LISTING_SHADOW_EXPECTED_PROFILES.every((profile) => profiles.has(profile)) &&
      ledgers.every((row) => text(row.launch_item_id) === launchItemId);

    if (!shapeValid) {
      productReviews.push({
        launchItemId,
        modelNumber,
        reason: "REGISTRATION_IDENTITY_INCOMPLETE",
      });
      continue;
    }

    const allExist = ledgers.every((row) =>
      existing.has(`${ownerId}\u0000${text(row.profile)}\u0000${launchItemId}`),
    );
    if (allExist) {
      productsSkippedExisting += 1;
      continue;
    }

    let productNeedsReview = false;
    let productProducedRecord = false;
    for (const ledger of ledgers) {
      const profile = text(ledger.profile);
      const identity = `${ownerId}\u0000${profile}\u0000${launchItemId}`;
      if (existing.has(identity)) continue;
      const goodsKey = text(ledger.goods_key);
      const registeredAt =
        instant(ledger.registry_registered_at) ??
        instant(ledger.completed_at) ??
        instant(ledger.updated_at);
      const pipelineProven = registrationProven(ledger);
      const shoplingStatus = statusesByGoodsKey.get(goodsKey);
      const readbackReason = statusReason(shoplingStatus);
      const saleAfterRegistration = Boolean(
        pipelineProven &&
        registeredAt &&
        sale.lastSaleAt &&
        Date.parse(sale.lastSaleAt) >= Date.parse(registeredAt),
      );

      let state: SeoListingShadowSeedRecord["state"] = "EXCEPTION";
      let attemptCount = 0;
      let exposureVerified = false;
      let requiresReview = true;
      let reviewReason: string | null = "PIPELINE_REGISTRATION_UNVERIFIED";
      let liveStartedAt: string | null = null;
      let lastVerifiedLiveAt: string | null = null;
      let salesCount = 0;

      if (pipelineProven && !saleEvidenceFresh) {
        reviewReason = "SALES_EVIDENCE_MISSING_OR_STALE";
      } else if (pipelineProven && saleAfterRegistration) {
        state = "PROTECTED";
        attemptCount = 1;
        exposureVerified = readbackReason === null;
        requiresReview = readbackReason !== null;
        reviewReason = readbackReason;
        liveStartedAt = readbackReason === null ? generatedAt : null;
        lastVerifiedLiveAt = readbackReason === null ? generatedAt : null;
        salesCount = 1;
      } else if (pipelineProven && readbackReason === null) {
        state = "LIVE";
        attemptCount = 1;
        exposureVerified = true;
        requiresReview = false;
        reviewReason = null;
        liveStartedAt = generatedAt;
        lastVerifiedLiveAt = generatedAt;
      } else if (pipelineProven) {
        reviewReason = readbackReason;
      }

      if (requiresReview) productNeedsReview = true;
      records.push({
        owner_id: ownerId,
        market_account_key: profile,
        launch_item_id: launchItemId,
        model_number: modelNumber,
        product_name: productName,
        state,
        attempt_count: attemptCount,
        current_run_id: text(job.run_id),
        goods_key: goodsKey,
        market_listing_id: "",
        live_started_at: liveStartedAt,
        last_verified_live_at: lastVerifiedLiveAt,
        sales_count_during_attempt: salesCount,
        next_eligible_at: null,
        exposure_verified: exposureVerified,
        requires_review: requiresReview,
        review_reason: reviewReason,
        evidence: {
          source: SEO_LISTING_SHADOW_RECONCILIATION_SOURCE,
          pipelineStatus: text(ledger.status),
          marketStatus: text(ledger.market_status),
          titleStatus: text(ledger.title_status),
          registrationProvenAt: registeredAt,
          shoplingReadbackAt: readbackReason === null ? generatedAt : null,
          shoplingSaleStatus: text(shoplingStatus?.currentSaleStatus),
          salesEvidenceAt: sale.observedAt,
          lastSaleAt: sale.lastSaleAt,
          rollingSalesQuantity365: sale.rollingQuantity,
          salesEvidenceFresh: saleEvidenceFresh,
          externalMarketWrite: false,
        },
        rule_version: "seo-listing-rotation-v1-shadow",
        evaluated_at: generatedAt,
        updated_at: generatedAt,
      });
      productProducedRecord = true;
    }

    if (productProducedRecord) productsSeeded += 1;
    if (productNeedsReview) {
      productReviews.push({
        launchItemId,
        modelNumber,
        reason: "ONE_OR_MORE_CHANNELS_REQUIRE_REVIEW",
      });
    }
  }

  return {
    generatedAt,
    source: SEO_LISTING_SHADOW_RECONCILIATION_SOURCE,
    writesEnabled: false,
    productsExamined: jobs.length,
    productsSeeded,
    productsSkippedExisting,
    productsNeedingReview: new Set(productReviews.map((row) => row.launchItemId)).size,
    liveRecordCount: records.filter((row) => row.state === "LIVE").length,
    protectedRecordCount: records.filter((row) => row.state === "PROTECTED").length,
    reviewRecordCount: records.filter((row) => row.requires_review).length,
    records,
    productReviews,
  };
}
