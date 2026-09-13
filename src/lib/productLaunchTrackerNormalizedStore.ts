import { normalizeProductLaunchOptionNames } from "@/lib/productLaunchOptionNames";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  buildProductLaunchTrackerIndex,
  type ProductLaunchTrackerPageQuery,
  type ProductLaunchTrackerState,
  type ProductLaunchTrackerSummary,
} from "@/lib/productLaunchTrackerOptimized";

const WORKSPACE_TABLE = "product_launch_workspaces";
const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const WRITE_CHUNK_SIZE = 100;
const MAX_PAGE_SIZE = 100;

type UnknownRecord = Record<string, unknown>;

type Config = {
  supabaseUrl: string;
  secretKey: string;
};

type Identity = {
  userId: string;
  email: string;
};

export type ProductLaunchNormalizedWorkspace = {
  owner_id?: unknown;
  owner_email?: unknown;
  schema_version?: unknown;
  policy?: unknown;
  source_imported_at?: unknown;
  counts?: unknown;
  filter_options?: unknown;
  meta_payload?: unknown;
  source_state_updated_at?: unknown;
  normalized_read_enabled?: unknown;
  backfilled_at?: unknown;
  updated_at?: unknown;
};

export type ProductLaunchNormalizedPrepared = {
  workspace: UnknownRecord;
  items: UnknownRecord[];
  options: UnknownRecord[];
  itemCount: number;
  optionCount: number;
};

export function prepareProductLaunchNormalizedSnapshot(
  stateInput: ProductLaunchTrackerState,
  identity: Identity,
  sourceStateUpdatedAt: unknown,
  readEnabled = false,
): ProductLaunchNormalizedPrepared {
  const state = isRecord(stateInput) ? stateInput : {};
  const index = buildProductLaunchTrackerIndex(state);
  const itemsById = new Map<string, UnknownRecord>();
  for (const item of index.items) {
    const itemId = text(item.id);
    if (itemId) itemsById.set(itemId, item);
  }

  const now = new Date().toISOString();
  const itemRows: UnknownRecord[] = [];
  const optionRows: UnknownRecord[] = [];

  for (const summary of index.summaries) {
    const item = normalizeProductLaunchOptionNames(itemsById.get(summary.id) ?? {}, { preserveRegistered: true });
    const summaryPayload = stripSearchText(summary);
    const itemPayload = cloneRecord(item);
    delete itemPayload.orderOptions;
    delete itemPayload.options;

    const stage = (key: string) => text(summary.stages?.[key]?.status) || "미시작";
    const assignees = uniqueStrings(
      Object.values(summary.stages ?? {}).map((entry) => entry.assignee),
    );
    const updatedAt = normalizedTimestamp(summary.updatedAt) ?? now;
    const createdAt = normalizedTimestamp(item.createdAt) ?? updatedAt;

    itemRows.push({
      owner_id: identity.userId,
      item_id: summary.id,
      tracker_row_number: summary.trackerRowNumber,
      work_batch: summary.workBatch,
      warehouse_location: summary.warehouseLocation,
      barcode: summary.barcode,
      model_number: summary.modelNumber,
      product_name: summary.productName,
      shopling_category: summary.shoplingCategory,
      self_code_base: summary.selfCodeBase,
      overall_status: summary.overallStatus,
      next_stage: summary.nextStage,
      completed_stage_count: summary.progress.completed,
      readiness_ready: summary.readiness.ready,
      readiness_error_count: summary.readiness.errorCount,
      readiness_warning_count: summary.readiness.warningCount,
      detail_page_status: stage("detailPage"),
      price_keyword_status: stage("priceKeyword"),
      shopling_upload_status: stage("shoplingUpload"),
      market_registration_status: stage("marketRegistration"),
      order_mapping_status: stage("orderMapping"),
      inventory_reflection_status: stage("inventoryReflection"),
      assignees,
      option_labels: summary.optionLabels,
      option_barcodes: summary.optionLocations.map((entry) => entry.barcode).filter(Boolean),
      option_sort_text: summary.optionLabels.join(", "),
      search_text: summary.searchText,
      archived_at: normalizedTimestamp(summary.archivedAt),
      migration_review: summary.migrationReview,
      summary_payload: summaryPayload,
      item_payload: itemPayload,
      updated_at: updatedAt,
      updated_by: summary.updatedBy,
      created_at: createdAt,
    });

    const orderOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.filter(isRecord)
      : [];
    orderOptions.forEach((option, optionIndex) => {
      const optionId = text(option.id) || `option-${optionIndex + 1}`;
      optionRows.push({
        owner_id: identity.userId,
        item_id: summary.id,
        option_id: optionId,
        option_index: optionIndex,
        option_name: text(option.optionName) || "옵션",
        sale_option: text(option.saleOption ?? option.value),
        china_option: text(option.chinaOption),
        barcode: normalizeLocationCode(option.barcode),
        base_sale_price_krw: nonNegativeInteger(option.baseSalePriceKrw),
        unit_cost_krw: nonNegativeInteger(option.unitCostKrw),
        source_order_item_id:
          option.sourceOrderItemId === null || option.sourceOrderItemId === undefined
            ? null
            : text(option.sourceOrderItemId),
        option_payload: cloneRecord(option),
        updated_at: updatedAt,
      });
    });
  }

  const metaPayload = cloneRecord(state);
  delete metaPayload.items;
  delete metaPayload.policy;
  delete metaPayload.productLaunchListSnapshot;

  return {
    workspace: {
      owner_id: identity.userId,
      owner_email: identity.email,
      schema_version: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
      policy: isRecord(state.policy) ? state.policy : {},
      source_imported_at: nullableText(state.sourceImportedAt),
      counts: index.counts,
      filter_options: index.filterOptions,
      meta_payload: metaPayload,
      source_state_updated_at: normalizedTimestamp(sourceStateUpdatedAt),
      normalized_read_enabled: readEnabled,
      updated_at: now,
    },
    items: itemRows,
    options: optionRows,
    itemCount: itemRows.length,
    optionCount: optionRows.length,
  };
}

export async function readProductLaunchNormalizedWorkspace(
  config: Config,
  ownerId: string,
): Promise<ProductLaunchNormalizedWorkspace | null> {
  const params = new URLSearchParams({
    select:
      "owner_id,owner_email,schema_version,policy,source_imported_at,counts,filter_options,meta_payload,source_state_updated_at,normalized_read_enabled,backfilled_at,updated_at",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const response = await normalizedFetch(
    config,
    `${WORKSPACE_TABLE}?${params.toString()}`,
  );
  if (response.missingSchema) return null;
  const rows = Array.isArray(response.body) ? response.body : [];
  return (rows[0] as ProductLaunchNormalizedWorkspace | undefined) ?? null;
}

export function isProductLaunchNormalizedFresh(
  workspace: ProductLaunchNormalizedWorkspace | null,
  sourceStateUpdatedAt: unknown,
) {
  if (!workspace || workspace.normalized_read_enabled !== true) return false;
  const left = timestamp(workspace.source_state_updated_at);
  const right = timestamp(sourceStateUpdatedAt);
  return left > 0 && right > 0 && Math.abs(left - right) < 1000;
}

export async function queryProductLaunchNormalizedPage(
  config: Config,
  ownerId: string,
  workspace: ProductLaunchNormalizedWorkspace,
  query: ProductLaunchTrackerPageQuery,
) {
  const pageSize = clampInteger(query.pageSize, 50, 1, MAX_PAGE_SIZE);
  const requestedPage = clampInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const search = normalizeSearch(query.search);
  const batch = text(query.batch);
  const assignee = text(query.assignee);
  const overall = text(query.overall);
  const unfinishedOnly = booleanValue(query.unfinishedOnly, true);
  const sort = text(query.sort);
  const direction = text(query.direction) === "asc" ? "asc" : "desc";

  const params = new URLSearchParams({
    select: "summary_payload",
    owner_id: `eq.${ownerId}`,
  });
  if (batch) params.set("work_batch", `eq.${batch}`);
  if (assignee) params.set("assignees", `cs.${postgresArrayLiteral([assignee])}`);
  if (overall) params.set("overall_status", `eq.${overall}`);
  if (unfinishedOnly) params.set("overall_status", "not.in.(완료,보관됨)");
  if (search) params.set("search_text", `ilike.*${safeSearchFilter(search)}*`);
  params.set("order", normalizedOrder(sort, direction));

  const initialOffset = (requestedPage - 1) * pageSize;
  const first = await fetchNormalizedPageRows(
    config,
    `${ITEM_TABLE}?${params.toString()}`,
    initialOffset,
    pageSize,
  );
  const total = first.total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const payload =
    page === requestedPage
      ? first
      : await fetchNormalizedPageRows(
          config,
          `${ITEM_TABLE}?${params.toString()}`,
          (page - 1) * pageSize,
          pageSize,
        );

  return {
    page,
    pageSize,
    pageCount,
    total,
    items: payload.rows
      .map((row) => (isRecord(row.summary_payload) ? row.summary_payload : null))
      .filter(Boolean),
    counts: isRecord(workspace.counts) ? workspace.counts : {},
    filterOptions: isRecord(workspace.filter_options)
      ? workspace.filter_options
      : { batches: [], assignees: [] },
  };
}

export async function readProductLaunchNormalizedItem(
  config: Config,
  ownerId: string,
  itemId: string,
) {
  const items = await readProductLaunchNormalizedItems(config, ownerId, [itemId]);
  return items[0] ?? null;
}

export async function readProductLaunchNormalizedItems(
  config: Config,
  ownerId: string,
  itemIds: string[],
) {
  const ids = uniqueStrings(itemIds).slice(0, 100);
  if (!ids.length) return [];
  const inFilter = postgrestIn(ids);
  const itemParams = new URLSearchParams({
    select: "item_id,item_payload,updated_at,updated_by",
    owner_id: `eq.${ownerId}`,
    item_id: `in.(${inFilter})`,
    limit: "100",
  });
  const optionParams = new URLSearchParams({
    select: "item_id,option_id,option_index,option_payload",
    owner_id: `eq.${ownerId}`,
    item_id: `in.(${inFilter})`,
    order: "item_id.asc,option_index.asc",
    limit: "5000",
  });
  const [itemResponse, optionResponse] = await Promise.all([
    normalizedFetch(config, `${ITEM_TABLE}?${itemParams.toString()}`),
    normalizedFetch(config, `${OPTION_TABLE}?${optionParams.toString()}`),
  ]);
  if (itemResponse.missingSchema || optionResponse.missingSchema) return [];
  const optionsByItem = new Map<string, UnknownRecord[]>();
  for (const row of Array.isArray(optionResponse.body) ? optionResponse.body : []) {
    if (!isRecord(row)) continue;
    const itemId = text(row.item_id);
    const payload = isRecord(row.option_payload) ? cloneRecord(row.option_payload) : {};
    if (!text(payload.id)) payload.id = text(row.option_id);
    const list = optionsByItem.get(itemId) ?? [];
    list.push(payload);
    optionsByItem.set(itemId, list);
  }

  const byId = new Map<string, UnknownRecord>();
  for (const row of Array.isArray(itemResponse.body) ? itemResponse.body : []) {
    if (!isRecord(row)) continue;
    const itemId = text(row.item_id);
    const payload = isRecord(row.item_payload) ? cloneRecord(row.item_payload) : {};
    payload.id = itemId;
    payload.orderOptions = optionsByItem.get(itemId) ?? [];
    payload.options = (payload.orderOptions as UnknownRecord[])
      .map((option) => text(option.saleOption ?? option.value))
      .filter(Boolean);
    payload.updatedAt = text(payload.updatedAt) || normalizedTimestamp(row.updated_at) || "";
    payload.updatedBy = text(payload.updatedBy) || text(row.updated_by);
    byId.set(itemId, payload);
  }
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function syncProductLaunchNormalizedFull(
  config: Config,
  identity: Identity,
  state: ProductLaunchTrackerState,
  sourceStateUpdatedAt: unknown,
  options: { readEnabled?: boolean; backfilledAt?: string | null } = {},
) {
  const existing = await readProductLaunchNormalizedWorkspace(config, identity.userId);
  const readEnabled = options.readEnabled ?? (existing?.normalized_read_enabled === true);
  const prepared = prepareProductLaunchNormalizedSnapshot(
    state,
    identity,
    sourceStateUpdatedAt,
    readEnabled,
  );

  await ensureWorkspace(config, identity, existing);
  await deleteOwnerRows(config, OPTION_TABLE, identity.userId);
  await deleteOwnerRows(config, ITEM_TABLE, identity.userId);
  await upsertRows(config, ITEM_TABLE, prepared.items, "owner_id,item_id");
  await upsertRows(config, OPTION_TABLE, prepared.options, "owner_id,item_id,option_id");
  const finalWorkspace = {
    ...prepared.workspace,
    normalized_read_enabled: readEnabled,
    backfilled_at:
      options.backfilledAt ??
      (typeof existing?.backfilled_at === "string" ? existing.backfilled_at : null),
    updated_at: new Date().toISOString(),
  };
  await upsertRows(config, WORKSPACE_TABLE, [finalWorkspace], "owner_id");
  return {
    synced: true,
    itemCount: prepared.itemCount,
    optionCount: prepared.optionCount,
    readEnabled,
  };
}

export async function syncProductLaunchNormalizedChangedItems(
  config: Config,
  identity: Identity,
  state: ProductLaunchTrackerState,
  sourceStateUpdatedAt: unknown,
  changedIds: string[],
) {
  const existing = await readProductLaunchNormalizedWorkspace(config, identity.userId);
  if (!existing) return { synced: false, reason: "not_initialized" as const };

  const prepared = prepareProductLaunchNormalizedSnapshot(
    state,
    identity,
    sourceStateUpdatedAt,
    existing.normalized_read_enabled === true,
  );
  const changed = new Set(uniqueStrings(changedIds));
  const itemRows = prepared.items.filter((row) => changed.has(text(row.item_id)));
  const existingItemIds = new Set(itemRows.map((row) => text(row.item_id)));
  const deletedIds = [...changed].filter((id) => !existingItemIds.has(id));

  if (itemRows.length) {
    await upsertRows(config, ITEM_TABLE, itemRows, "owner_id,item_id");
    for (const itemId of existingItemIds) {
      await deleteItemOptions(config, identity.userId, itemId);
    }
    const optionRows = prepared.options.filter((row) => existingItemIds.has(text(row.item_id)));
    await upsertRows(config, OPTION_TABLE, optionRows, "owner_id,item_id,option_id");
  }
  for (const itemId of deletedIds) {
    await deleteItem(config, identity.userId, itemId);
  }

  await upsertRows(
    config,
    WORKSPACE_TABLE,
    [
      {
        ...prepared.workspace,
        normalized_read_enabled: existing.normalized_read_enabled === true,
        backfilled_at: existing.backfilled_at ?? null,
        updated_at: new Date().toISOString(),
      },
    ],
    "owner_id",
  );
  return {
    synced: true,
    itemCount: prepared.itemCount,
    optionCount: prepared.optionCount,
    changedCount: changed.size,
  };
}

export async function setProductLaunchNormalizedReadEnabled(
  config: Config,
  ownerId: string,
  enabled: boolean,
) {
  const params = new URLSearchParams({ owner_id: `eq.${ownerId}` });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${WORKSPACE_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        normalized_read_enabled: enabled,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
  const body = await readBody(response);
  if (!response.ok) throw new Error(readError(body, response.status));
  const rows = Array.isArray(body) ? body : [];
  return rows[0] ?? null;
}

export async function countProductLaunchNormalizedRows(config: Config, ownerId: string) {
  const [items, options] = await Promise.all([
    countRows(config, ITEM_TABLE, ownerId),
    countRows(config, OPTION_TABLE, ownerId),
  ]);
  return { itemCount: items, optionCount: options };
}

export function isProductLaunchNormalizedSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /PGRST205|42P01|product_launch_(workspaces|items|options)|relation .* does not exist|could not find the table/i.test(
    message,
  );
}

async function ensureWorkspace(
  config: Config,
  identity: Identity,
  existing: ProductLaunchNormalizedWorkspace | null,
) {
  if (existing) return;
  await upsertRows(
    config,
    WORKSPACE_TABLE,
    [
      {
        owner_id: identity.userId,
        owner_email: identity.email,
        schema_version: 3,
        policy: {},
        counts: {},
        filter_options: { batches: [], assignees: [] },
        meta_payload: {},
        normalized_read_enabled: false,
        updated_at: new Date().toISOString(),
      },
    ],
    "owner_id",
  );
}

async function fetchNormalizedPageRows(
  config: Config,
  url: string,
  offset: number,
  pageSize: number,
) {
  const end = offset + pageSize - 1;
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${url}`, {
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      Prefer: "count=exact",
      "Range-Unit": "items",
      Range: `${offset}-${end}`,
    },
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(readError(body, response.status));
  return {
    rows: Array.isArray(body) ? body.filter(isRecord) : [],
    total: parseContentRangeTotal(response.headers.get("content-range")),
  };
}

async function normalizedFetch(config: Config, relativeUrl: string) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${relativeUrl}`, {
    headers: createSupabaseAdminHeaders(config.secretKey),
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok) {
    const error = new Error(readError(body, response.status));
    if (isProductLaunchNormalizedSchemaError(error)) {
      return { body: null, missingSchema: true as const };
    }
    throw error;
  }
  return { body, missingSchema: false as const };
}

async function upsertRows(
  config: Config,
  table: string,
  rows: UnknownRecord[],
  conflict: string,
) {
  if (!rows.length) return;
  for (let offset = 0; offset < rows.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + WRITE_CHUNK_SIZE);
    const params = new URLSearchParams({ on_conflict: conflict });
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(config.secretKey),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(chunk),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const body = await readBody(response);
      throw new Error(readError(body, response.status));
    }
  }
}

async function deleteOwnerRows(config: Config, table: string, ownerId: string) {
  const params = new URLSearchParams({ owner_id: `eq.${ownerId}` });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`,
    {
      method: "DELETE",
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await readBody(response);
    throw new Error(readError(body, response.status));
  }
}

async function deleteItemOptions(config: Config, ownerId: string, itemId: string) {
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${params.toString()}`,
    {
      method: "DELETE",
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await readBody(response);
    throw new Error(readError(body, response.status));
  }
}

async function deleteItem(config: Config, ownerId: string, itemId: string) {
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${params.toString()}`,
    {
      method: "DELETE",
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await readBody(response);
    throw new Error(readError(body, response.status));
  }
}

async function countRows(config: Config, table: string, ownerId: string) {
  const params = new URLSearchParams({
    select: table === OPTION_TABLE ? "option_id" : "item_id",
    owner_id: `eq.${ownerId}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`,
    {
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "count=exact",
        Range: "0-0",
      },
      cache: "no-store",
    },
  );
  const body = await readBody(response);
  if (!response.ok) throw new Error(readError(body, response.status));
  return parseContentRangeTotal(response.headers.get("content-range"));
}

function normalizedOrder(sort: string, direction: "asc" | "desc") {
  const map: Record<string, string> = {
    workBatch: "work_batch",
    warehouseLocation: "warehouse_location",
    barcode: "barcode",
    modelNumber: "model_number",
    productName: "product_name",
    shoplingCategory: "shopling_category",
    selfCodeBase: "self_code_base",
    options: "option_sort_text",
    readiness: "readiness_ready",
    nextStage: "next_stage",
    detailPage: "detail_page_status",
    priceKeyword: "price_keyword_status",
    shoplingUpload: "shopling_upload_status",
    marketRegistration: "market_registration_status",
    orderMapping: "order_mapping_status",
    inventoryReflection: "inventory_reflection_status",
  };
  const column = map[sort];
  if (!column) return "updated_at.desc,model_number.desc";
  return `${column}.${direction},updated_at.desc,model_number.desc`;
}

function stripSearchText(summary: ProductLaunchTrackerSummary) {
  const { searchText: _searchText, ...payload } = summary;
  return payload;
}

function postgresArrayLiteral(values: string[]) {
  return `{${values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function safeSearchFilter(value: string) {
  return value.replace(/[(),*]/g, " ").replace(/\s+/g, " ").trim();
}

function parseContentRangeTotal(value: string | null) {
  if (!value) return 0;
  const match = value.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readError(body: unknown, status: number) {
  if (isRecord(body)) {
    for (const key of ["message", "error", "details", "hint", "code"]) {
      const value = text(body[key]);
      if (value) return value;
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return `상품출시 정규화 DB 요청에 실패했습니다. status=${status}`;
}

function normalizeSearch(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function normalizeLocationCode(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function normalizedTimestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Math.ceil(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(text(value).toLowerCase());
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function cloneRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
