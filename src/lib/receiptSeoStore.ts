import { verifiedMarketOnlyUploadJob } from "./shoplingMarketAutoResumePolicy";
import {
  readSeoPages as pages,
  readSeoIdPages as byIds,
} from "./seoStoragePages";
import { createSupabaseAdminClient } from "./supabase/admin";
import { readProductLaunchNormalizedItems } from "./productLaunchTrackerNormalizedStore";
import { productLaunchSeoMaterialReadiness } from "./productLaunchSeoMaterialReadiness";
import { legacySeoRegistrationExclusion } from "./legacySeoRegistrationPolicy";
import { receiptOnSaleState, receiptOnSaleTargets } from "./receiptOnSaleCore";
import { readReceiptJournal } from "./receiptOnSaleStore";
import { loadMonthlyPriceStatus } from "./monthlyPriceStore";
import { purchaseRunDraftId } from "./monthlyPriceCore";
import {
  calculateSeoPortfolioCapacity,
  seoMarketCapacityInput,
  SEO_LISTING_EXPOSURE_DAYS,
  SEO_LISTING_COOLDOWN_DAYS,
  SEO_LISTING_MAX_ATTEMPTS,
} from "./seoListingLifecyclePolicy";
import { calculateSeoShoplingProductDbCapacity } from "./seoShoplingProductDbCapacity";
import {
  buildReceiptSeoReport,
  receiptSeoPriceReady,
  receiptSeoRecord,
  type ReceiptSeoCard,
  type ReceiptSeoReport,
  type ReceiptSeoLine,
} from "./receiptSeoPortfolio";
import type { SeoRunJobContext } from "./seoRunJobServer";

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;
const text = (v: unknown) => String(v ?? "").trim();
const codes = (v: unknown) => (Array.isArray(v) ? v.map(text) : []);
const empty = (): ReceiptSeoReport => ({ rows: [], coveredItemIds: [] });

async function readIntake(db: Db, selected?: string) {
  // The original receipt is the durable membership. Even a missing launch card or a later
  // failure cannot drop it. Read the later receipts too before accepting an older draft.
  const selectedReceipts = selected
    ? await readReceiptJournal(selected, true)
    : undefined;
  if (
    selectedReceipts &&
    !selectedReceipts.some((r) => receiptSeoRecord(r.result_snapshot).receiptId)
  )
    return [];
  const marked = await pages(
    () =>
      db
        .from("commerce_operation_runs")
        .select("source_event_id,receipt_draft:result_snapshot->>draftId")
        .eq("status", "SUCCEEDED")
        .eq("operation_type", "CHINA_ORDER_COMMITMENT_EVENT")
        .eq("source", "ops-center-internal-china-receipt")
        .eq("result_snapshot->>seoRotationIntakeVersion", "1"),
    "source_event_id",
  );
  const ids = new Set(marked.map((r) => purchaseRunDraftId(r.receipt_draft)));
  const legacyPreview = selected && !ids.has(selected) ? selected : undefined;
  if (selected) ids.add(selected);
  const drafts = new Map<string, Row[]>();
  for (const id of ids) {
    const rows =
      id === selected && selectedReceipts
        ? selectedReceipts
        : await readReceiptJournal(id, true);
    for (const row of rows) {
      const result = receiptSeoRecord(row.result_snapshot);
      if (result.actualOrderEvidenceReconciled === true && !result.receiptId)
        continue;
      const list = drafts.get(id) ?? [];
      list.push(row);
      drafts.set(id, list);
    }
  }
  const lines: ReceiptSeoLine[] = [];
  for (const [draftId, rows] of drafts) {
    const months = new Set(
      rows.map((r) => text(receiptSeoRecord(r.result_snapshot).cycleMonth)),
    );
    if (months.size !== 1) throw new Error("입고 원장의 차시 월을 확인하세요.");
    const targets = receiptOnSaleTargets(draftId, rows);
    const [logs, price] = await Promise.all([
      readReceiptJournal(draftId, false),
      loadMonthlyPriceStatus([...months][0], draftId),
    ]);
    const keepIds = price.items
      .filter((i) => i.state === "HELD" && !i.plan && !i.error_code)
      .map((i) => i.id);
    const audits = await byIds(
      keepIds,
      (ids) =>
        db
          .from("commerce_monthly_price_audit")
          .select("id,item_id,evidence")
          .in("item_id", ids)
          .eq("event", "LEGACY_GROUP_UNRESOLVED_HELD"),
      "id",
    );
    const confirmed = new Set(
      audits
        .filter((r) => {
          const e = receiptSeoRecord(r.evidence);
          return (
            e.action === "KEEP_CURRENT_PRICE" &&
            e.policy === price.run?.policy_version &&
            e.sourceHash === price.run?.source_hash
          );
        })
        .map((r) => text(r.item_id)),
    );
    const events = logs.map((r) => receiptSeoRecord(r.input_snapshot));
    for (const target of targets)
      lines.push({
        ...target,
        draftId,
        legacyPreview: draftId === legacyPreview,
        goodsKeys: price.items
          .filter(
            (i) =>
              /^\d+$/.test(i.goods_key) &&
              i.candidate.options.some((o) => o.barcode === target.barcode),
          )
          .map((i) => i.goods_key),
        priceReady: receiptSeoPriceReady(target, draftId, price, confirmed),
        saleReady:
          receiptOnSaleState(target, undefined, events).state === "ACCEPTED",
      });
  }
  return lines;
}

export async function readReceiptSeoReport(
  context: SeoRunJobContext,
  selected?: string,
): Promise<ReceiptSeoReport> {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("입고 SEO 저장소 연결을 확인하세요.");
  const draftId =
    selected === undefined ? undefined : purchaseRunDraftId(selected);
  const lines = await readIntake(db, draftId);
  if (!lines.length) return empty();
  const targetCodes = new Set(
    lines
      .filter((l) => !draftId || l.draftId === draftId)
      .map((l) => l.barcode),
  );
  const owner = context.identity.userId,
    now = new Date();
  const ownerRows = (table: string, fields: string) =>
    db.from(table).select(fields).eq("owner_id", owner);
  const summaries = await pages(
    () =>
      ownerRows(
        "product_launch_items",
        "item_id,barcode,option_barcodes,shopling_upload_status,market_registration_status",
      ).is("archived_at", null),
    "item_id",
  );
  const scope = (r: Row) => [text(r.barcode), ...codes(r.option_barcodes)];
  const selectedCards = summaries.filter((r) =>
    scope(r).some((b) => targetCodes.has(b)),
  );
  // Include cards sharing a sibling barcode so an ambiguous option can't slip through.
  const siblings = new Set(selectedCards.flatMap(scope));
  const matches = summaries.filter((r) =>
    scope(r).some((b) => siblings.has(b)),
  );
  const ids = matches.map((r) => text(r.item_id));
  const scoped = (table: string, fields: string, sort: string) =>
    byIds(
      ids,
      (batch) => ownerRows(table, fields).in("launch_item_id", batch),
      sort,
    );
  const items: Row[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const batch = await readProductLaunchNormalizedItems(
      context.config,
      owner,
      ids.slice(i, i + 40),
    );
    items.push(...batch.map(receiptSeoRecord));
  }
  const byId = new Map(items.map((r) => [text(r.id), r]));
  const cards: ReceiptSeoCard[] = matches.map((row) => {
    const id = text(row.item_id),
      item = byId.get(id) ?? {};
    const material = productLaunchSeoMaterialReadiness(item);
    const exclusion = legacySeoRegistrationExclusion(item);
    const goodsKeys = Object.values(receiptSeoRecord(item.shoplingProducts))
      .map((r) => text(receiptSeoRecord(r).goodsKey))
      .filter(Boolean);
    return {
      id,
      codes: scope(row).filter(Boolean),
      model: text(item.modelNumber),
      name: text(item.productName),
      materialError: material.errors[0] || "",
      excluded: exclusion.reason,
      priorUpload:
        [row.shopling_upload_status, row.market_registration_status].some(
          (s) => !!s && s !== "미시작",
        ) ||
        (Array.isArray(item.shoplingRegistrationHistory) &&
          item.shoplingRegistrationHistory.length > 0),
      goodsKeys,
    };
  });
  const evidenceKeys = [
    ...new Set([
      ...lines
        .filter((l) => siblings.has(l.barcode))
        .flatMap((l) => l.goodsKeys ?? []),
      ...cards.flatMap((c) => c.goodsKeys),
    ]),
  ];
  const listings = async (table: string, fields: string, sort: string) => {
    const [direct, byKey] = await Promise.all([
      scoped(table, fields, sort),
      byIds(
        evidenceKeys,
        (batch) => ownerRows(table, fields).in("goods_key", batch),
        sort,
      ),
    ]);
    return [
      ...new Map([...direct, ...byKey].map((r) => [text(r[sort]), r])).values(),
    ];
  };
  const [
    jobs,
    lifecycle,
    ledger,
    registry,
    isolations,
    marketRows,
    dbRows,
    policies,
  ] = await Promise.all([
    scoped(
      "seo_run_jobs",
      "run_id,launch_item_id,run_created_at,status,registration_status,registration_job_id,registration_payload,archived_at",
      "run_id",
    ),
    listings(
      "seo_listing_lifecycle_records",
      "id,launch_item_id,market_account_key,state,attempt_count,goods_key,current_run_id,live_started_at,last_verified_live_at,sales_count_during_attempt,next_eligible_at,exposure_verified,requires_review,evidence",
      "id",
    ),
    listings(
      "shopling_market_pipeline_ledger",
      "goods_key,profile,launch_item_id,status,market_status",
      "goods_key",
    ),
    listings(
      "shopling_product_group_registry",
      "goods_key,launch_item_id",
      "goods_key",
    ),
    byIds(
      ids,
      (batch) =>
        ownerRows("seo_listing_lifecycle_isolations", "launch_item_id")
          .in("launch_item_id", batch)
          .eq("active", true),
      "launch_item_id",
    ),
    pages(
      () => ownerRows("seo_market_account_capacities", "*"),
      "market_account_key",
    ),
    pages(
      () => ownerRows("seo_shopling_product_db_capacities", "*"),
      "owner_id",
    ),
    pages(
      () =>
        ownerRows(
          "seo_listing_rotation_policies",
          "exposure_days,cooldown_days,max_attempts",
        ),
      "owner_id",
    ),
  ]);
  const uploadIds = [
    ...new Set(
      jobs
        .filter((j) => j.registration_status === "success")
        .map((j) => text(j.registration_job_id))
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ];
  const uploads = await byIds(
    uploadIds,
    (batch) =>
      ownerRows(
        "product_launch_upload_jobs",
        "id,launch_item_id,status,result",
      ).in("id", batch),
    "id",
  );
  const verifiedUploads = new Map(
    uploads.flatMap((upload) => {
      const proof = verifiedMarketOnlyUploadJob(upload);
      return proof
        ? [
            [
              proof.jobId,
              {
                itemId: text(upload.launch_item_id),
                goodsKeys: proof.goodsKeys,
              },
            ] as const,
          ]
        : [];
    }),
  );
  const policy = policies[0];
  const matchesPolicy =
    !policy ||
    (policy.exposure_days === SEO_LISTING_EXPOSURE_DAYS &&
      policy.cooldown_days === SEO_LISTING_COOLDOWN_DAYS &&
      policy.max_attempts === SEO_LISTING_MAX_ATTEMPTS);
  const market = calculateSeoPortfolioCapacity(
    marketRows.map(seoMarketCapacityInput),
    now,
  );
  const productDb = calculateSeoShoplingProductDbCapacity(dbRows[0], now);
  const marketAt =
    marketRows
      .filter((r) => r.required_for_auto_batch !== false)
      .map((r) => text(r.observed_at))
      .filter(Boolean)
      .sort()[0] || now.toISOString();
  const productAt = text(dbRows[0]?.observed_at) || now.toISOString();
  const dispatchBudget = {
    marketLimit: market.blocked ? 0 : market.safeBatchCount,
    marketObservedAt: marketAt,
    productLimit: productDb.blocked ? 0 : productDb.safeNewProductCount,
    productObservedAt: productAt,
  };
  const reservations = await pages(
    () =>
      ownerRows(
        "shopling_market_auto_orchestrations",
        "id,run_ids,state,created_at,completed_at,result",
      ),
    "id",
  );
  function reserved(observedAt: string, newCodes: boolean) {
    const after = Date.parse(observedAt);
    return reservations.reduce((count, r) => {
      if (newCodes && receiptSeoRecord(r.result).mode === "market_only")
        return count;
      const terminal = [
        "completed",
        "completed_with_exceptions",
        "cancelled",
        "exception",
      ].includes(text(r.state));
      if (terminal && Date.parse(text(r.completed_at || r.created_at)) < after)
        return count;
      const jobCount = codes(r.run_ids).length;
      const productCount = receiptSeoRecord(r.result).productReservationCount;
      return (
        count +
        (newCodes &&
        typeof productCount === "number" &&
        Number.isInteger(productCount) &&
        productCount >= 0 &&
        productCount <= jobCount
          ? productCount
          : jobCount)
      );
    }, 0);
  }
  const report = buildReceiptSeoReport({
    owner,
    draftId,
    cards,
    lines,
    jobs,
    lifecycle,
    ledger,
    registry,
    verifiedUploads,
    isolatedIds: new Set(isolations.map((r) => text(r.launch_item_id))),
    marketSlots: matchesPolicy
      ? dispatchBudget.marketLimit - reserved(marketAt, false)
      : 0,
    productSlots: matchesPolicy
      ? dispatchBudget.productLimit - reserved(productAt, true)
      : 0,
    now,
  });
  return { ...report, dispatchBudget };
}
