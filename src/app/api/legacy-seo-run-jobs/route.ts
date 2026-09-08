import { after, NextRequest } from "next/server";
import { validate1688Url } from "@/lib/keywordEngineElonLabV2";
import {
  archiveLegacySeoRunJobs,
  insertLegacySeoRunJobs,
  listLegacySeoRunJobs,
  patchOwnedLegacySeoRunJobs,
  retryLegacySeoRunJobs,
} from "@/lib/legacySeoRunJobServer";
import { processLegacySeoRunQueue } from "@/lib/legacySeoRunWorker";
import {
  buildLegacySeoSupportingText,
  loadLegacySeoShoplingEvidence,
  type LegacySeoGoodsKeyOverrides,
} from "@/lib/legacySeoShoplingEvidence";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import {
  refreshLegacySeoRegistrationStatuses,
  startLegacySeoShoplingRegistration,
} from "@/lib/legacySeoShoplingRegistration";
import {
  legacySeoRegistrationExclusion,
  isLegacySeoRegistrationPolicyExcluded,
} from "@/lib/legacySeoRegistrationPolicy";
import { recoverLegacySeoShoplingPrices } from "@/lib/legacySeoShoplingPriceRecovery";
import { readProductLaunchNormalizedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import { readProductLaunchStorageJson } from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import type { SeoRunJobInsert } from "@/lib/seoRunJobServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ENQUEUE_ITEMS = 100;
const CUSTOM_BLOCKED_LIMIT = 200;
const MAX_TRACKER_GOODS_KEYS_PER_MODEL = 120;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function uniqueStrings(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = text(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function titleRows(value: unknown) {
  return array(record(value).mallTitles)
    .map(record)
    .map((row) => text(row.title))
    .filter(Boolean);
}

function historicalMallTitles(item: UnknownRecord) {
  const titles = [...titleRows(item.seoFinal)];
  for (const value of array(item.shoplingRegistrationHistory)) {
    const entry = record(value);
    for (const key of ["previousSeoFinal", "seoFinal", "registeredSeoFinal", "newSeoFinal"]) {
      titles.push(...titleRows(entry[key]));
    }
  }
  return titles;
}

function resultMallTitles(value: unknown) {
  const payload = record(value);
  return titleRows(payload.seoFinal || record(payload.result).seoFinal);
}

function itemOptionText(item: UnknownRecord) {
  return array(item.orderOptions)
    .map(record)
    .map((row) =>
      [row.saleOption, row.chinaOption, row.optionName, row.barcode]
        .map(text)
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean);
}

function candidate1688Url(item: UnknownRecord) {
  const detailPageSource = record(item.detailPageSource);
  const candidates = [
    record(item.seoFinal).sourceUrl,
    item.primaryChinaProductLink,
    detailPageSource.primaryUrl,
    ...array(item.chinaProductLinks),
    ...array(detailPageSource.urls),
  ];
  for (const value of candidates) {
    const candidate = record(value);
    const url = text(candidate.url || candidate.href || candidate.value || value);
    if (validate1688Url(url)) return url;
  }
  return "";
}

function trackerGoodsKeys(item: UnknownRecord) {
  const detailSource = record(item.detailPageAssetSource);
  const detailAssetSource = record(record(item.detailPageAsset).source);
  const values = [
    ...array(detailSource.goodsKeys),
    ...array(detailAssetSource.goodsKeys),
    ...Object.values(record(item.shoplingProducts)).map((value) => record(value).goodsKey),
  ];
  return uniqueStrings(values, MAX_TRACKER_GOODS_KEYS_PER_MODEL)
    .filter((value) => /^\d{5,12}$/.test(value))
    .slice(-MAX_TRACKER_GOODS_KEYS_PER_MODEL)
    .reverse();
}

function goodsKeyOverridesFromItems(items: UnknownRecord[]): LegacySeoGoodsKeyOverrides {
  const result = new Map<string, readonly string[]>();
  for (const item of items) {
    const model = text(item.modelNumber).toUpperCase().replace(/\s+/g, "");
    if (!model) continue;
    const keys = trackerGoodsKeys(item);
    if (keys.length) result.set(model, keys);
  }
  return result;
}

function mapItems(items: UnknownRecord[]) {
  const result = new Map<string, UnknownRecord>();
  for (const item of items) {
    const id = text(item.id);
    if (id) result.set(id, item);
  }
  return result;
}

function scheduleWorker(ownerId: string, maxJobs: number) {
  after(async () => {
    await processLegacySeoRunQueue({
      workerId: `legacy-enqueue:${ownerId.slice(0, 8)}:${crypto.randomUUID()}`,
      maxJobs: Math.max(1, Math.min(4, maxJobs)),
      timeBudgetMs: 240_000,
    }).catch((error) => {
      console.error("[legacy-seo-run] background worker failed", error);
    });
  });
}

async function listLegacyItems(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select:
      "item_id,tracker_row_number,work_batch,model_number,product_name,shopling_category,shopling_upload_status,overall_status,option_labels,updated_at,exclusion_policy:item_payload->legacySeoRegistrationPolicy",
    owner_id: `eq.${ownerId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    order: "tracker_row_number.asc",
    limit: "1000",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_items?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : [])
    .map(record)
    .filter((row) => !isLegacySeoRegistrationPolicyExcluded(row.exclusion_policy))
    .map((row) => ({
      id: text(row.item_id),
      trackerRowNumber: Number(row.tracker_row_number) || null,
      workBatch: text(row.work_batch),
      modelNumber: text(row.model_number),
      productName: text(row.product_name),
      shoplingCategory: text(row.shopling_category),
      shoplingUploadStatus: text(row.shopling_upload_status),
      overallStatus: text(row.overall_status),
      optionLabels: uniqueStrings(row.option_labels, 50),
      updatedAt: text(row.updated_at),
    }));
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  let jobs = await listLegacySeoRunJobs(context, { limit: 800 });
  await refreshLegacySeoRegistrationStatuses(context, jobs).catch(() => jobs);
  jobs = await listLegacySeoRunJobs(context, { limit: 800 });
  const includeItems = request.nextUrl.searchParams.get("items") !== "false";
  const items = includeItems
    ? await listLegacyItems(context.config, context.identity.userId)
    : [];
  if (jobs.some((job) => ["queued", "running"].includes(job.status))) {
    scheduleWorker(context.identity.userId, 2);
  }
  return Response.json({ ok: true, jobs, items });
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action) || "enqueue";

  if (action === "enqueue") {
    const itemIds = uniqueStrings(body.itemIds, MAX_ENQUEUE_ITEMS);
    if (!itemIds.length) {
      return Response.json(
        { ok: false, message: "이전상품을 1개 이상 선택하세요." },
        { status: 400 },
      );
    }

    let items = (await readProductLaunchNormalizedItems(
      context.config,
      context.identity.userId,
      itemIds,
    )).map(record);
    let itemById = mapItems(items);

    const missingOptionModels = uniqueStrings(
      itemIds
        .map((id) => itemById.get(id))
        .filter((item): item is UnknownRecord => Boolean(item))
        .filter((item) => !Array.isArray(item.orderOptions) || item.orderOptions.length === 0)
        .map((item) => text(item.modelNumber)),
      MAX_ENQUEUE_ITEMS,
    );
    let optionSyncError = "";
    if (missingOptionModels.length) {
      try {
        await syncLegacySeoShoplingOptions({
          config: context.config,
          identity: context.identity,
          modelNumbers: missingOptionModels,
        });
        items = (await readProductLaunchNormalizedItems(
          context.config,
          context.identity.userId,
          itemIds,
        )).map(record);
        itemById = mapItems(items);
      } catch (error) {
        optionSyncError = error instanceof Error ? error.message : String(error);
      }
    }

    const modelNumbers = itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is UnknownRecord => Boolean(item))
      .filter((item) => !legacySeoRegistrationExclusion(item).excluded)
      .map((item) => text(item.modelNumber))
      .filter(Boolean);
    const evidenceByModel = await loadLegacySeoShoplingEvidence(
      modelNumbers,
      goodsKeyOverridesFromItems(items),
    );
    const existing = await listLegacySeoRunJobs(context, {
      includeArchived: true,
      launchItemIds: itemIds,
      limit: 1000,
    });
    const previousTitles = new Map<string, string[]>();
    for (const job of existing) {
      const values = previousTitles.get(job.launch_item_id) ?? [];
      values.push(...resultMallTitles(job.result_payload));
      previousTitles.set(job.launch_item_id, values);
    }
    const bulkMode = body.bulkMode === true;
    const bulkBlockedItems = new Set(
      bulkMode
        ? existing
            .filter((job) => ["queued", "running", "ready"].includes(job.status))
            .map((job) => job.launch_item_id)
        : [],
    );
    const customBlockedTerms = uniqueStrings(
      body.customBlockedTerms,
      CUSTOM_BLOCKED_LIMIT,
    );
    const batchId = `legacy-seo-bulk-${crypto.randomUUID()}`;
    const rows: SeoRunJobInsert[] = [];
    const missing: string[] = [];

    for (const itemId of itemIds) {
      const item = itemById.get(itemId);
      if (!item) {
        missing.push(`${itemId}:상품없음`);
        continue;
      }
      const modelNumber = text(item.modelNumber);
      if (bulkBlockedItems.has(itemId)) {
        missing.push(`${modelNumber || itemId}:기존 RUN 있음`);
        continue;
      }
      const exclusion = legacySeoRegistrationExclusion(item);
      if (exclusion.excluded) {
        missing.push(`${modelNumber || itemId}:${exclusion.reason}`);
        continue;
      }
      const evidence = evidenceByModel.get(
        modelNumber.toUpperCase().replace(/\s+/g, ""),
      );
      if (!evidence) {
        missing.push(`${modelNumber || itemId}:Shopling데이터없음`);
        continue;
      }
      const real1688Url = candidate1688Url(item);
      const sourceUrl =
        real1688Url || `shopling://legacy/${evidence.goodsKeys[0] || modelNumber || itemId}`;
      const category = text(item.shoplingCategory) || evidence.categories[0] || "";
      const productName = text(item.productName) || evidence.titles[0] || modelNumber;
      const optionText = [
        ...itemOptionText(item),
        ...evidence.optionNames.map((value) => `Shopling 옵션: ${value}`),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 8_000);
      const exclusions = [
        ...historicalMallTitles(item),
        ...(previousTitles.get(itemId) ?? []),
        ...evidence.titles,
      ];
      const runId = `legacy-seo-run-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      rows.push({
        run_id: runId,
        batch_id: batchId,
        launch_item_id: itemId,
        tracker_row_number: Number(item.trackerRowNumber) || null,
        model_number: modelNumber,
        product_name: productName,
        source_url: sourceUrl,
        run_created_at: now,
        input_payload: {
          flow: "legacy_shopling_seo_cloud_v1",
          launchItemId: itemId,
          modelNumber,
          productName,
          sourceUrl,
          original1688Url: real1688Url,
          optionText,
          supportingText: buildLegacySeoSupportingText({
            productName,
            modelNumber,
            launchCategory: category,
            evidence,
          }),
          mallTitleCategory: category,
          customBlockedTerms,
          variationSeed: runId,
          excludedMallTitles: [...new Set(exclusions)].slice(0, 1200),
          legacyShoplingEvidence: {
            source: evidence.source,
            goodsKeys: evidence.goodsKeys,
            titles: evidence.titles,
            searchKeywords: evidence.searchKeywords,
            categories: evidence.categories,
            optionNames: evidence.optionNames,
            fetchedRowCount: evidence.fetchedRowCount,
            sourceMode: real1688Url
              ? "1688_plus_shopling"
              : "shopling_only",
          },
        },
      });
    }

    if (!rows.length) {
      return Response.json(
        {
          ok: false,
          code: "LEGACY_SEO_ITEMS_NOT_READY",
          message: `실행할 이전상품이 없습니다: ${missing.slice(0, 20).join(", ")}`,
          missing,
          optionSyncError,
        },
        { status: 422 },
      );
    }
    const inserted = await insertLegacySeoRunJobs(context, rows);
    scheduleWorker(context.identity.userId, rows.length);
    return Response.json({
      ok: true,
      batchId,
      requestedCount: itemIds.length,
      insertedCount: inserted.length,
      missing,
      optionSyncError,
      jobs: await listLegacySeoRunJobs(context, {
        runIds: rows.map((row) => row.run_id),
        includeArchived: true,
        limit: rows.length,
      }),
    });
  }

  if (action === "retry") {
    const runIds = uniqueStrings(body.runIds, 200);
    const jobs = await retryLegacySeoRunJobs(context, runIds);
    scheduleWorker(context.identity.userId, Math.max(1, runIds.length));
    return Response.json({ ok: true, jobs });
  }

  if (action === "archive") {
    const jobs = await archiveLegacySeoRunJobs(
      context,
      uniqueStrings(body.runIds, 200),
    );
    return Response.json({ ok: true, jobs });
  }

  if (action === "register") {
    const runIds = uniqueStrings(body.runIds, 30);
    const jobs = await listLegacySeoRunJobs(context, {
      runIds,
      includeArchived: false,
      limit: runIds.length || 1,
    });
    const normalizedItems = await readProductLaunchNormalizedItems(
      context.config,
      context.identity.userId,
      jobs.map((job) => job.launch_item_id),
    );
    const normalizedById = new Map(
      normalizedItems.map((value) => {
        const item = record(value);
        return [text(item.id), item] as const;
      }),
    );
    const eligibleJobs = jobs.filter((job) => {
      const item = normalizedById.get(job.launch_item_id);
      return item ? !legacySeoRegistrationExclusion(item).excluded : true;
    });
    let priceRecovery: UnknownRecord | null = null;
    let priceRecoveryError = "";
    try {
      priceRecovery = record(
        await recoverLegacySeoShoplingPrices({
          config: context.config,
          identity: context.identity,
          modelNumbers: eligibleJobs.map((job) => job.model_number),
        }),
      );
    } catch (error) {
      priceRecoveryError = error instanceof Error ? error.message : String(error);
    }

    const results = [];
    for (const job of jobs) {
      const item = normalizedById.get(job.launch_item_id);
      const exclusion = item ? legacySeoRegistrationExclusion(item) : { excluded: false, reason: "" };
      if (exclusion.excluded) {
        results.push({
          runId: job.run_id,
          started: false,
          error: `${job.model_number}: ${exclusion.reason}`,
        });
        continue;
      }
      if (priceRecoveryError) {
        results.push({
          runId: job.run_id,
          started: false,
          error: `Shopling 현재 판매가 복구 실패: ${priceRecoveryError}`,
        });
        continue;
      }
      try {
        results.push({
          runId: job.run_id,
          ...(await startLegacySeoShoplingRegistration(context, job)),
        });
      } catch (error) {
        results.push({
          runId: job.run_id,
          started: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return Response.json({ ok: true, results, priceRecovery });
  }

  if (action === "pulse") {
    const result = await processLegacySeoRunQueue({
      workerId: `legacy-manual:${context.identity.userId.slice(0, 8)}:${crypto.randomUUID()}`,
      maxJobs: 2,
      timeBudgetMs: 240_000,
    });
    return Response.json({ ok: true, result });
  }

  if (action === "cancel") {
    const jobs = await patchOwnedLegacySeoRunJobs(
      context,
      uniqueStrings(body.runIds, 200),
      {
        status: "cancelled",
        lease_owner: null,
        lease_until: null,
        completed_at: new Date().toISOString(),
        message: "사용자 취소",
      },
    );
    return Response.json({ ok: true, jobs });
  }

  return Response.json(
    { ok: false, message: `지원하지 않는 action: ${action}` },
    { status: 400 },
  );
}
