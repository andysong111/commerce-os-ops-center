import { prepareLegacySeoPreflight } from "@/lib/legacySeoPreflight";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

type RecoveryIssue = {
  modelNumber: string;
  saleOption: string;
  reason: string;
};

const ITEM_TABLE = "product_launch_items";
const MAX_MODELS = 100;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

/**
 * Compatibility entry point kept for the legacy registration route.
 *
 * Historical behavior read Shopling's current sale_price + optAmt and treated it
 * as the source of truth. That is no longer allowed. The user's final-confirmed
 * China-order workbook is the only authority for both landed unit cost and base
 * sale price; Shopling is used only to recover current option/B-code parity.
 */
export async function recoverLegacySeoShoplingPrices(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  modelNumbers: string[];
}) {
  const requested = unique(input.modelNumbers.map(normalizeModel)).slice(0, MAX_MODELS);
  if (!requested.length) {
    return {
      source: "china_order_final_confirmed_v4",
      requestedCount: 0,
      itemCount: 0,
      candidateCount: 0,
      recoveredCount: 0,
      unresolvedCount: 0,
      unresolved: [] as RecoveryIssue[],
    };
  }

  const params = new URLSearchParams({
    select: "item_id,model_number",
    owner_id: `eq.${input.identity.userId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    model_number: `in.(${postgrestIn(requested)})`,
    limit: "500",
  });
  const { body } = await readProductLaunchStorageJson(
    `${input.config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  const itemRows = (Array.isArray(body) ? body : []).map(record);
  const itemIds = itemRows.map((row) => text(row.item_id)).filter(Boolean);
  if (!itemIds.length) {
    return {
      source: "china_order_final_confirmed_v4",
      requestedCount: requested.length,
      itemCount: 0,
      candidateCount: 0,
      recoveredCount: 0,
      unresolvedCount: 0,
      unresolved: [] as RecoveryIssue[],
    };
  }

  const preflight = await prepareLegacySeoPreflight({
    config: input.config,
    identity: input.identity,
    itemIds,
  });
  const blocked = preflight.results.filter((result) => !result.ready);
  const unresolved: RecoveryIssue[] = blocked.flatMap((result) =>
    result.issues.map((issue) => ({
      modelNumber: result.modelNumber,
      saleOption: "",
      reason: issue.message,
    })),
  );
  if (blocked.length) {
    const summary = blocked
      .slice(0, 20)
      .map((result) =>
        `${result.modelNumber || result.itemId}:${result.issues[0]?.message || "사전점검 미통과"}`,
      )
      .join(", ");
    throw new Error(
      `중국주문 최종확정 가격/등록 사전점검 미통과 ${blocked.length}개${summary ? ` · ${summary}` : ""}`,
    );
  }

  return {
    source: "china_order_final_confirmed_v4",
    requestedCount: requested.length,
    itemCount: itemIds.length,
    candidateCount: preflight.canonicalPrice?.results.reduce(
      (sum, result) => sum + result.optionCount,
      0,
    ) ?? 0,
    recoveredCount: preflight.canonicalPrice?.appliedOptionCount ?? 0,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100),
    preflight: {
      readyCount: preflight.readyCount,
      excludedCount: preflight.excludedCount,
      failedCount: preflight.failedCount,
      issueCount: preflight.issueCount,
    },
  };
}
