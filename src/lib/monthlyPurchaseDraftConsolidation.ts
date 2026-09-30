import { createHash } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  chinaOrderCommitmentCycleMonth,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const MANUAL_QUANTITY_MAX = 9_999;

export type MonthlyPurchaseConsolidationLineInput = {
  barcode: string;
  plannedQuantity: number;
};

export type MonthlyPurchaseConsolidationInput = {
  cycleMonth: string;
  baseDraftId: string;
  lines: MonthlyPurchaseConsolidationLineInput[];
};

export type MonthlyPurchaseConsolidationResult = {
  cycleMonth: string;
  finalDraftId: string;
  lineCount: number;
  totalQuantity: number;
  supersededDraftIds: string[];
  cancelledLineCount: number;
  duplicate: boolean;
  externalOrderExecuted: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function operationRow(event: ReturnType<typeof normalizeChinaOrderCommitmentEvent>, result: Record<string, unknown>) {
  return {
    operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: SOURCE_SYSTEM,
    source_event_id: `china-order:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceEventId)}`,
    correlation_id: `china-order-line:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`,
    actor_type: "OPS_OPERATOR",
    input_snapshot: event,
    result_snapshot: result,
    error_message: null,
    started_at: event.occurredAt,
    finished_at: event.occurredAt,
    updated_at: event.occurredAt,
  };
}

export function normalizeMonthlyPurchaseConsolidationLines(
  values: MonthlyPurchaseConsolidationLineInput[],
  allowedBarcodes: Set<string>,
) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new Error("MONTHLY_PURCHASE_FINAL_LINES_INVALID");
  }
  const seen = new Set<string>();
  return values.map((raw) => {
    const code = barcode(raw.barcode);
    const plannedQuantity = quantity(raw.plannedQuantity);
    if (!BARCODE.test(code) || seen.has(code) || !allowedBarcodes.has(code)) {
      throw new Error(`MONTHLY_PURCHASE_FINAL_BARCODE_INVALID:${code}`);
    }
    if (plannedQuantity <= 0 || plannedQuantity > MANUAL_QUANTITY_MAX) {
      throw new Error(`MONTHLY_PURCHASE_FINAL_QUANTITY_INVALID:${code}`);
    }
    seen.add(code);
    return { barcode: code, plannedQuantity };
  });
}

export async function consolidateMonthlyPurchaseDrafts(
  input: MonthlyPurchaseConsolidationInput,
): Promise<MonthlyPurchaseConsolidationResult> {
  const cycleMonth = text(input.cycleMonth);
  const baseDraftId = text(input.baseDraftId);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("MONTHLY_PURCHASE_FINAL_CYCLE_INVALID");
  }
  if (cycleMonth !== seoulCalendarMonth(new Date())) {
    throw new Error("MONTHLY_PURCHASE_FINAL_CURRENT_CYCLE_ONLY");
  }
  if (!DRAFT_ID.test(baseDraftId)) {
    throw new Error("MONTHLY_PURCHASE_FINAL_BASE_DRAFT_INVALID");
  }

  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(`MONTHLY_PURCHASE_FINAL_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const cycleRows = ledger.commitments.filter(
    (row) =>
      row.sourceSystem === SOURCE_SYSTEM &&
      chinaOrderCommitmentCycleMonth(row) === cycleMonth,
  );
  const activeRows = cycleRows.filter((row) => row.openQuantity > 0);
  const activeDraftIds = [
    ...new Set(activeRows.map((row) => row.sourceRunId).filter(Boolean) as string[]),
  ].sort();
  if (!activeDraftIds.includes(baseDraftId)) {
    throw new Error("MONTHLY_PURCHASE_FINAL_BASE_DRAFT_NOT_ACTIVE");
  }
  if (activeDraftIds.length < 2) {
    throw new Error("MONTHLY_PURCHASE_FINAL_MULTIPLE_DRAFTS_REQUIRED");
  }
  const unsafe = activeRows.find(
    (row) =>
      row.status !== "RESERVED" ||
      row.orderedQuantity > 0 ||
      row.receivedQuantity > 0,
  );
  if (unsafe) {
    throw new Error(`MONTHLY_PURCHASE_FINAL_SOURCE_ALREADY_PROGRESSING:${unsafe.barcode}`);
  }

  const allowedBarcodes = new Set(activeRows.map((row) => row.barcode));
  const lines = normalizeMonthlyPurchaseConsolidationLines(
    input.lines,
    allowedBarcodes,
  );
  const stable = {
    cycleMonth,
    monthlyFinal: true,
    lines: [...lines].sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    ),
  };
  const finalDraftId = `fast-purchase-draft:${hash(stable).slice(0, 20)}`;
  const existingFinal = cycleRows.filter((row) => row.sourceRunId === finalDraftId);
  if (existingFinal.length) {
    return {
      cycleMonth,
      finalDraftId,
      lineCount: existingFinal.length,
      totalQuantity: existingFinal.reduce(
        (sum, row) => sum + row.openQuantity,
        0,
      ),
      supersededDraftIds: activeDraftIds.filter((id) => id !== finalDraftId),
      cancelledLineCount: 0,
      duplicate: true,
      externalOrderExecuted: false,
    };
  }

  const createdAt = new Date().toISOString();
  const supersededDraftIds = activeDraftIds.filter((id) => id !== finalDraftId);
  const cancelEvents = activeRows.map((row) => {
    const cancelledQuantity = Math.max(
      0,
      row.committedQuantity - row.receivedQuantity,
    );
    return normalizeChinaOrderCommitmentEvent({
      sourceSystem: row.sourceSystem,
      sourceLineId: row.sourceLineId,
      sourceRunId: row.sourceRunId,
      sourceEventId: `${row.sourceRunId}:${row.barcode}:superseded-by:${finalDraftId}`,
      barcode: row.barcode,
      status: "CANCELLED",
      cancelledQuantity,
      occurredAt: createdAt,
      note: `${cycleMonth} 월간 최종 Draft로 통합되어 기존 미입고 약정을 해제했습니다.`,
      payload: {
        cycleMonth,
        supersededByDraftId: finalDraftId,
        externalOrderExecuted: false,
      },
    });
  });
  const reserveEvents = lines.map((line) =>
    normalizeChinaOrderCommitmentEvent({
      sourceSystem: SOURCE_SYSTEM,
      sourceLineId: `${finalDraftId}:${line.barcode}`,
      sourceRunId: finalDraftId,
      sourceEventId: `${finalDraftId}:${line.barcode}:reserved`,
      barcode: line.barcode,
      status: "RESERVED",
      requestedQuantity: line.plannedQuantity,
      occurredAt: createdAt,
      note: `${cycleMonth} 월간 최종 발주 Draft`,
      payload: {
        cycleMonth,
        monthlyFinal: true,
        baseDraftId,
        supersedesDraftIds: supersededDraftIds,
        externalOrderExecuted: false,
      },
    }),
  );
  const operations = [
    ...cancelEvents.map((event) =>
      operationRow(event, {
        accepted: true,
        monthlyFinalSupersede: true,
        finalDraftId,
        sourceDraftId: event.sourceRunId,
        barcode: event.barcode,
        cancelledQuantity: event.cancelledQuantity,
        externalOrderExecuted: false,
      }),
    ),
    ...reserveEvents.map((event) =>
      operationRow(event, {
        accepted: true,
        internalDraft: true,
        monthlyFinal: true,
        cycleMonth,
        draftId: finalDraftId,
        barcode: event.barcode,
        requestedQuantity: event.requestedQuantity,
        externalOrderExecuted: false,
      }),
    ),
  ];

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `MONTHLY_PURCHASE_FINAL_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }

  return {
    cycleMonth,
    finalDraftId,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.plannedQuantity, 0),
    supersededDraftIds,
    cancelledLineCount: cancelEvents.length,
    duplicate: false,
    externalOrderExecuted: false,
  };
}
