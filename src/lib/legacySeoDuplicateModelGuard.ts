import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

export type LegacySeoDuplicateActiveModel = {
  modelNumber: string;
  itemIds: string[];
  productNames: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function findDuplicateActiveLegacySeoModels(
  rows: unknown[],
  requestedModels: string[],
) {
  const requested = new Set(requestedModels.map(modelKey).filter(Boolean));
  const byModel = new Map<
    string,
    { itemIds: Set<string>; productNames: Set<string> }
  >();

  for (const value of rows) {
    const row = record(value);
    const modelNumber = modelKey(row.model_number);
    if (!requested.has(modelNumber)) continue;
    const itemId = text(row.item_id);
    if (!itemId) continue;
    const current = byModel.get(modelNumber) ?? {
      itemIds: new Set<string>(),
      productNames: new Set<string>(),
    };
    current.itemIds.add(itemId);
    const productName = text(row.product_name);
    if (productName) current.productNames.add(productName);
    byModel.set(modelNumber, current);
  }

  const duplicates = new Map<string, LegacySeoDuplicateActiveModel>();
  for (const [modelNumber, value] of byModel) {
    if (value.itemIds.size < 2) continue;
    duplicates.set(modelNumber, {
      modelNumber,
      itemIds: [...value.itemIds],
      productNames: [...value.productNames],
    });
  }
  return duplicates;
}

export async function readDuplicateActiveLegacySeoModels(input: {
  config: ProductLaunchAdminConfig;
  ownerId: string;
  requestedModels: string[];
}) {
  const requestedModels = [...new Set(input.requestedModels.map(modelKey).filter(Boolean))];
  if (!requestedModels.length) {
    return new Map<string, LegacySeoDuplicateActiveModel>();
  }

  const params = new URLSearchParams({
    select: "item_id,model_number,product_name",
    owner_id: `eq.${input.ownerId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    order: "model_number.asc,item_id.asc",
    limit: "5000",
  });
  const { body } = await readProductLaunchStorageJson(
    `${input.config.supabaseUrl}/rest/v1/product_launch_items?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  return findDuplicateActiveLegacySeoModels(
    Array.isArray(body) ? body : [],
    requestedModels,
  );
}
