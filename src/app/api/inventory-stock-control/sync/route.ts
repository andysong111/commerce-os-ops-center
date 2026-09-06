import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeShoplingStockSyncInput,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { normalizeRetryableShoplingSyncReport } from "@/lib/inventoryStockSyncResolution";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE =
  "SHOPLING_STOCK_CANARY_PREPARATION";

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "SHOPLING_STOCK_SYNC_UNAUTHORIZED",
      message: "Shopling 재고상태 동기화 기록 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

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

function numericGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function truthy(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
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

async function loadPreparedGoodsKeysByBarcode() {
  const result = new Map<string, Set<string>>();
  const admin = await createSupabaseAdminClient();
  if (!admin) return result;
  const response = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE)
    .order("started_at", { ascending: true })
    .limit(2_000);
  if (response.error) return result;

  const preparedRows = Array.isArray(response.data)
    ? (response.data as Array<Record<string, unknown>>)
    : [];
  for (const row of preparedRows) {
    const input = object(row.input_snapshot);
    const outputRoot = object(row.result_snapshot);
    const nestedOutput = object(outputRoot.snapshot);
    const output = Object.keys(nestedOutput).length ? nestedOutput : outputRoot;
    if (!confirmedPreparationEvidence(input, output)) continue;

    const barcode = normalizedBarcode(input.barcode || output.barcode);
    if (!barcode) continue;
    const candidates = [
      input.goodsKey,
      input.shoplingGoodsKey,
      input.shoplingProductId,
      output.goodsKey,
      output.shoplingGoodsKey,
      output.shoplingProductId,
      output.a6MatchedShoplingProductId,
    ]
      .map(numericGoodsKey)
      .filter(Boolean);
    if (!candidates.length) continue;
    const values = result.get(barcode) ?? new Set<string>();
    for (const candidate of candidates) values.add(candidate);
    result.set(barcode, values);
  }
  return result;
}

async function loadRetryableReport() {
  return normalizeRetryableShoplingSyncReport(
    await loadInventoryStockControlReport(),
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const [report, preparedGoodsKeysByBarcode] = await Promise.all([
    loadRetryableReport(),
    loadPreparedGoodsKeysByBarcode(),
  ]);
  return Response.json(
    {
      ok: report.state === "READY",
      report,
      jobs: report.rows
        .filter((row) => row.syncNeeded && !row.syncBlocked)
        .map((row) => {
          const goodsKeys = [
            ...new Set([
              ...row.goodsKeys,
              ...(preparedGoodsKeysByBarcode.get(row.barcode) ?? []),
            ]),
          ].sort((left, right) => Number(left) - Number(right));
          return {
            jobId: `stock-sync:${row.barcode}:${row.desiredStatus}:${row.desiredSince}`,
            barcode: row.barcode,
            productName: row.productName,
            productKind: row.productKind,
            modelNo: row.modelNo,
            goodsKeys,
            desiredStatus: row.desiredStatus,
            desiredSince: row.desiredSince,
            exactInventoryQuantity: row.exactInventoryQuantity,
            resetAt: row.resetAt,
            route:
              row.productKind === "OPTION"
                ? ["SHOPLING_API_OPTION_STATUS", "A21_GOODS_KEY_OPTION_SEND"]
                : ["A4_PRODUCT_STATUS", "A21_GOODS_KEY_PRODUCT_SALE_STATUS"],
          };
        }),
    },
    {
      status: report.state === "READY" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const event = normalizeShoplingStockSyncInput({
      eventId: body.eventId,
      jobId: body.jobId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      desiredStatus: body.desiredStatus,
      outcome: body.outcome,
      occurredAt: body.occurredAt,
      message: body.message,
      evidence: body.evidence,
    });
    const stored = await storeInventoryOperation({
      operationType: SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
      sourceEventId: `shopling-stock-sync:${encodeURIComponent(event.eventId)}`,
      correlationId: `shopling-stock:${event.barcode}`,
      snapshot: event,
    });
    const report = await loadRetryableReport();
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        report,
        message: stored.duplicate
          ? "이미 기록한 Shopling 동기화 결과입니다."
          : "Shopling 재고상태 동기화 결과를 저장했습니다.",
      },
      {
        status: stored.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_STOCK_SYNC_EVENT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재고상태 동기화 결과를 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
