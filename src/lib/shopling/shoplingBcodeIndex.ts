import { createHash, randomUUID } from "node:crypto";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildShoplingBcodeIndexRows,
  normalizeShoplingBcode,
  type ShoplingBcodeIndexRow,
} from "@/lib/shopling/shoplingBcodeIndexCore";

export {
  buildShoplingBcodeIndexRows,
  normalizeShoplingBcode,
  type ShoplingBcodeIndexRow,
} from "@/lib/shopling/shoplingBcodeIndexCore";

type RawRow = Record<string, unknown>;

const B_CODE = /^B[A-Z]{2}\d+-\d+$/;
const GOODS_KEY = /^\d+$/;
const UPSERT_BATCH_SIZE = 300;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function shoplingAccountFingerprint(
  config: Pick<ShoplingReadConfig, "companyId" | "loginId">,
) {
  return createHash("sha256")
    .update(`${config.companyId}\u0000${config.loginId}`)
    .digest("hex");
}

function batches<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function loadIndexedShoplingGoodsKeys(
  barcode: string,
  env: Record<string, string | undefined> = process.env,
) {
  const normalized = normalizeShoplingBcode(barcode);
  if (!B_CODE.test(normalized)) throw new Error("SHOPLING_BCODE_INDEX_BARCODE_INVALID");
  const config = shoplingReadConfigFromEnv(env);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SHOPLING_BCODE_INDEX_DATABASE_NOT_CONFIGURED");
  const result = await admin
    .from("shopling_bcode_option_index")
    .select("goods_key,option_id,last_seen_at")
    .eq("account_fingerprint", shoplingAccountFingerprint(config))
    .eq("barcode", normalized)
    .order("goods_key", { ascending: true });
  if (result.error) {
    throw new Error(`SHOPLING_BCODE_INDEX_READ_FAILED:${result.error.message}`);
  }
  const rows = Array.isArray(result.data) ? (result.data as RawRow[]) : [];
  return [...new Set(rows.map((row) => text(row.goods_key)).filter((key) => GOODS_KEY.test(key)))];
}

export async function upsertShoplingBcodeIndexEvidence(
  rows: ShoplingBcodeIndexRow[],
) {
  if (!rows.length) return 0;
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SHOPLING_BCODE_INDEX_DATABASE_NOT_CONFIGURED");
  let written = 0;
  for (const batch of batches(rows, UPSERT_BATCH_SIZE)) {
    const result = await admin.from("shopling_bcode_option_index").upsert(batch, {
      onConflict: "account_fingerprint,barcode,goods_key,option_id",
    });
    if (result.error) {
      throw new Error(`SHOPLING_BCODE_INDEX_WRITE_FAILED:${result.error.message}`);
    }
    written += batch.length;
  }
  return written;
}

export async function refreshShoplingBcodeIndex(input: {
  env?: Record<string, string | undefined>;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("SHOPLING_BCODE_INDEX_NOW_INVALID");
  const config = shoplingReadConfigFromEnv(env);
  const observedAt = now.toISOString();
  const refreshId = randomUUID();
  const start = text(env.SHOPLING_BCODE_CATALOG_START_DATE) || "2010-01-01";
  const end = observedAt.slice(0, 10);
  const ranges = splitShoplingDateRange(start, end, 90);
  const catalogRows = await new ShoplingReadClient(config).readRanges(
    "products",
    ranges,
    { productSearchType: "등록일" },
  );
  const rows = buildShoplingBcodeIndexRows(
    catalogRows as RawRow[],
    shoplingAccountFingerprint(config),
    { refreshId, observedAt },
  );
  const written = await upsertShoplingBcodeIndexEvidence(rows);
  return {
    refreshId,
    observedAt,
    rangeCount: ranges.length,
    sourceRowCount: catalogRows.length,
    indexedRowCount: rows.length,
    indexedBcodeCount: new Set(rows.map((row) => row.barcode)).size,
    written,
    externalWrite: false as const,
  };
}
