import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const VIRTUAL_PREFIX = "legacy-stock:";
const CATALOG_TTL_MS = 60_000;

type Config = { supabaseUrl: string; secretKey: string };
type Identity = { userId: string; email: string };
type UnknownRecord = Record<string, unknown>;

type PlanningCandidateOption = {
  id: string;
  optionName: string;
  saleOption: string;
  barcode: string;
  goodsKeys: string[];
};

export type LegacySeoPlanningCandidate = {
  id: string;
  modelNumber: string;
  productName: string;
  goodsKeys: string[];
  optionLabels: string[];
  barcodes: string[];
  options: PlanningCandidateOption[];
  source: "product_master_shopling_listing";
};

let cachedCatalog:
  | { expiresAt: number; promise: Promise<Map<string, LegacySeoPlanningCandidate>> }
  | null = null;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function unique(values: unknown[], limit = 500) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function normalizeGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d{5,12}$/.test(normalized) ? normalized : "";
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

async function readJson(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function rest(
  config: Config,
  relativeUrl: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${relativeUrl}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `LEGACY_SEO_PLANNING_BOOTSTRAP_DB_${response.status}:${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return body;
}

async function buildPlanningCatalog() {
  const snapshot = await loadProductPlanningSnapshot();
  const grouped = new Map<
    string,
    {
      productNames: string[];
      goodsKeys: string[];
      options: PlanningCandidateOption[];
    }
  >();

  for (const product of snapshot.products ?? []) {
    const modelNumber = modelKey(product.modelNo);
    if (!/^AAA\d+(?:-\d+)?$/.test(modelNumber)) continue;
    if (product.skuActive === false) continue;

    const liveListings = (product.listings ?? []).filter(
      (listing) => listing.active !== false && Boolean(normalizeGoodsKey(listing.goodsKey)),
    );
    if (!liveListings.length) continue;

    const goodsKeys = unique(
      liveListings.map((listing) => normalizeGoodsKey(listing.goodsKey)),
      120,
    );
    const current = grouped.get(modelNumber) ?? {
      productNames: [],
      goodsKeys: [],
      options: [],
    };
    current.productNames.push(text(product.productName));
    current.goodsKeys.push(...goodsKeys);

    const barcode = normalizeBarcode(product.barcode);
    const saleOption = text(product.optionName) || "단품";
    if (barcode) {
      const optionKey = `${barcode}\u0000${saleOption}`;
      if (!current.options.some((option) => option.id === optionKey)) {
        current.options.push({
          id: optionKey,
          optionName: saleOption === "단품" ? "단품" : "옵션",
          saleOption,
          barcode,
          goodsKeys,
        });
      }
    }
    grouped.set(modelNumber, current);
  }

  const result = new Map<string, LegacySeoPlanningCandidate>();
  for (const [modelNumber, value] of grouped) {
    const goodsKeys = unique(value.goodsKeys, 120);
    if (!goodsKeys.length) continue;
    const options = value.options.map((option, index) => ({
      ...option,
      id: `planning-${safeId(modelNumber)}-${index + 1}`,
    }));
    const optionLabels = unique(options.map((option) => option.saleOption), 100);
    const barcodes = unique(options.map((option) => option.barcode), 100);
    result.set(modelNumber, {
      id: `${VIRTUAL_PREFIX}${modelNumber.toLowerCase()}`,
      modelNumber,
      productName: unique(value.productNames, 20)[0] || modelNumber,
      goodsKeys,
      optionLabels: optionLabels.length ? optionLabels : ["단품"],
      barcodes,
      options,
      source: "product_master_shopling_listing",
    });
  }
  return result;
}

export async function loadLegacySeoPlanningCatalog(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && cachedCatalog && cachedCatalog.expiresAt > now) {
    return cachedCatalog.promise;
  }
  const promise = buildPlanningCatalog();
  cachedCatalog = { expiresAt: now + CATALOG_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (cachedCatalog?.promise === promise) cachedCatalog = null;
    throw error;
  }
}

export function isLegacySeoPlanningVirtualId(itemId: string) {
  return itemId.startsWith(VIRTUAL_PREFIX);
}

export function modelFromLegacySeoPlanningVirtualId(itemId: string) {
  if (!isLegacySeoPlanningVirtualId(itemId)) return "";
  return modelKey(itemId.slice(VIRTUAL_PREFIX.length));
}

export async function mergeLegacySeoPlanningCandidates(
  normalizedRows: UnknownRecord[],
) {
  const catalog = await loadLegacySeoPlanningCatalog();
  const rowsByModel = new Map<string, UnknownRecord>();
  for (const row of normalizedRows) {
    const model = modelKey(row.model_number ?? row.modelNumber);
    if (model && !rowsByModel.has(model)) rowsByModel.set(model, row);
  }

  const merged: UnknownRecord[] = [];
  const includedModels = new Set<string>();
  for (const row of normalizedRows) {
    const model = modelKey(row.model_number ?? row.modelNumber);
    if (!model) continue;
    const verifiedByPlanning = catalog.has(model);
    const shoplingComplete = text(row.shopling_upload_status ?? row.shoplingUploadStatus) === "완료";
    if (!shoplingComplete && !verifiedByPlanning) continue;
    includedModels.add(model);
    merged.push({
      ...row,
      shopling_upload_status: shoplingComplete ? "완료" : "완료",
      legacy_shopling_verified: verifiedByPlanning,
      legacy_candidate_source: verifiedByPlanning
        ? "product_master_shopling_listing"
        : "normalized_shopling_complete",
    });
  }

  for (const [model, candidate] of catalog) {
    if (includedModels.has(model) || rowsByModel.has(model)) continue;
    merged.push({
      item_id: candidate.id,
      tracker_row_number: null,
      work_batch: "이전상품 자동복구",
      model_number: candidate.modelNumber,
      product_name: candidate.productName,
      shopling_category: "",
      shopling_upload_status: "완료",
      overall_status: "완료",
      option_labels: candidate.optionLabels,
      updated_at: "",
      exclusion_policy: {},
      legacy_shopling_verified: true,
      legacy_candidate_source: candidate.source,
    });
  }

  return merged;
}

async function existingRowsForModels(config: Config, ownerId: string, models: string[]) {
  if (!models.length) return [] as UnknownRecord[];
  const params = new URLSearchParams({
    select:
      "item_id,model_number,product_name,shopling_upload_status,item_payload,summary_payload,option_labels,option_barcodes,updated_at",
    owner_id: `eq.${ownerId}`,
    model_number: `in.(${postgrestIn(models)})`,
    archived_at: "is.null",
    limit: "500",
  });
  const body = await rest(config, `${ITEM_TABLE}?${params.toString()}`);
  return Array.isArray(body) ? body.filter((row): row is UnknownRecord => Boolean(row && typeof row === "object")) : [];
}

function bootstrapItemPayload(candidate: LegacySeoPlanningCandidate, itemId: string, now: string) {
  const orderOptions = candidate.options.map((option, index) => ({
    id: option.id,
    optionName: option.optionName,
    saleOption: option.saleOption,
    chinaOption: "",
    barcode: option.barcode,
    baseSalePriceKrw: 0,
    unitCostKrw: 0,
    sourceOrderItemId: null,
    optionBarcodeNo: option.barcode,
    optionBarcodeIdentityKey: option.barcode ? `B:${option.barcode}` : "",
    optionBarcodeIdentityKind: option.barcode ? "B_CODE" : "OPTION",
    legacyBootstrap: {
      source: candidate.source,
      goodsKeys: option.goodsKeys,
      bootstrappedAt: now,
    },
    index,
  }));
  return {
    id: itemId,
    notes: "실재고 사전 누락 이전상품 · Product Master/Shopling listing 자동복구",
    source: {
      file: "실재고 상품 관리표",
      sheet: "실재고 사전",
      import: "legacy-seo-planning-bootstrap-v1",
      verification: candidate.source,
    },
    stages: {
      detailPage: { status: "완료", assignee: "", note: "Shopling 기존상품에서 재사용" },
      priceKeyword: { status: "제외", assignee: "", note: "이전상품 SEO 전용" },
      shoplingUpload: { status: "완료", assignee: "", note: "Product Master의 활성 Shopling listing으로 확인" },
      marketRegistration: { status: "제외", assignee: "", note: "기존상품 재등록 전용" },
      orderMapping: { status: "제외", assignee: "", note: "이전상품 SEO 전용" },
      inventoryReflection: { status: "제외", assignee: "", note: "이전상품 SEO 전용" },
    },
    barcode: candidate.barcodes[0] || "",
    createdAt: now,
    updatedAt: now,
    updatedBy: "legacy SEO Product Master/Shopling 자동복구",
    workBatch: "이전상품 자동복구",
    archivedAt: null,
    modelNumber: candidate.modelNumber,
    productName: candidate.productName,
    optionLabels: candidate.optionLabels,
    orderOptions,
    warehouseLocation: candidate.barcodes[0] || "",
    detailPageAssetSource: {
      source: "product_master_shopling_listing_bootstrap",
      goodsKeys: candidate.goodsKeys,
      backfilledAt: now,
    },
    shoplingProducts: Object.fromEntries(
      candidate.goodsKeys.map((goodsKey) => [goodsKey, { goodsKey }]),
    ),
    legacySeoBootstrap: {
      source: candidate.source,
      goodsKeys: candidate.goodsKeys,
      verifiedAt: now,
    },
  };
}

export async function bootstrapLegacySeoPlanningItems(input: {
  config: Config;
  identity: Identity;
  itemIds: string[];
}) {
  const catalog = await loadLegacySeoPlanningCatalog({ force: true });
  const requestedModels = unique(
    input.itemIds
      .map((itemId) => modelFromLegacySeoPlanningVirtualId(itemId))
      .filter(Boolean),
    100,
  );
  const virtualToReal = new Map<string, string>();
  if (!requestedModels.length) return { virtualToReal, bootstrapped: 0, promoted: 0, missing: [] as string[] };

  const existing = await existingRowsForModels(
    input.config,
    input.identity.userId,
    requestedModels,
  );
  const existingByModel = new Map(existing.map((row) => [modelKey(row.model_number), row] as const));
  const now = new Date().toISOString();
  let bootstrapped = 0;
  let promoted = 0;
  const missing: string[] = [];

  for (const model of requestedModels) {
    const candidate = catalog.get(model);
    if (!candidate) {
      missing.push(`${model}:Product Master/Shopling 활성 listing 없음`);
      continue;
    }
    const virtualId = candidate.id;
    const current = existingByModel.get(model);
    if (current) {
      const itemId = text(current.item_id);
      virtualToReal.set(virtualId, itemId);
      if (text(current.shopling_upload_status) !== "완료") {
        const payload = {
          ...(current.item_payload && typeof current.item_payload === "object" ? current.item_payload : {}),
          stages: {
            ...((current.item_payload as UnknownRecord)?.stages as UnknownRecord ?? {}),
            shoplingUpload: {
              status: "완료",
              assignee: "",
              note: "Product Master의 활성 Shopling listing으로 확인하여 이전상품 대상으로 승격",
            },
          },
          detailPageAssetSource: {
            ...(((current.item_payload as UnknownRecord)?.detailPageAssetSource as UnknownRecord) ?? {}),
            source: "product_master_shopling_listing_bootstrap",
            goodsKeys: candidate.goodsKeys,
            backfilledAt: now,
          },
          legacySeoBootstrap: {
            source: candidate.source,
            goodsKeys: candidate.goodsKeys,
            verifiedAt: now,
          },
          updatedAt: now,
          updatedBy: "legacy SEO Product Master/Shopling 자동복구",
        };
        const params = new URLSearchParams({
          owner_id: `eq.${input.identity.userId}`,
          item_id: `eq.${itemId}`,
        });
        await rest(input.config, `${ITEM_TABLE}?${params.toString()}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
          body: JSON.stringify({
            shopling_upload_status: "완료",
            item_payload: payload,
            updated_at: now,
            updated_by: "legacy SEO Product Master/Shopling 자동복구",
          }),
        });
        promoted += 1;
      }
      continue;
    }

    const itemId = candidate.id;
    const itemPayload = bootstrapItemPayload(candidate, itemId, now);
    const summaryPayload = {
      id: itemId,
      modelNumber: candidate.modelNumber,
      productName: candidate.productName,
      workBatch: "이전상품 자동복구",
      overallStatus: "완료",
      optionLabels: candidate.optionLabels,
      optionCount: candidate.options.length,
      shoplingCategory: "",
      trackerRowNumber: null,
      updatedAt: now,
      updatedBy: "legacy SEO Product Master/Shopling 자동복구",
      stages: itemPayload.stages,
      orderOptions: candidate.options,
    };
    await rest(input.config, `${ITEM_TABLE}?on_conflict=owner_id,item_id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          owner_id: input.identity.userId,
          item_id: itemId,
          tracker_row_number: null,
          work_batch: "이전상품 자동복구",
          warehouse_location: candidate.barcodes[0] || "",
          barcode: candidate.barcodes[0] || "",
          model_number: candidate.modelNumber,
          product_name: candidate.productName,
          shopling_category: "",
          self_code_base: "",
          overall_status: "완료",
          next_stage: "출시 완료",
          completed_stage_count: 6,
          readiness_ready: false,
          readiness_error_count: 0,
          readiness_warning_count: 1,
          detail_page_status: "완료",
          price_keyword_status: "제외",
          shopling_upload_status: "완료",
          market_registration_status: "제외",
          order_mapping_status: "제외",
          inventory_reflection_status: "제외",
          assignees: [],
          option_labels: candidate.optionLabels,
          option_barcodes: candidate.barcodes,
          option_sort_text: candidate.optionLabels.join(", "),
          search_text: `${candidate.modelNumber} ${candidate.productName} ${candidate.optionLabels.join(" ")}`,
          archived_at: null,
          migration_review: false,
          summary_payload: summaryPayload,
          item_payload: itemPayload,
          updated_at: now,
          updated_by: "legacy SEO Product Master/Shopling 자동복구",
          created_at: now,
        },
      ]),
    });

    if (candidate.options.length) {
      await rest(input.config, `${OPTION_TABLE}?on_conflict=owner_id,item_id,option_id`, {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          candidate.options.map((option, index) => {
            const payload = (itemPayload.orderOptions as UnknownRecord[])[index] ?? {};
            return {
              owner_id: input.identity.userId,
              item_id: itemId,
              option_id: option.id,
              option_index: index,
              option_name: option.optionName,
              sale_option: option.saleOption,
              china_option: "",
              barcode: option.barcode,
              base_sale_price_krw: 0,
              unit_cost_krw: 0,
              source_order_item_id: null,
              option_payload: payload,
              option_barcode_no: option.barcode,
              option_barcode_identity_key: option.barcode ? `B:${option.barcode}` : "",
              updated_at: now,
            };
          }),
        ),
      });
    }
    virtualToReal.set(virtualId, itemId);
    bootstrapped += 1;
  }

  return { virtualToReal, bootstrapped, promoted, missing };
}
