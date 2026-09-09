import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  loadLegacySeoShoplingEvidence,
  type LegacySeoShoplingEvidence,
  type LegacySeoShoplingOptionGroup,
} from "@/lib/legacySeoShoplingEvidence";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

export type LegacySeoShoplingAssetIssue = {
  itemId: string;
  modelNumber: string;
  reason: string;
};

const ITEM_TABLE = "product_launch_items";
const MAX_ITEMS = 100;
const PATCH_CONCURRENCY = 10;
const RECENT_NO_OPTION_PROOF_MS = 5 * 60 * 1000;

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

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function uniqueUrls(values: unknown[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = text(value);
    if (!/^https?:\/\//i.test(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function activeManagedOptionCount(group: LegacySeoShoplingOptionGroup) {
  return group.options.filter(
    (option) =>
      text(option.status).toUpperCase() !== "X" && Boolean(text(option.bCode)),
  ).length;
}

function syncedGoodsKey(item: UnknownRecord) {
  const itemSync = record(item.shoplingOptionSync);
  const direct = text(itemSync.goodsKey);
  if (direct) return direct;
  for (const optionValue of array(item.orderOptions)) {
    const option = record(optionValue);
    const key = text(record(option.shoplingOptionSync).goodsKey);
    if (key) return key;
  }
  return "";
}

function recentlyConfirmedNoManagedOptions(item: UnknownRecord) {
  const sync = record(item.shoplingOptionSync);
  if (
    text(sync.source) !== "shopling_live_grouped_option_sync" ||
    text(sync.status) !== "existing_preserved" ||
    Number(sync.optionCount) !== 0 ||
    Number(sync.bCodeCount) !== 0
  ) {
    return false;
  }
  const syncedAt = Date.parse(text(sync.syncedAt));
  return (
    Number.isFinite(syncedAt) &&
    syncedAt <= Date.now() &&
    Date.now() - syncedAt <= RECENT_NO_OPTION_PROOF_MS
  );
}

export function chooseLegacySeoShoplingAssetGroup(
  item: UnknownRecord,
  evidence: LegacySeoShoplingEvidence | undefined,
) {
  if (!evidence?.optionGroups.length) return null;
  const preferredGoodsKey = syncedGoodsKey(item);
  if (preferredGoodsKey) {
    const exact = evidence.optionGroups.find(
      (group) => text(group.goodsKey) === preferredGoodsKey,
    );
    if (exact && (text(exact.detailHtml) || exact.imageUrls.length)) return exact;
  }

  const candidates = evidence.optionGroups.filter(
    (group) => text(group.detailHtml) || group.imageUrls.length,
  );
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => {
    const leftActive = activeManagedOptionCount(left);
    const rightActive = activeManagedOptionCount(right);
    if (rightActive !== leftActive) return rightActive - leftActive;
    const leftAssetScore = (text(left.detailHtml) ? 10 : 0) + left.imageUrls.length;
    const rightAssetScore = (text(right.detailHtml) ? 10 : 0) + right.imageUrls.length;
    if (rightAssetScore !== leftAssetScore) return rightAssetScore - leftAssetScore;
    const leftKey = Number(left.goodsKey) || 0;
    const rightKey = Number(right.goodsKey) || 0;
    return rightKey - leftKey;
  })[0] ?? null;
}

function recoveredDetailAsset(
  item: UnknownRecord,
  group: LegacySeoShoplingOptionGroup,
) {
  const current = record(item.detailPageAsset);
  const currentImages = uniqueUrls(array(current.additionalImageUrls));
  const shoplingImages = uniqueUrls(group.imageUrls);
  const currentMain = text(current.mainImageUrl);
  const mainImageUrl = currentMain || shoplingImages[0] || "";
  const additionalImageUrls = currentImages.length
    ? currentImages
    : shoplingImages.filter((url) => url !== mainImageUrl).slice(0, 4);
  const html = text(current.html) || text(group.detailHtml);
  const changed =
    html !== text(current.html) ||
    mainImageUrl !== currentMain ||
    additionalImageUrls.join("\n") !== currentImages.join("\n");
  return {
    changed,
    asset: {
      ...current,
      html,
      mainImageUrl,
      additionalImageUrls,
      shoplingLegacyRecovery: {
        source: "shopling_live_api",
        goodsKey: group.goodsKey,
        ptnGoodsCd: group.ptnGoodsCd,
        productName: group.productName,
        recoveredAt: new Date().toISOString(),
      },
    },
  };
}

async function readRawItemPayload(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  itemId: string,
) {
  const params = new URLSearchParams({
    select: "item_payload",
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const row = Array.isArray(body) ? record(body[0]) : {};
  return record(row.item_payload);
}

async function patchItemAsset(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  item: UnknownRecord,
  group: LegacySeoShoplingOptionGroup,
) {
  const recovered = recoveredDetailAsset(item, group);
  if (!recovered.changed) return false;
  const itemId = text(item.id);
  const rawPayload = await readRawItemPayload(config, ownerId, itemId);
  if (!Object.keys(rawPayload).length) {
    throw new Error(`LEGACY_SEO_RAW_ITEM_PAYLOAD_MISSING:${itemId}`);
  }
  const rawCurrentAsset = record(rawPayload.detailPageAsset);
  const rawRecovery = recoveredDetailAsset(
    { ...item, detailPageAsset: rawCurrentAsset },
    group,
  );
  if (!rawRecovery.changed) return false;
  const now = new Date().toISOString();
  const payload = {
    ...rawPayload,
    detailPageAsset: rawRecovery.asset,
    updatedAt: now,
    updatedBy: "이전상품 Shopling 상세/이미지 복구",
  };
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${itemId}`,
  });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item_payload: payload,
        updated_at: now,
        updated_by: "이전상품 Shopling 상세/이미지 복구",
      }),
      cache: "no-store",
    },
  );
  return true;
}

async function runInChunks(tasks: Array<() => Promise<boolean>>) {
  let changedCount = 0;
  for (let index = 0; index < tasks.length; index += PATCH_CONCURRENCY) {
    const values = await Promise.all(
      tasks.slice(index, index + PATCH_CONCURRENCY).map((task) => task()),
    );
    changedCount += values.filter(Boolean).length;
  }
  return changedCount;
}

export async function recoverLegacySeoShoplingAssets(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  items: UnknownRecord[];
}) {
  // Option synchronization runs immediately before this stage. When that fresh,
  // corrected live discovery has just proved there are no managed Shopling
  // options/B-codes, preflight will exclude the item. Repeating the same years-long
  // Shopling discovery solely for assets is redundant and was the dominant source
  // of near-300s recovery calls.
  const items = input.items
    .slice(0, MAX_ITEMS)
    .filter((item) => !recentlyConfirmedNoManagedOptions(item));
  const models = [...new Set(items.map((item) => modelKey(item.modelNumber)).filter(Boolean))];
  const evidenceByModel = models.length
    ? await loadLegacySeoShoplingEvidence(models)
    : new Map<string, LegacySeoShoplingEvidence>();
  const tasks: Array<() => Promise<boolean>> = [];
  const unresolved: LegacySeoShoplingAssetIssue[] = [];

  for (const item of items) {
    const itemId = text(item.id);
    const modelNumber = modelKey(item.modelNumber);
    const current = record(item.detailPageAsset);
    const alreadyReady =
      Boolean(text(current.html)) &&
      Boolean(text(current.mainImageUrl)) &&
      uniqueUrls(array(current.additionalImageUrls)).length > 0;
    if (alreadyReady) continue;
    const group = chooseLegacySeoShoplingAssetGroup(
      item,
      evidenceByModel.get(modelNumber),
    );
    if (!group) {
      unresolved.push({
        itemId,
        modelNumber,
        reason: "현재 Shopling 상세/이미지 근거를 찾지 못했습니다.",
      });
      continue;
    }
    const preview = recoveredDetailAsset(item, group);
    const next = preview.asset as UnknownRecord;
    const missing = [
      !text(next.html) ? "상세HTML" : "",
      !text(next.mainImageUrl) ? "대표이미지" : "",
      uniqueUrls(array(next.additionalImageUrls)).length === 0 ? "부가이미지" : "",
    ].filter(Boolean);
    if (missing.length) {
      unresolved.push({
        itemId,
        modelNumber,
        reason: `Shopling에도 ${missing.join("/")}가 없습니다.`,
      });
    }
    if (preview.changed) {
      tasks.push(() => patchItemAsset(input.config, input.identity.userId, item, group));
    }
  }

  const changedCount = await runInChunks(tasks);
  return {
    requestedCount: items.length,
    changedCount,
    unresolvedCount: unresolved.length,
    unresolved,
  };
}
