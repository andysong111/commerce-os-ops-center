import {
  readProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  readProductLaunchNormalizedItems,
  syncProductLaunchNormalizedChangedItems,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type StoredRow = { state_payload?: unknown; updated_at?: unknown };
type UnknownRecord = Record<string, unknown>;

const SHOPLING_OPTION_SYNC_SOURCES = new Set([
  "shopling_live_grouped_option_sync",
  "shopling_live_grouped_option_sync_atomic",
]);

export async function reconcileProductLaunchNormalizedAfterLegacyItems(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  itemIds: string[],
) {
  const changedIds = [...new Set(itemIds.map(text).filter(Boolean))];
  if (!changedIds.length) return { synced: false, reason: "no_changed_items" as const };

  const row = (await readProductLaunchState(
    config,
    identity.userId,
  )) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) {
    return { synced: false, reason: "state_not_found" as const };
  }

  const state = row.state_payload as ProductLaunchTrackerState;
  const guarded = await preserveNormalizedShoplingOptionsForImageRepair(
    config,
    identity,
    state,
    changedIds,
  );
  const result = await syncProductLaunchNormalizedChangedItems(
    config,
    identity,
    guarded.state,
    row.updated_at,
    changedIds,
  );
  if (result.synced === false) {
    const full = await syncProductLaunchNormalizedFull(
      config,
      identity,
      guarded.state,
      row.updated_at,
    );
    return {
      mode: "full" as const,
      preservedShoplingOptionItems: guarded.preservedCount,
      ...full,
    };
  }

  return {
    mode: "changed" as const,
    preservedShoplingOptionItems: guarded.preservedCount,
    ...result,
  };
}

async function preserveNormalizedShoplingOptionsForImageRepair(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  state: ProductLaunchTrackerState,
  changedIds: string[],
) {
  const normalizedItems = await readProductLaunchNormalizedItems(
    config,
    identity.userId,
    changedIds,
  );
  const normalizedById = new Map<string, UnknownRecord>();
  for (const raw of normalizedItems) {
    const item = record(raw);
    const id = text(item.id);
    if (id) normalizedById.set(id, item);
  }

  const stateRecord = state as unknown as UnknownRecord;
  const stateItems = Array.isArray(stateRecord.items) ? stateRecord.items : [];
  const changed = new Set(changedIds);
  let preservedCount = 0;

  const nextItems = stateItems.map((raw) => {
    const item = record(raw);
    const id = text(item.id);
    if (!id || !changed.has(id)) return raw;

    // Image repair is intentionally image-only. It starts from the legacy state,
    // which can lag behind the normalized option ledger. Never let that stale
    // snapshot erase a later Shopling option/B-code sync.
    if (text(item.updatedBy) !== "legacy Shopling image repair") return raw;

    const normalized = normalizedById.get(id);
    if (!normalized) return raw;
    const normalizedSync = record(normalized.shoplingOptionSync);
    if (!SHOPLING_OPTION_SYNC_SOURCES.has(text(normalizedSync.source))) return raw;
    const normalizedOptions = Array.isArray(normalized.orderOptions)
      ? normalized.orderOptions.map(record)
      : [];
    if (!normalizedOptions.length) return raw;

    const currentSync = record(item.shoplingOptionSync);
    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map(record)
      : [];
    if (
      SHOPLING_OPTION_SYNC_SOURCES.has(text(currentSync.source)) &&
      currentOptions.length > 0
    ) {
      return raw;
    }

    const labels = normalizedOptions
      .map((option) => text(option.saleOption ?? option.value))
      .filter(Boolean);
    preservedCount += 1;
    return {
      ...item,
      orderOptions: normalizedOptions,
      optionLabels: labels,
      options: labels,
      shoplingOptionSync: normalizedSync,
    };
  });

  if (!preservedCount) return { state, preservedCount };
  return {
    state: {
      ...(state as unknown as UnknownRecord),
      items: nextItems,
    } as ProductLaunchTrackerState,
    preservedCount,
  };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
