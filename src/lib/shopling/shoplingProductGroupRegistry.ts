import {
  groupKeyForLabel,
  normalizeInternalPriceGroup,
  searchPrefixForLabel,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export type ShoplingProductGroupRegistryRow = {
  owner_id: string;
  goods_key: string;
  product_group_key: string;
  product_group_label: string;
  ptn_goods_cd: string;
  code_format: string;
  updated_at: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function getRows(query: URLSearchParams) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/rest/v1/shopling_product_group_registry?${query.toString()}`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `SHOPLING_PRODUCT_GROUP_REGISTRY_READ_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : []) as ShoplingProductGroupRegistryRow[];
}

export async function loadShoplingProductGroupsByGoodsKey(
  goodsKeys: Iterable<string>,
): Promise<Map<string, InternalPriceGroup>> {
  const unique = [...new Set([...goodsKeys].map(text).filter((key) => /^\d{5,9}$/.test(key)))];
  const result = new Map<string, InternalPriceGroup>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    if (!chunk.length) continue;
    const rows = await getRows(
      new URLSearchParams({
        select: "owner_id,goods_key,product_group_key,product_group_label,ptn_goods_cd,code_format,updated_at",
        goods_key: `in.(${chunk.join(",")})`,
      }),
    );
    for (const row of rows) {
      const group = normalizeInternalPriceGroup(row.product_group_label);
      if (group) result.set(text(row.goods_key), group);
    }
  }
  return result;
}

export function resolveInternalPriceGroup(input: {
  goodsKey: unknown;
  listingProductGroup?: unknown;
  registry: ReadonlyMap<string, InternalPriceGroup>;
}) {
  const goodsKey = text(input.goodsKey);
  const registered = input.registry.get(goodsKey) ?? null;
  if (registered) {
    return {
      group: registered,
      source: "OPS_REGISTRY" as const,
    };
  }
  const listing = normalizeInternalPriceGroup(input.listingProductGroup);
  if (listing) {
    return {
      group: listing,
      source: "EXACT_LISTING_GROUP" as const,
    };
  }
  return {
    group: null,
    source: "UNRESOLVED" as const,
  };
}


async function postRows(query: URLSearchParams, body: unknown) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/rest/v1/shopling_product_group_registry?${query.toString()}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        "content-type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `SHOPLING_PRODUCT_GROUP_REGISTRY_WRITE_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : []) as ShoplingProductGroupRegistryRow[];
}

async function resolveSingleRegistryOwnerId() {
  const rows = await getRows(new URLSearchParams({ select: "owner_id", limit: "5000" }));
  const owners = [...new Set(rows.map((row) => text(row.owner_id)).filter(Boolean))];
  if (owners.length !== 1) throw new Error(`SHOPLING_PRODUCT_GROUP_OWNER_AMBIGUOUS:${owners.length}`);
  return owners[0];
}

export async function rememberRecoveredShoplingProductGroup(input: {
  goodsKey: unknown;
  group: unknown;
  partnerCode?: unknown;
  source?: unknown;
}) {
  const goodsKey = text(input.goodsKey);
  const group = normalizeInternalPriceGroup(input.group);
  if (!/^\d{5,9}$/.test(goodsKey) || !group) throw new Error("SHOPLING_PRODUCT_GROUP_RECOVERY_INVALID");
  const before = await loadShoplingProductGroupsByGoodsKey([goodsKey]);
  const existing = before.get(goodsKey);
  if (existing) {
    if (existing !== group) throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
    return { inserted: false, group: existing };
  }
  const ownerId = await resolveSingleRegistryOwnerId();
  const partnerCode = text(input.partnerCode);
  const searchPrefix = searchPrefixForLabel(group);
  const source = text(input.source).replace(/[^A-Z0-9_]/gi, "_").slice(0, 80) || "UNKNOWN";
  const rows = await postRows(
    new URLSearchParams({ on_conflict: "owner_id,goods_key" }),
    [{
      owner_id: ownerId,
      goods_key: goodsKey,
      launch_item_id: "",
      model_number: "",
      product_group_key: groupKeyForLabel(group),
      product_group_label: group,
      ptn_goods_cd: partnerCode,
      search_prefix: searchPrefix,
      code_format: partnerCode.toUpperCase().startsWith(searchPrefix) ? "group_prefix" : "legacy_suffix",
      shopling_status: `MONTHLY_PRICE_AUTO_RECOVERED_${source}`,
      registered_at: null,
      updated_at: new Date().toISOString(),
    }],
  );
  if (rows.length) return { inserted: true, group };
  const after = await loadShoplingProductGroupsByGoodsKey([goodsKey]);
  const concurrent = after.get(goodsKey);
  if (concurrent !== group) throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
  return { inserted: false, group };
}
