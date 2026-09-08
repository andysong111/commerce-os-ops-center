import type { InventoryStockoutResetEvent } from "@/lib/inventoryStockControl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE =
  "SHOPLING_STOCK_CANARY_PREPARATION";
const READ_LIMIT = 2_000;

type PreparedIdentity = {
  barcode: string;
  modelNo: string | null;
  goodsKey: string | null;
  optionId: string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedBarcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function truthy(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function numeric(value: unknown) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? normalized : null;
}

function confirmedPreparationEvidence(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  return Boolean(
    truthy(input.preparationOnly) &&
      text(output.state).toUpperCase() === "A6_UNIQUENESS_CONFIRMED" &&
      Number(output.a6SearchResultCount) === 1 &&
      text(output.externalBarcodeCollisionCheck).toUpperCase() ===
        "EXACT_ONE_ROW_CONFIRMED",
  );
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    let previousDiagonal = rows[0];
    rows[0] = rightIndex;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const previousRowValue = rows[leftIndex];
      rows[leftIndex] = Math.min(
        rows[leftIndex] + 1,
        rows[leftIndex - 1] + 1,
        previousDiagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      previousDiagonal = previousRowValue;
    }
  }
  return rows[left.length];
}

function optionSuffix(value: string) {
  return value.match(/-(\d+)$/)?.[1] ?? "";
}

async function loadPreparedIdentities() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return [] as PreparedIdentity[];
  const response = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,result_snapshot,started_at")
    .eq("operation_type", SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE)
    .order("started_at", { ascending: false })
    .limit(READ_LIMIT);
  if (response.error) return [] as PreparedIdentity[];

  const byBarcode = new Map<string, PreparedIdentity>();
  for (const row of Array.isArray(response.data) ? response.data : []) {
    const input = object((row as Record<string, unknown>).input_snapshot);
    const resultRoot = object((row as Record<string, unknown>).result_snapshot);
    const nested = object(resultRoot.snapshot);
    const output = Object.keys(nested).length ? nested : resultRoot;
    if (!confirmedPreparationEvidence(input, output)) continue;
    const barcode = normalizedBarcode(input.barcode || output.barcode);
    if (!barcode || byBarcode.has(barcode)) continue;
    byBarcode.set(barcode, {
      barcode,
      modelNo: text(input.modelNo || output.a6MatchedModelNo) || null,
      goodsKey: numeric(
        input.shoplingProductId ||
          input.goodsKey ||
          output.a6MatchedShoplingProductId ||
          output.shoplingProductId ||
          output.goodsKey,
      ),
      optionId: numeric(
        input.shoplingOptionId || output.a6MatchedShoplingOptionId,
      ),
    });
  }
  return [...byBarcode.values()];
}

export async function validateInventoryStockoutResetIdentity(
  event: InventoryStockoutResetEvent,
): Promise<InventoryStockoutResetEvent> {
  if (event.productKind !== "OPTION") return event;

  const prepared = await loadPreparedIdentities();
  if (!prepared.length) return event;

  const exact = prepared.find((row) => row.barcode === event.barcode) ?? null;
  if (exact) {
    if (event.modelNo && exact.modelNo && event.modelNo !== exact.modelNo) {
      throw new Error(
        `STOCKOUT_RESET_MODEL_MISMATCH:${event.barcode}:${event.modelNo}->${exact.modelNo}`,
      );
    }
    return {
      ...event,
      modelNo: event.modelNo || exact.modelNo,
    };
  }

  const suffix = optionSuffix(event.barcode);
  const closeCandidates = prepared.filter(
    (row) =>
      (!suffix || optionSuffix(row.barcode) === suffix) &&
      editDistance(event.barcode, row.barcode) === 1,
  );
  if (closeCandidates.length === 1) {
    const candidate = closeCandidates[0];
    throw new Error(
      `STOCKOUT_RESET_BARCODE_POSSIBLE_TYPO:${event.barcode}->${candidate.barcode}`,
    );
  }

  return event;
}
