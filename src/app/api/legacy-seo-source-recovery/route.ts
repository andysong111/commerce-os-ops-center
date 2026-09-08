import { NextRequest } from "next/server";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import {
  LEGACY_SEO_CONFIRMED_STOCK_MODELS,
  loadLegacySeoConfirmedStockTargets,
  normalizeLegacySeoStockModel,
  type LegacySeoStockTarget,
} from "@/lib/legacySeoStockRecovery";
import {
  applyProductLaunchTrackerMutation,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";
import { syncProductLaunchNormalizedChangedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const WORK_BATCH = "등록완료건";
const SOURCE_IMPORT = "legacy-seo-stock-recovery-20260908";
const UPDATED_BY = "이전상품 실재고 사전 복구";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function modelOf(item: UnknownRecord) {
  return normalizeLegacySeoStockModel(item.modelNumber);
}

function stage(status: "미시작" | "완료", now: string, note = "") {
  return {
    status,
    assignee: "",
    completedAt: status === "완료" ? now : null,
    note,
  };
}

function itemFromTarget(target: LegacySeoStockTarget, now: string) {
  const primaryUrl = target.links[0] ?? "";
  const shoplingConfirmedNote =
    "사용자 확인: 기존 Shopling 등록상품 · 이전상품 SEO 복구 대상";
  return {
    workBatch: WORK_BATCH,
    warehouseLocation: "",
    barcode: "",
    modelNumber: target.modelNumber,
    productName: target.productName,
    shoplingCategory: "",
    selfCodeBase: "",
    optionLabels: target.optionLabels,
    orderOptions: target.orderOptions,
    options: target.optionLabels,
    chinaProductLinks: target.links,
    primaryChinaProductLink: primaryUrl,
    detailPageSource: primaryUrl
      ? {
          primaryUrl,
          urls: target.links,
          pinnedIndex: 0,
          source: SOURCE_IMPORT,
          updatedAt: now,
        }
      : null,
    stages: {
      detailPage: stage("미시작", now),
      priceKeyword: stage("미시작", now),
      shoplingUpload: stage("완료", now, shoplingConfirmedNote),
      marketRegistration: stage("미시작", now),
      orderMapping: stage("미시작", now),
      inventoryReflection: stage("미시작", now),
    },
    notes: shoplingConfirmedNote,
    source: {
      file: "실재고 상품 관리표",
      sheet: "실재고 사전",
      rows: target.sourceRows,
      columns: "B=모델번호,C=모델명,E=옵션명,F=중국주문옵션,BD:BG=주문링크1~4",
      import: SOURCE_IMPORT,
      userConfirmedPreviousProduct: true,
      productNames: target.productNames,
      saleStatuses: target.saleStatuses,
    },
    createdAt: now,
    updatedAt: now,
    updatedBy: UPDATED_BY,
  };
}

function buildRecoveryPlan(state: ProductLaunchTrackerState, targets: LegacySeoStockTarget[]) {
  const stateItems = (Array.isArray(state.items) ? state.items : [])
    .filter((value): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const byModel = new Map<string, UnknownRecord>();
  for (const item of stateItems) {
    const model = modelOf(item);
    if (model && !byModel.has(model)) byModel.set(model, item);
  }

  const targetByModel = new Map(targets.map((target) => [target.modelNumber, target] as const));
  const missingSourceModels = LEGACY_SEO_CONFIRMED_STOCK_MODELS.filter(
    (model) => !targetByModel.has(model),
  );
  const createTargets: LegacySeoStockTarget[] = [];
  const promoteIds: string[] = [];
  const alreadyEligible: string[] = [];

  for (const model of LEGACY_SEO_CONFIRMED_STOCK_MODELS) {
    const existing = byModel.get(model);
    const target = targetByModel.get(model);
    if (!existing) {
      if (target) createTargets.push(target);
      continue;
    }
    const shoplingStage = record(record(existing.stages).shoplingUpload);
    if (text(shoplingStage.status) === "완료") {
      alreadyEligible.push(model);
      continue;
    }
    const itemId = text(existing.id);
    if (itemId) promoteIds.push(itemId);
  }

  return {
    createTargets,
    promoteIds,
    alreadyEligible,
    missingSourceModels,
  };
}

async function executeRecovery(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const apply = request.nextUrl.searchParams.get("apply") === "1";
  try {
    const stateRow = (await readProductLaunchState(config.value, identity.value.userId)) as {
      state_payload?: unknown;
      updated_at?: unknown;
    } | null;
    if (!stateRow || !record(stateRow.state_payload).items) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시 진행관리 원장을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }
    const state = stateRow.state_payload as ProductLaunchTrackerState;
    const targets = await loadLegacySeoConfirmedStockTargets();
    const plan = buildRecoveryPlan(state, targets);
    const report = {
      version: SOURCE_IMPORT,
      targetCount: LEGACY_SEO_CONFIRMED_STOCK_MODELS.length,
      sourceTargetCount: targets.length,
      createCount: plan.createTargets.length,
      promoteExistingCount: plan.promoteIds.length,
      alreadyEligibleCount: plan.alreadyEligible.length,
      missingSourceModels: plan.missingSourceModels,
      createModels: plan.createTargets.map((target) => target.modelNumber),
      alreadyEligible: plan.alreadyEligible,
    };

    if (plan.missingSourceModels.length) {
      return Response.json(
        {
          ok: false,
          code: "LEGACY_SEO_STOCK_SOURCE_INCOMPLETE",
          message: `실재고 사전에서 ${plan.missingSourceModels.length}개 모델을 찾지 못했습니다. 부분 복구는 실행하지 않습니다.`,
          report,
        },
        { status: 422 },
      );
    }
    if (!apply) return Response.json({ ok: true, dryRun: true, report });

    let nextState = state;
    const changedIds = new Set<string>();
    const createdIds: string[] = [];
    const now = new Date().toISOString();

    if (plan.createTargets.length) {
      const mutation = applyProductLaunchTrackerMutation(nextState, {
        operation: "create_items",
        items: plan.createTargets.map((target) => itemFromTarget(target, now)),
        updatedBy: UPDATED_BY,
      });
      nextState = mutation.state;
      for (const id of mutation.changedIds) changedIds.add(id);
      createdIds.push(...mutation.createdIds);
    }

    if (plan.promoteIds.length) {
      const mutation = applyProductLaunchTrackerMutation(nextState, {
        operation: "bulk_stage",
        itemIds: plan.promoteIds,
        stageKey: "shoplingUpload",
        status: "완료",
        reason: "사용자 확인: 기존 Shopling 등록상품 · 이전상품 SEO 대상 복구",
      });
      nextState = mutation.state;
      for (const id of mutation.changedIds) changedIds.add(id);
    }

    const persisted = record(
      await writeProductLaunchState(
        config.value,
        identity.value,
        nextState as Record<string, unknown>,
      ),
    );
    const persistedAt = text(persisted.updated_at) || new Date().toISOString();
    const normalizedSync = await syncProductLaunchNormalizedChangedItems(
      config.value,
      identity.value,
      nextState,
      persistedAt,
      [...changedIds],
    );

    let shoplingOptionSync: UnknownRecord | null = null;
    let shoplingOptionSyncError = "";
    try {
      shoplingOptionSync = record(
        await syncLegacySeoShoplingOptions({
          config: config.value,
          identity: identity.value,
          modelNumbers: [...LEGACY_SEO_CONFIRMED_STOCK_MODELS],
        }),
      );
    } catch (error) {
      shoplingOptionSyncError = error instanceof Error ? error.message : String(error);
    }

    return Response.json({
      ok: true,
      applied: true,
      report,
      createdIds,
      changedIds: [...changedIds],
      normalizedSync,
      shoplingOptionSync,
      shoplingOptionSyncError,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "LEGACY_SEO_SOURCE_RECOVERY_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "이전상품 실재고 사전 복구에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return executeRecovery(request);
}

export async function POST(request: NextRequest) {
  return executeRecovery(request);
}
