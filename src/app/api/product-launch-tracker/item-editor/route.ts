import { after, NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readResponseJson,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { roundUpProductLaunchPriceKrw } from "@/lib/productLaunchPricePolicy";
import {
  readProductLaunchNormalizedItem,
  readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  applyProductLaunchTrackerMutation,
  summarizeProductLaunchTrackerItem,
  type ProductLaunchTrackerState,
  type ProductLaunchTrackerSummary,
} from "@/lib/productLaunchTrackerOptimized";
import { PATCH as legacyPatch } from "../optimized/route";

const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const WORKSPACE_TABLE = "product_launch_workspaces";

type UnknownRecord = Record<string, unknown>;
type Config = { supabaseUrl: string; secretKey: string };
type Identity = { userId: string; email: string };

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const itemId = text(request.nextUrl.searchParams.get("id"));
  if (!itemId) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_ID_REQUIRED",
        message: "불러올 상품 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const [item, workspace] = await Promise.all([
    readProductLaunchNormalizedItem(config.value, identity.value.userId, itemId),
    readProductLaunchNormalizedWorkspace(config.value, identity.value.userId),
  ]);
  if (!item) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
        message: "상품 기록을 찾지 못했습니다.",
      },
      { status: 404 },
    );
  }

  return Response.json({
    ok: true,
    stateExists: true,
    item,
    policy: isRecord(workspace?.policy) ? workspace?.policy : null,
    updatedAt: text(asRecord(item).updatedAt) || null,
    schemaVersion: numberOrNull(workspace?.schema_version),
    itemSource: "normalized-direct",
  });
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRODUCT_LAUNCH_TRACKER_MUTATION",
        message: "변경 요청 JSON이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }
  const legacyRequest = new NextRequest(request.url, {
    method: "PATCH",
    headers: new Headers(request.headers),
    body: JSON.stringify(input),
  });

  const inputRecord = asRecord(input);
  if (text(inputRecord.operation) !== "patch_item") {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_DIRECT_ITEM_OPERATION_REQUIRED",
        message: "독립 편집기는 상품 1건 수정만 지원합니다.",
      },
      { status: 400 },
    );
  }

  const itemId = text(inputRecord.itemId);
  if (!itemId) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_ID_REQUIRED",
        message: "수정할 상품 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const current = await readProductLaunchNormalizedItem(
    config.value,
    identity.value.userId,
    itemId,
  );
  if (!current) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
        message: "수정할 상품을 찾지 못했습니다.",
      },
      { status: 404 },
    );
  }

  try {
    const beforeSummary = summarizeProductLaunchTrackerItem(asRecord(current));
    const mutation = applyProductLaunchTrackerMutation(
      {
        schemaVersion: 3,
        items: [current],
      } as ProductLaunchTrackerState,
      input,
    );
    const next = Array.isArray(mutation.state.items)
      ? mutation.state.items.find(
          (candidate) => isRecord(candidate) && text(candidate.id) === itemId,
        )
      : null;
    if (!isRecord(next)) throw new Error("저장할 상품 데이터를 만들지 못했습니다.");

    const afterSummary = summarizeProductLaunchTrackerItem(next);
    await writeNormalizedItem(config.value, identity.value, next, afterSummary);

    after(async () => {
      await Promise.allSettled([
        refreshWorkspaceRollup(
          config.value,
          identity.value.userId,
          beforeSummary,
          afterSummary,
        ),
        mirrorToLegacy(
          legacyRequest,
          config.value,
          identity.value,
          itemId,
        ),
      ]);
    });

    return Response.json({
      ok: true,
      updatedAt: text(next.updatedAt) || new Date().toISOString(),
      changedIds: [itemId],
      items: [stripSearchText(afterSummary)],
      normalizedDirect: true,
      legacyMirrorQueued: true,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_DIRECT_ITEM_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품 1건을 정규화 DB에 저장하지 못했습니다.",
      },
      { status: 503 },
    );
  }
}

async function writeNormalizedItem(
  config: Config,
  identity: Identity,
  item: UnknownRecord,
  summary: ProductLaunchTrackerSummary,
) {
  const now = new Date().toISOString();
  const updatedAt = text(item.updatedAt) || now;
  const itemPayload = cloneRecord(item);
  delete itemPayload.orderOptions;
  delete itemPayload.options;
  const summaryPayload = stripSearchText(summary);
  const assignees = uniqueStrings(
    Object.values(summary.stages).map((stage) => stage.assignee),
  );
  const orderOptions = Array.isArray(item.orderOptions)
    ? item.orderOptions.filter(isRecord)
    : [];

  const itemRow: UnknownRecord = {
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
    detail_page_status: stageStatus(summary, "detailPage"),
    price_keyword_status: stageStatus(summary, "priceKeyword"),
    shopling_upload_status: stageStatus(summary, "shoplingUpload"),
    market_registration_status: stageStatus(summary, "marketRegistration"),
    order_mapping_status: stageStatus(summary, "orderMapping"),
    inventory_reflection_status: stageStatus(summary, "inventoryReflection"),
    assignees,
    option_labels: summary.optionLabels,
    option_barcodes: summary.optionLocations.map((entry) => entry.barcode).filter(Boolean),
    option_barcode_nos: orderOptions
      .map((option) => text(option.optionBarcodeNo))
      .filter(Boolean),
    option_sort_text: summary.optionLabels.join(", "),
    search_text: summary.searchText,
    archived_at: summary.archivedAt,
    migration_review: summary.migrationReview,
    summary_payload: summaryPayload,
    item_payload: itemPayload,
    updated_at: updatedAt,
    updated_by: text(item.updatedBy),
    created_at: text(item.createdAt) || updatedAt,
  };

  await upsertRows(config, ITEM_TABLE, [itemRow], "owner_id,item_id");

  const optionRows = orderOptions.map((option, optionIndex) => {
    const optionId = text(option.id) || `option-${optionIndex + 1}`;
    const baseSalePriceKrw = roundUpProductLaunchPriceKrw(option.baseSalePriceKrw);
    const optionPayload = cloneRecord(option);
    optionPayload.baseSalePriceKrw = baseSalePriceKrw;
    return {
      owner_id: identity.userId,
      item_id: summary.id,
      option_id: optionId,
      option_index: optionIndex,
      option_name: text(option.optionName) || "옵션",
      sale_option: text(option.saleOption ?? option.value),
      china_option: text(option.chinaOption),
      barcode: text(option.barcode),
      base_sale_price_krw: baseSalePriceKrw,
      unit_cost_krw: nonNegativeInteger(option.unitCostKrw),
      source_order_item_id:
        option.sourceOrderItemId === null || option.sourceOrderItemId === undefined
          ? null
          : text(option.sourceOrderItemId),
      option_payload: optionPayload,
      updated_at: updatedAt,
      option_barcode_no: text(option.optionBarcodeNo),
      option_barcode_identity_key: text(option.optionBarcodeIdentityKey),
    } satisfies UnknownRecord;
  });

  if (optionRows.length) {
    await upsertRows(
      config,
      OPTION_TABLE,
      optionRows,
      "owner_id,item_id,option_id",
    );
  }
  await removeStaleOptions(
    config,
    identity.userId,
    summary.id,
    new Set(optionRows.map((row) => text(row.option_id))),
  );
}

async function refreshWorkspaceRollup(
  config: Config,
  ownerId: string,
  beforeSummary: ProductLaunchTrackerSummary,
  afterSummary: ProductLaunchTrackerSummary,
) {
  try {
    const workspace = await readProductLaunchNormalizedWorkspace(config, ownerId);
    if (!workspace) return;
    const counts = applyCountDelta(asRecord(workspace.counts), beforeSummary, afterSummary);
    const filterOptions = asRecord(workspace.filter_options);
    const batches = uniqueStrings([
      ...(Array.isArray(filterOptions.batches) ? filterOptions.batches : []),
      afterSummary.workBatch,
    ]).sort(localeCompare);
    const assignees = uniqueStrings([
      ...(Array.isArray(filterOptions.assignees) ? filterOptions.assignees : []),
      ...Object.values(afterSummary.stages).map((stage) => stage.assignee),
    ]).sort(localeCompare);
    const params = new URLSearchParams({ owner_id: `eq.${ownerId}` });
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/${WORKSPACE_TABLE}?${params.toString()}`,
      {
        method: "PATCH",
        headers: {
          ...createSupabaseAdminHeaders(config.secretKey),
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          counts,
          filter_options: { batches, assignees },
          updated_at: new Date().toISOString(),
        }),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const body = await readResponseJson(response);
      throw new Error(readProductLaunchError(body, response.status));
    }
  } catch (error) {
    console.error("[product-launch-direct-item] workspace rollup refresh failed", error);
  }
}

async function mirrorToLegacy(
  request: NextRequest,
  config: Config,
  identity: Identity,
  itemId: string,
) {
  try {
    const response = await legacyPatch(request);
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null as unknown);
      console.error("[product-launch-direct-item] legacy mirror failed", body);
      return;
    }
    await reconcileProductLaunchNormalizedAfterLegacyItems(
      config,
      identity,
      [itemId],
    );
  } catch (error) {
    console.error("[product-launch-direct-item] legacy mirror failed", error);
  }
}

function applyCountDelta(
  current: UnknownRecord,
  before: ProductLaunchTrackerSummary,
  after: ProductLaunchTrackerSummary,
) {
  const next: Record<string, number> = {
    전체: nonNegativeInteger(current["전체"]),
    "등록 준비": nonNegativeInteger(current["등록 준비"]),
    "SEO 제외": nonNegativeInteger(current["SEO 제외"]),
    "진행 중": nonNegativeInteger(current["진행 중"]),
    보류: nonNegativeInteger(current["보류"]),
    완료: nonNegativeInteger(current["완료"]),
  };
  for (const key of Object.keys(next)) {
    next[key] = Math.max(
      0,
      next[key] - summaryCountContribution(before, key) + summaryCountContribution(after, key),
    );
  }
  return next;
}

function summaryCountContribution(summary: ProductLaunchTrackerSummary, key: string) {
  if (summary.archivedAt) return 0;
  if (key === "전체") return 1;
  if (key === "등록 준비") {
    return !summary.seoExclusion.excluded && summary.readiness.ready ? 1 : 0;
  }
  if (key === "SEO 제외") return summary.seoExclusion.excluded ? 1 : 0;
  if (key === "진행 중") return summary.overallStatus === "진행 중" ? 1 : 0;
  if (key === "보류") return summary.overallStatus === "보류" ? 1 : 0;
  if (key === "완료") return summary.overallStatus === "완료" ? 1 : 0;
  return 0;
}

async function upsertRows(
  config: Config,
  table: string,
  rows: UnknownRecord[],
  conflict: string,
) {
  if (!rows.length) return;
  const params = new URLSearchParams({ on_conflict: conflict });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await readResponseJson(response);
    throw new Error(readProductLaunchError(body, response.status));
  }
}

async function removeStaleOptions(
  config: Config,
  ownerId: string,
  itemId: string,
  keepIds: Set<string>,
) {
  const params = new URLSearchParams({
    select: "option_id",
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  const staleIds = (Array.isArray(body) ? body : [])
    .map((row) => text(asRecord(row).option_id))
    .filter((id) => id && !keepIds.has(id));
  await Promise.all(staleIds.map((optionId) => deleteOption(config, ownerId, itemId, optionId)));
}

async function deleteOption(
  config: Config,
  ownerId: string,
  itemId: string,
  optionId: string,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
    option_id: `eq.${optionId}`,
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
    const body = await readResponseJson(response);
    throw new Error(readProductLaunchError(body, response.status));
  }
}

function stageStatus(summary: ProductLaunchTrackerSummary, key: string) {
  return text(summary.stages[key]?.status) || "미시작";
}

function stripSearchText(summary: ProductLaunchTrackerSummary) {
  const { searchText: _searchText, ...safeSummary } = summary;
  return safeSummary;
}

function cloneRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? structuredClone(value) : {};
}

function uniqueStrings(value: unknown) {
  const source = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      source
        .map(text)
        .filter(Boolean),
    ),
  ];
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function localeCompare(left: string, right: string) {
  return left.localeCompare(right, "ko-KR", { numeric: true, sensitivity: "base" });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
