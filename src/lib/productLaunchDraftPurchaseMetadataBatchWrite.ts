import {
  applyProductLaunchTrackerMutation,
  buildProductLaunchTrackerIndex,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import { buildPurchaseChinaLinkPatch } from "@/lib/productLaunchPurchaseMetadataCore";
import { conditionalWriteProductLaunchState } from "@/lib/productLaunchPurchaseMetadataWrite";

type R = Record<string, unknown>;

export type DraftPurchaseMetadataLine = {
  barcode: string;
  modelNo: string;
  supplierLink: string;
  chinaOption: string;
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

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
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

function normalizeLines(value: unknown): DraftPurchaseMetadataLine[] {
  if (!Array.isArray(value)) return [];
  const rows = value
    .filter((entry): entry is R => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    .map((entry) => ({
      barcode: normalizeBarcode(entry.barcode),
      modelNo: normalizeModelNumber(entry.modelNo),
      supplierLink: normalizeSupplierLink(entry.supplierLink),
      chinaOption: text(entry.chinaOption).slice(0, 240),
    }))
    .filter((row) => row.barcode && row.modelNo);
  const byBarcode = new Map<string, DraftPurchaseMetadataLine>();
  for (const row of rows) byBarcode.set(row.barcode, row);
  return [...byBarcode.values()];
}

export async function syncDraftPurchaseMetadataToProductLaunch(input: {
  identity: ProductLaunchIdentity;
  draftId: string;
  lines: unknown;
}) {
  const lines = normalizeLines(input.lines);
  if (!lines.length) {
    throw new Error("PRODUCT_LAUNCH_PURCHASE_METADATA_LINES_REQUIRED");
  }
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error(configResult.body.code || "PRODUCT_LAUNCH_ADMIN_NOT_CONFIGURED");
  }

  const grouped = new Map<string, DraftPurchaseMetadataLine[]>();
  for (const line of lines) {
    grouped.set(line.modelNo, [...(grouped.get(line.modelNo) ?? []), line]);
  }
  for (const [modelNo, rows] of grouped) {
    const links = [...new Set(rows.map((row) => row.supplierLink).filter(Boolean))];
    if (links.length > 1) {
      throw new Error(`PRODUCT_LAUNCH_MODEL_LINK_CONFLICT:${modelNo}`);
    }
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

    let nextState = state;
    const changedIds: string[] = [];
    const warnings: string[] = [];
    let syncedBcodes = 0;
    let syncedLinks = 0;
    let syncedChinaOptions = 0;

    for (const [modelNo, rows] of grouped) {
      const index = buildProductLaunchTrackerIndex(nextState);
      const matches = index.items.filter(
        (item) => normalizeModelNumber(item.modelNumber) === modelNo,
      );
      const activeMatches = matches.filter((item) => !text(item.archivedAt));
      const candidates = activeMatches.length ? activeMatches : matches;
      if (!candidates.length) {
        warnings.push(`${modelNo}: 상품출시진행관리 모델 없음`);
        continue;
      }
      if (candidates.length > 1) {
        throw new Error(`PRODUCT_LAUNCH_MODEL_CONFLICT:${modelNo}`);
      }

      const item = candidates[0];
      const itemId = text(item.id);
      const byBarcode = new Map(rows.map((row) => [row.barcode, row] as const));
      const currentOptions = Array.isArray(item.orderOptions)
        ? item.orderOptions.map((entry) => object(entry))
        : [];
      const orderOptions = currentOptions.map((option) => {
        const barcode = normalizeBarcode(option.barcode);
        const incoming = byBarcode.get(barcode);
        if (!incoming) return option;
        syncedBcodes += 1;
        if (incoming.chinaOption !== text(option.chinaOption)) {
          syncedChinaOptions += 1;
        }
        return { ...option, chinaOption: incoming.chinaOption };
      });

      const modelLink = [...new Set(rows.map((row) => row.supplierLink).filter(Boolean))][0] ?? "";
      const patch: R = { orderOptions };
      if (modelLink) {
        Object.assign(patch, buildPurchaseChinaLinkPatch(item, modelLink));
        syncedLinks += 1;
      }
      const savedAt = new Date().toISOString();
      patch.purchaseMetadataLastWrite = {
        field: "MODEL_LINK_AND_BCODE_CHINA_OPTION",
        source: "CHINA_ORDER_DRAFT",
        draftId: input.draftId,
        savedAt,
        savedBy: "승준",
        modelNo,
        barcodes: rows.map((row) => row.barcode),
      };

      const mutation = applyProductLaunchTrackerMutation(nextState, {
        operation: "patch_item",
        itemId,
        patch,
        updatedBy: "중국 발주초안 구매정보 역저장",
      });
      nextState = mutation.state;
      changedIds.push(itemId);
    }

    if (!changedIds.length) {
      return {
        savedAt: new Date().toISOString(),
        syncedModels: 0,
        syncedBcodes: 0,
        syncedLinks: 0,
        syncedChinaOptions: 0,
        warnings,
        productMaster: {
          ok: false,
          error: "동기화할 상품출시 모델을 찾지 못했습니다.",
        },
      };
    }

    const written = await conditionalWriteProductLaunchState(
      configResult.value,
      input.identity,
      nextState,
      expectedUpdatedAt,
      changedIds,
    );
    if (!written) continue;

    const nextIndex = buildProductLaunchTrackerIndex(nextState);
    const affectedItems = changedIds
      .map((itemId) => nextIndex.itemsById.get(itemId))
      .filter((item): item is R => Boolean(item));
    let productMaster: { ok: boolean; error?: string; counts?: Record<string, number> };
    try {
      const result = await pushCanonicalProductMasterSnapshotFromTrackerState({
        schemaVersion: 3,
        savedAt: new Date().toISOString(),
        items: affectedItems,
      });
      productMaster = { ok: true, counts: result.counts };
    } catch (error) {
      productMaster = {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "PRODUCT_MASTER_PURCHASE_METADATA_SYNC_FAILED",
      };
    }

    return {
      savedAt: new Date().toISOString(),
      syncedModels: changedIds.length,
      syncedBcodes,
      syncedLinks,
      syncedChinaOptions,
      warnings,
      productMaster,
    };
  }

  throw new Error("PRODUCT_LAUNCH_CONCURRENT_UPDATE");
}
