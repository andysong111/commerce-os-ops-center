import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  applyProductLaunchTrackerMutation,
  buildProductLaunchTrackerIndex,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  withProductLaunchListSnapshot,
} from "@/lib/productLaunchTrackerListSnapshot";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import { buildPurchaseChinaLinkPatch } from "@/lib/productLaunchPurchaseMetadataCore";
import {
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";

type R = Record<string, unknown>;

type PurchaseMetadataWriteSource =
  | "CHINA_ORDER_DRAFT"
  | "PRODUCT_LAUNCH_TRACKER";

export type ProductMasterPurchaseMetadataSync = {
  ok: boolean;
  syncedAt: string;
  baseUrl?: string;
  counts?: Record<string, number>;
  error?: string;
};

export type ProductLaunchSupplierLinkWriteResult = {
  itemId: string;
  modelNumber: string;
  supplierLink: string;
  savedAt: string;
  source: PurchaseMetadataWriteSource;
  productMaster: ProductMasterPurchaseMetadataSync;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): R {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as R)
    : {};
}

function normalizeModelNumber(value: unknown) {
  const compact = text(value).toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate) throw new Error("PRODUCT_LAUNCH_SUPPLIER_LINK_REQUIRED");
  if (candidate.length > 4_000) {
    throw new Error("PRODUCT_LAUNCH_SUPPLIER_LINK_TOO_LONG");
  }
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("INVALID_PROTOCOL");
    }
    return url.toString();
  } catch {
    throw new Error("PRODUCT_LAUNCH_SUPPLIER_LINK_INVALID");
  }
}

function purchaseMetadataPatch(
  item: R,
  supplierLink: string,
  source: PurchaseMetadataWriteSource,
  savedAt: string,
  draftId?: string,
) {
  return {
    ...buildPurchaseChinaLinkPatch(item, supplierLink),
    purchaseMetadataLastWrite: {
      field: "MODEL_FIXED_FIRST_SUPPLIER_LINK",
      supplierLink,
      source,
      draftId: draftId || null,
      savedAt,
      savedBy: "승준",
    },
  };
}

export async function conditionalWriteProductLaunchState(
  config: { supabaseUrl: string; secretKey: string },
  identity: ProductLaunchIdentity,
  state: ProductLaunchTrackerState,
  expectedUpdatedAt: string,
  changedIds: string[],
) {
  const persistedState = withProductLaunchListSnapshot(state);
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${expectedUpdatedAt}`,
    select: "updated_at,schema_version",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        owner_email: identity.email,
        schema_version: Math.max(
          3,
          Math.floor(Number(persistedState.schemaVersion) || 3),
        ),
        state_payload: persistedState,
        updated_at: now,
      }),
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `PRODUCT_LAUNCH_PURCHASE_METADATA_WRITE_FAILED:${response.status}:${JSON.stringify(body).slice(0, 400)}`,
    );
  }
  if (!Array.isArray(body) || !body.length) return false;

  try {
    const sync = await syncProductLaunchNormalizedChangedItems(
      config,
      identity,
      persistedState,
      text(body[0]?.updated_at) || now,
      changedIds,
    );
    if (sync.synced || sync.reason === "not_initialized") return true;
  } catch (error) {
    console.error("Product Launch purchase metadata mirror sync failed", error);
  }
  try {
    await setProductLaunchNormalizedReadEnabled(config, identity.userId, false);
  } catch (error) {
    console.error("Product Launch normalized read disable failed", error);
  }
  return true;
}

async function syncSingleItemToProductMaster(item: R) {
  const syncedAt = new Date().toISOString();
  try {
    const result = await pushCanonicalProductMasterSnapshotFromTrackerState({
      schemaVersion: 3,
      savedAt: syncedAt,
      items: [item],
    });
    return {
      ok: true,
      syncedAt,
      baseUrl: result.baseUrl,
      counts: result.counts,
    } satisfies ProductMasterPurchaseMetadataSync;
  } catch (error) {
    return {
      ok: false,
      syncedAt,
      error:
        error instanceof Error
          ? error.message
          : "PRODUCT_MASTER_PURCHASE_METADATA_SYNC_FAILED",
    } satisfies ProductMasterPurchaseMetadataSync;
  }
}

export async function updateModelFixedSupplierLink(input: {
  identity: ProductLaunchIdentity;
  modelNumber: unknown;
  supplierLink: unknown;
  source: PurchaseMetadataWriteSource;
  draftId?: string;
}) {
  const modelNumber = normalizeModelNumber(input.modelNumber);
  if (!modelNumber) throw new Error("PRODUCT_LAUNCH_MODEL_NUMBER_REQUIRED");
  const supplierLink = normalizeSupplierLink(input.supplierLink);
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error(configResult.body.code || "PRODUCT_LAUNCH_ADMIN_NOT_CONFIGURED");
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readProductLaunchState(
      configResult.value,
      input.identity.userId,
    );
    const state =
      stored?.state_payload && typeof stored.state_payload === "object"
        ? (stored.state_payload as ProductLaunchTrackerState)
        : null;
    const expectedUpdatedAt = text(stored?.updated_at);
    if (!state || !expectedUpdatedAt) {
      throw new Error("PRODUCT_LAUNCH_STATE_REQUIRED");
    }

    const index = buildProductLaunchTrackerIndex(state);
    const matches = index.items.filter(
      (item) => normalizeModelNumber(item.modelNumber) === modelNumber,
    );
    const activeMatches = matches.filter((item) => !text(item.archivedAt));
    const candidates = activeMatches.length ? activeMatches : matches;
    if (!candidates.length) {
      throw new Error(`PRODUCT_LAUNCH_MODEL_NOT_FOUND:${modelNumber}`);
    }
    if (candidates.length > 1) {
      throw new Error(`PRODUCT_LAUNCH_MODEL_CONFLICT:${modelNumber}`);
    }

    const item = candidates[0];
    const itemId = text(item.id);
    const savedAt = new Date().toISOString();
    const mutation = applyProductLaunchTrackerMutation(state, {
      operation: "patch_item",
      itemId,
      patch: purchaseMetadataPatch(
        item,
        supplierLink,
        input.source,
        savedAt,
        input.draftId,
      ),
      updatedBy:
        input.source === "CHINA_ORDER_DRAFT"
          ? "중국 발주초안 링크 역저장"
          : "상품출시 구매정보 저장",
    });

    const written = await conditionalWriteProductLaunchState(
      configResult.value,
      input.identity,
      mutation.state,
      expectedUpdatedAt,
      mutation.changedIds,
    );
    if (!written) continue;

    const nextIndex = buildProductLaunchTrackerIndex(mutation.state);
    const nextItem = nextIndex.itemsById.get(itemId) ?? item;
    const productMaster = await syncSingleItemToProductMaster(nextItem);
    return {
      itemId,
      modelNumber,
      supplierLink,
      savedAt,
      source: input.source,
      productMaster,
    } satisfies ProductLaunchSupplierLinkWriteResult;
  }

  throw new Error("PRODUCT_LAUNCH_CONCURRENT_UPDATE");
}

export async function syncProductLaunchItemPurchaseMetadataToProductMaster(input: {
  identity: ProductLaunchIdentity;
  itemId: unknown;
}) {
  const itemId = text(input.itemId);
  if (!itemId) throw new Error("PRODUCT_LAUNCH_ITEM_ID_REQUIRED");
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error(configResult.body.code || "PRODUCT_LAUNCH_ADMIN_NOT_CONFIGURED");
  }
  const stored = await readProductLaunchState(
    configResult.value,
    input.identity.userId,
  );
  const state =
    stored?.state_payload && typeof stored.state_payload === "object"
      ? (stored.state_payload as ProductLaunchTrackerState)
      : null;
  if (!state) throw new Error("PRODUCT_LAUNCH_STATE_REQUIRED");
  const index = buildProductLaunchTrackerIndex(state);
  const item = index.itemsById.get(itemId);
  if (!item) throw new Error("PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND");
  return {
    itemId,
    modelNumber: normalizeModelNumber(item.modelNumber),
    productMaster: await syncSingleItemToProductMaster(item),
  };
}

export function purchaseMetadataAuditFromItem(item: unknown) {
  return object(object(item).purchaseMetadataLastWrite);
}

export { PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD };
