import { after, NextRequest } from "next/server";
import { POST as legacySeoRunJobsPost } from "@/app/api/legacy-seo-run-jobs/route";
import { validate1688Url } from "@/lib/keywordEngineElonLabV2";
import {
  isConfirmedLegacyInventoryModel,
  normalizeLegacyModel,
} from "@/lib/legacySeoInventoryCatalog";
import {
  insertLegacySeoRunJobs,
  listLegacySeoRunJobs,
} from "@/lib/legacySeoRunJobServer";
import { processLegacySeoRunQueue } from "@/lib/legacySeoRunWorker";
import { legacySeoRegistrationExclusion } from "@/lib/legacySeoRegistrationPolicy";
import { readProductLaunchNormalizedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import type { SeoRunJobInsert } from "@/lib/seoRunJobServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ENQUEUE_ITEMS = 100;
const CUSTOM_BLOCKED_LIMIT = 200;

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
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function parseJsonRecord(raw: string) {
  try {
    return record(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

function uniqueStrings(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [] as string[];
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

function itemOptionRows(item: UnknownRecord) {
  return array(item.orderOptions).map(record);
}

function itemOptionText(item: UnknownRecord) {
  return itemOptionRows(item)
    .map((row) =>
      [row.saleOption, row.chinaOption, row.optionName, row.barcode]
        .map(text)
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean);
}

function itemOptionNames(item: UnknownRecord) {
  return [...new Set(
    itemOptionRows(item)
      .map((row) => text(row.saleOption || row.optionName))
      .filter(Boolean),
  )];
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

function stockSupportingText(item: UnknownRecord) {
  const modelNumber = normalizeLegacyModel(item.modelNumber);
  const productName = text(item.productName) || modelNumber;
  const category = text(item.shoplingCategory);
  const options = itemOptionText(item);
  const source = record(item.source);
  const sections = [
    `실재고 사전 기존상품: ${productName}`,
    modelNumber ? `모델번호: ${modelNumber}` : "",
    category ? `상품 카테고리: ${category}` : "",
    options.length ? `판매옵션/중국옵션: ${options.join(" | ")}` : "",
    text(source.file) || text(source.sheet)
      ? `원본: ${text(source.file) || "실재고 상품 관리표"} ${text(source.sheet) || "실재고 사전"}`
      : "원본: 실재고 상품 관리표 실재고 사전",
  ].filter(Boolean);
  return sections.join(" · ").slice(0, 12_000);
}

function missingEvidenceModels(payload: UnknownRecord) {
  const result = new Set<string>();
  for (const entry of array(payload.missing)) {
    const value = text(entry);
    const suffix = ":Shopling데이터없음";
    if (!value.endsWith(suffix)) continue;
    const model = normalizeLegacyModel(value.slice(0, -suffix.length));
    if (model) result.add(model);
  }
  return result;
}

function scheduleWorker(ownerId: string, maxJobs: number) {
  after(async () => {
    await processLegacySeoRunQueue({
      workerId: `legacy-stock-fallback:${ownerId.slice(0, 8)}:${crypto.randomUUID()}`,
      maxJobs: Math.max(1, Math.min(4, maxJobs)),
      timeBudgetMs: 240_000,
    }).catch((error) => {
      console.error("[legacy-seo-stock-fallback] background worker failed", error);
    });
  });
}

function delegatedRequest(request: NextRequest, rawBody: string) {
  return new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  });
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;

  const rawBody = await request.text();
  const body = parseJsonRecord(rawBody);
  if (text(body.action) !== "enqueue") {
    return legacySeoRunJobsPost(delegatedRequest(request, rawBody));
  }

  const itemIds = uniqueStrings(body.itemIds, MAX_ENQUEUE_ITEMS);
  if (!itemIds.length) {
    return legacySeoRunJobsPost(delegatedRequest(request, rawBody));
  }

  const primaryResponse = await legacySeoRunJobsPost(delegatedRequest(request, rawBody));
  const primaryPayload = record(
    await primaryResponse
      .clone()
      .json()
      .catch(() => ({})),
  );
  const noEvidenceModels = missingEvidenceModels(primaryPayload);
  if (!noEvidenceModels.size) return primaryResponse;

  const items = (await readProductLaunchNormalizedItems(
    context.config,
    context.identity.userId,
    itemIds,
  )).map(record);
  const fallbackItems = items.filter((item) => {
    const model = normalizeLegacyModel(item.modelNumber);
    return (
      noEvidenceModels.has(model) &&
      isConfirmedLegacyInventoryModel(model) &&
      !legacySeoRegistrationExclusion(item).excluded
    );
  });
  if (!fallbackItems.length) return primaryResponse;

  const fallbackIds = fallbackItems.map((item) => text(item.id)).filter(Boolean);
  const existing = await listLegacySeoRunJobs(context, {
    includeArchived: true,
    launchItemIds: fallbackIds,
    limit: 1000,
  });
  const previousTitles = new Map<string, string[]>();
  for (const job of existing) {
    const values = previousTitles.get(job.launch_item_id) ?? [];
    values.push(...resultMallTitles(job.result_payload));
    previousTitles.set(job.launch_item_id, values);
  }

  const customBlockedTerms = uniqueStrings(
    body.customBlockedTerms,
    CUSTOM_BLOCKED_LIMIT,
  );
  const batchId = text(primaryPayload.batchId) || `legacy-seo-stock-${crypto.randomUUID()}`;
  const rows: SeoRunJobInsert[] = [];

  for (const item of fallbackItems) {
    const itemId = text(item.id);
    const modelNumber = normalizeLegacyModel(item.modelNumber);
    if (!itemId || !modelNumber) continue;
    const productName = text(item.productName) || modelNumber;
    const category = text(item.shoplingCategory);
    const real1688Url = candidate1688Url(item);
    const sourceUrl = real1688Url || `stock://legacy/${modelNumber}`;
    const optionText = itemOptionText(item).join("\n").slice(0, 8_000);
    const optionNames = itemOptionNames(item);
    const exclusions = [
      ...historicalMallTitles(item),
      ...(previousTitles.get(itemId) ?? []),
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
        flow: "legacy_stock_sheet_seo_cloud_v1",
        launchItemId: itemId,
        modelNumber,
        productName,
        sourceUrl,
        original1688Url: real1688Url,
        optionText,
        supportingText: stockSupportingText(item),
        mallTitleCategory: category,
        customBlockedTerms,
        variationSeed: runId,
        excludedMallTitles: [...new Set(exclusions)].slice(0, 1200),
        legacyShoplingEvidence: {
          source: "stock_sheet_fallback",
          goodsKeys: [],
          titles: [productName],
          searchKeywords: [],
          categories: category ? [category] : [],
          optionNames,
          fetchedRowCount: 0,
          sourceMode: real1688Url ? "1688_plus_stock" : "stock_sheet_only",
        },
      },
    });
  }

  if (!rows.length) return primaryResponse;
  const inserted = await insertLegacySeoRunJobs(context, rows);
  scheduleWorker(context.identity.userId, inserted.length || rows.length);
  const fallbackJobs = await listLegacySeoRunJobs(context, {
    runIds: rows.map((row) => row.run_id),
    includeArchived: true,
    limit: rows.length,
  });

  const recoveredModels = new Set(rows.map((row) => normalizeLegacyModel(row.model_number)));
  const remainingMissing = array(primaryPayload.missing).filter((entry) => {
    const value = text(entry);
    const suffix = ":Shopling데이터없음";
    if (!value.endsWith(suffix)) return true;
    return !recoveredModels.has(normalizeLegacyModel(value.slice(0, -suffix.length)));
  });
  const primaryJobs = Array.isArray(primaryPayload.jobs) ? primaryPayload.jobs : [];
  const primaryInserted = Math.max(0, Number(primaryPayload.insertedCount) || 0);

  return Response.json({
    ...primaryPayload,
    ok: true,
    batchId,
    requestedCount: itemIds.length,
    insertedCount: primaryInserted + inserted.length,
    missing: remainingMissing,
    stockSheetFallbackCount: inserted.length,
    stockSheetFallbackModels: rows.map((row) => row.model_number),
    jobs: [...primaryJobs, ...fallbackJobs],
  });
}
