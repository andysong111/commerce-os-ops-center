import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { PATCH as patchProductLaunchTracker } from "../optimized/route";
import {
  loadLegacySeoInventoryCatalog,
  normalizeLegacyModel,
  type LegacySeoInventoryProduct,
} from "@/lib/legacySeoInventoryCatalog";
import {
  loadLegacySeoShoplingEvidence,
  type LegacySeoGoodsKeyOverrides,
} from "@/lib/legacySeoShoplingEvidence";
import {
  buildProductLaunchSeoMaterialRecoveryPlan,
  productLaunchSeoRecoveryNeedsShoplingEvidence,
  type ProductLaunchSeoMaterialRecoveryPlan,
} from "@/lib/productLaunchSeoMaterialRecovery";
import { legacySeoRegistrationExclusion } from "@/lib/legacySeoRegistrationPolicy";
import { isSourcingReceiptPending } from "@/lib/sourcingReceiptGate";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  readProductLaunchNormalizedItemsByModelNumbers,
  readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
  return String(value ?? "").normalize("NFKC").trim();
}

function uniqueStrings(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [] as string[];
  return [
    ...new Set(
      value
        .map(text)
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

function goodsKey(value: unknown) {
  const candidate = text(value);
  return /^\d{5,12}$/.test(candidate) ? candidate : "";
}

function addGoodsKeys(target: Set<string>, values: unknown[]) {
  for (const value of values) {
    const normalized = goodsKey(value);
    if (normalized) target.add(normalized);
  }
}

function goodsKeyOverridesFor(
  items: UnknownRecord[],
  productByModel: Map<string, LegacySeoInventoryProduct>,
): LegacySeoGoodsKeyOverrides {
  const overrides: Record<string, string[]> = {};
  for (const item of items) {
    const modelNumber = normalizeLegacyModel(item.modelNumber);
    if (!modelNumber) continue;
    const keys = new Set<string>();
    const shoplingProducts = record(item.shoplingProducts);
    addGoodsKeys(
      keys,
      Object.values(shoplingProducts).flatMap((value) => {
        const row = record(value);
        return [row.goodsKey, row.goods_key];
      }),
    );
    const assetSource = record(item.detailPageAssetSource);
    const detailAsset = record(item.detailPageAsset);
    addGoodsKeys(keys, array(assetSource.goodsKeys));
    addGoodsKeys(keys, [record(detailAsset.shoplingLegacyRecovery).goodsKey]);
    addGoodsKeys(keys, [record(item.shoplingOptionSync).goodsKey]);
    for (const optionValue of array(item.orderOptions)) {
      addGoodsKeys(keys, [record(record(optionValue).shoplingOptionSync).goodsKey]);
    }
    const product = productByModel.get(modelNumber);
    for (const sku of product?.skus ?? []) {
      for (const listing of sku.listings ?? []) addGoodsKeys(keys, [listing.goodsKey]);
    }
    if (keys.size) overrides[modelNumber] = [...keys];
  }
  return overrides;
}

function statusCounts(plans: ProductLaunchSeoMaterialRecoveryPlan[]) {
  const counts: Record<string, number> = {};
  for (const plan of plans) counts[plan.status] = (counts[plan.status] ?? 0) + 1;
  return counts;
}

function planFingerprint(
  plans: ProductLaunchSeoMaterialRecoveryPlan[],
  itemById: Map<string, UnknownRecord>,
) {
  const payload = plans
    .filter((plan) => plan.changed)
    .map((plan) => ({
      itemId: plan.itemId,
      expectedUpdatedAt: text(itemById.get(plan.itemId)?.updatedAt),
      patch: plan.patch,
    }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function publicPlan(plan: ProductLaunchSeoMaterialRecoveryPlan) {
  return {
    itemId: plan.itemId,
    modelNumber: plan.modelNumber,
    productName: plan.productName,
    status: plan.status,
    changed: plan.changed,
    changedFields: plan.changedFields,
    beforeErrors: plan.beforeErrors,
    afterErrors: plan.afterErrors,
    warnings: plan.warnings,
    unresolved: plan.unresolved,
  };
}

async function prepareRecovery(request: NextRequest, body: UnknownRecord) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return { response: Response.json(identity.body, { status: identity.status }) };
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return { response: Response.json(config.body, { status: config.status }) };

  const requestedModels = new Set(
    uniqueStrings(body.modelNumbers, 500).map(normalizeLegacyModel).filter(Boolean),
  );
  const workspace = requestedModels.size
    ? await readProductLaunchNormalizedWorkspace(config.value, identity.value.userId)
    : null;
  const useNormalizedExactRead = workspace?.normalized_read_enabled === true;
  const stored = useNormalizedExactRead
    ? {}
    : record(await readProductLaunchState(config.value, identity.value.userId));
  const state = record(stored.state_payload);
  const allItems = useNormalizedExactRead
    ? await readProductLaunchNormalizedItemsByModelNumbers(
        config.value,
        identity.value.userId,
        [...requestedModels],
      )
    : array(state.items).map(record);
  const stateExists = useNormalizedExactRead ? Boolean(workspace) : allItems.length > 0;
  if (!stateExists) {
    return {
      response: Response.json(
        { ok: false, code: "PRODUCT_LAUNCH_STATE_EMPTY", message: "진행관리 상품을 찾지 못했습니다." },
        { status: 404 },
      ),
    };
  }
  const items = allItems.filter((item) => {
    if (text(item.archivedAt)) return false;
    return !requestedModels.size || requestedModels.has(normalizeLegacyModel(item.modelNumber));
  });
  const catalog = await loadLegacySeoInventoryCatalog(
    items.map((item) => item.modelNumber),
  );
  const productByModel = new Map(
    catalog.map((product) => [normalizeLegacyModel(product.modelNo), product] as const),
  );
  const evidenceItems = items
    .filter((item) => !legacySeoRegistrationExclusion(item).excluded)
    .filter((item) => !isSourcingReceiptPending(item))
    .filter(productLaunchSeoRecoveryNeedsShoplingEvidence);
  const evidenceModels = [
    ...new Set(evidenceItems.map((item) => normalizeLegacyModel(item.modelNumber)).filter(Boolean)),
  ];
  const evidenceByModel = evidenceModels.length
    ? await loadLegacySeoShoplingEvidence(
        evidenceModels,
        goodsKeyOverridesFor(evidenceItems, productByModel),
      )
    : new Map();
  const sourceStateUpdatedAt = useNormalizedExactRead
    ? text(workspace?.source_state_updated_at)
    : text(stored.updated_at);
  const recoveredAt = sourceStateUpdatedAt || "1970-01-01T00:00:00.000Z";
  const plans = items.map((item) => {
    const modelNumber = normalizeLegacyModel(item.modelNumber);
    return buildProductLaunchSeoMaterialRecoveryPlan({
      item,
      product: productByModel.get(modelNumber),
      evidence: evidenceByModel.get(modelNumber),
      recoveredAt,
    });
  });
  const itemById = new Map(items.map((item) => [text(item.id), item] as const));
  const planHash = planFingerprint(plans, itemById);
  const counts = statusCounts(plans);
  const report = {
    requestedCount: items.length,
    changedCount: plans.filter((plan) => plan.changed).length,
    readyBeforeCount: counts.already_ready ?? 0,
    readyAfterCount:
      (counts.already_ready ?? 0) + (counts.ready_after_recovery ?? 0),
    unresolvedCount:
      (counts.unresolved ?? 0) + (counts.partially_recovered ?? 0),
    excludedCount: counts.excluded ?? 0,
    receiptPendingCount: counts.receipt_pending ?? 0,
    statusCounts: counts,
    planHash,
    sourceStateUpdatedAt,
    itemSource: useNormalizedExactRead ? "normalized-exact" : "legacy-state",
    results: plans.map(publicPlan),
  };
  return {
    config: config.value,
    identity: identity.value,
    plans,
    itemById,
    report,
  };
}

export async function POST(request: NextRequest) {
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action).toLowerCase() || "preview";
  if (!new Set(["preview", "apply"]).has(action)) {
    return Response.json(
      { ok: false, code: "SEO_MATERIAL_RECOVERY_ACTION_INVALID", message: "preview 또는 apply만 지원합니다." },
      { status: 400 },
    );
  }

  try {
    const prepared = await prepareRecovery(request, body);
    if ("response" in prepared) return prepared.response;
    if (action === "preview") {
      return Response.json({ ok: true, action, applied: false, ...prepared.report });
    }

    const expectedPlanHash = text(body.expectedPlanHash);
    if (!expectedPlanHash || expectedPlanHash !== prepared.report.planHash) {
      return Response.json(
        {
          ok: false,
          code: "SEO_MATERIAL_RECOVERY_PREVIEW_STALE",
          message: "미리보기 뒤 상품 데이터가 달라졌습니다. 새 미리보기를 확인한 뒤 다시 적용하세요.",
          currentPlanHash: prepared.report.planHash,
        },
        { status: 409 },
      );
    }

    const changedPlans = prepared.plans.filter((plan) => plan.changed);
    if (!changedPlans.length) {
      return Response.json({ ok: true, action, applied: true, ...prepared.report });
    }
    const mutationRequest = new NextRequest(request.url, {
      method: "PATCH",
      headers: new Headers(request.headers),
      body: JSON.stringify({
        operation: "bulk_patch_items",
        updatedBy: "SEO 등록재료 자동복구",
        patches: changedPlans.map((plan) => ({
          itemId: plan.itemId,
          expectedUpdatedAt: text(prepared.itemById.get(plan.itemId)?.updatedAt),
          patch: plan.patch,
        })),
      }),
    });
    const mutationResponse = await patchProductLaunchTracker(mutationRequest);
    const mutation = record(await mutationResponse.clone().json().catch(() => ({})));
    if (!mutationResponse.ok || mutation.ok !== true) return mutationResponse;
    return Response.json({
      ok: true,
      action,
      applied: true,
      ...prepared.report,
      appliedCount: changedPlans.length,
      mutation: {
        updatedAt: text(mutation.updatedAt),
        changedIds: array(mutation.changedIds).map(text).filter(Boolean),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEO 등록재료 복구에 실패했습니다.";
    console.error("[seo-material-recovery] failed", error);
    return Response.json(
      { ok: false, code: "SEO_MATERIAL_RECOVERY_FAILED", message },
      { status: 503 },
    );
  }
}
