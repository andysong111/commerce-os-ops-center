import {
  loadInternalChinaMonthlyPurchaseSummary,
  selectInternalChinaPurchaseSummaryForDraft,
} from "@/lib/internalChinaMonthlyPurchaseSummary";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { getFreightBarcodeHistoryStorage } from "@/lib/freightBarcodeHistoryStorage";
import {
  completeInternalChinaFreightBarcodeWithDependencies,
  parseStoredInternalChinaFreightBarcodeCompletion,
  type CompleteInternalChinaFreightBarcodeDependencies,
  type InternalChinaFreightBarcodeCompletion,
  type InternalChinaFreightBarcodeCompletionRow,
} from "./internalChinaFreightBarcodeCompletionCore";

export {
  buildInternalChinaFreightBarcodeCompletion,
  freightBarcodeHistoryEvidenceHash,
  parseStoredInternalChinaFreightBarcodeCompletion,
} from "./internalChinaFreightBarcodeCompletionCore";
export type {
  CompleteInternalChinaFreightBarcodeDependencies,
  InternalChinaFreightBarcodeCompletion,
} from "./internalChinaFreightBarcodeCompletionCore";

export const INTERNAL_CHINA_FREIGHT_BARCODE_COMPLETION_OPERATION_TYPE =
  "INTERNAL_CHINA_FREIGHT_BARCODE_COMPLETE";

const SOURCE = "ops-center-freight-barcode";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 10_000;

type CompletionRow = InternalChinaFreightBarcodeCompletionRow;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function validDraftId(value: unknown) {
  const normalized = text(value);
  if (!DRAFT_ID.test(normalized)) {
    throw new Error("FREIGHT_BARCODE_COMPLETION_DRAFT_INVALID");
  }
  return normalized;
}

function sourceEventId(draftId: string) {
  return `internal-china-freight-barcode:${draftId}`;
}

function correlationId(draftId: string) {
  return `purchase-run:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function defaultLoadPurchaseContext(
  draftId: string,
  cycleMonth: string,
) {
  const monthly = await loadInternalChinaMonthlyPurchaseSummary(cycleMonth);
  return selectInternalChinaPurchaseSummaryForDraft(monthly, draftId);
}

async function defaultLoadHistoryRecord(historyRecordId: string) {
  return getFreightBarcodeHistoryStorage().get(historyRecordId);
}

export async function loadInternalChinaFreightBarcodeCompletion(
  draftIdInput: unknown,
): Promise<InternalChinaFreightBarcodeCompletion | null> {
  const draftId = validDraftId(draftIdInput);
  const { baseUrl, secret } = supabaseConnection();
  const params = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_FREIGHT_BARCODE_COMPLETION_OPERATION_TYPE}`,
    source_event_id: `eq.${sourceEventId(draftId)}`,
    status: "eq.SUCCEEDED",
    select: "result_snapshot,started_at,updated_at",
    limit: "1",
  });
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`FREIGHT_BARCODE_COMPLETION_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as CompletionRow[];
  return parseStoredInternalChinaFreightBarcodeCompletion(draftId, rows[0]);
}

async function storeInternalChinaFreightBarcodeCompletion(
  completion: InternalChinaFreightBarcodeCompletion,
) {
  const { baseUrl, secret } = supabaseConnection();
  const now = completion.completedAt;
  const params = new URLSearchParams({
    on_conflict: "source_event_id",
    select: "source_event_id",
  });
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${params.toString()}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type:
            INTERNAL_CHINA_FREIGHT_BARCODE_COMPLETION_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: SOURCE,
          source_event_id: sourceEventId(completion.draftId),
          correlation_id: correlationId(completion.draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId: completion.draftId,
            cycleMonth: completion.cycleMonth,
            historyRecordId: completion.historyRecordId,
          },
          result_snapshot: completion,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `FREIGHT_BARCODE_COMPLETION_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

export async function completeInternalChinaFreightBarcode(
  input: {
    draftId?: unknown;
    cycleMonth?: unknown;
    historyRecordId?: unknown;
  },
  dependencies: Partial<CompleteInternalChinaFreightBarcodeDependencies> = {},
) {
  return completeInternalChinaFreightBarcodeWithDependencies(input, {
    loadPurchaseContext:
      dependencies.loadPurchaseContext ?? defaultLoadPurchaseContext,
    loadHistoryRecord:
      dependencies.loadHistoryRecord ?? defaultLoadHistoryRecord,
    loadCompletion:
      dependencies.loadCompletion ?? loadInternalChinaFreightBarcodeCompletion,
    storeCompletion:
      dependencies.storeCompletion ?? storeInternalChinaFreightBarcodeCompletion,
  });
}
