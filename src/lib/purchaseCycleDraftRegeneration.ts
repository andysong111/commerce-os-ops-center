import { createHash } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  chinaOrderCommitmentCycleMonth,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import type {
  FastPurchaseInternalDraft,
  FastPurchaseInternalDraftLine,
} from "@/lib/fastPurchaseInternalDraft";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { assertDraftCanBeRegenerated } from "@/lib/purchaseCycleDraftRegenerationCore";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const MAX_LINES = 100;
const MAX_QUANTITY = 9_999;

export type PurchaseCycleDraftRegenerationResult = {
  draft: FastPurchaseInternalDraft;
  previousDraftId: string;
  supersededLineCount: number;
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

function normalizeLines(lines: FastPurchaseInternalDraftLine[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_LINES_INVALID");
  }
  const seen = new Set<string>();
  return lines.map((line) => {
    const code = barcode(line.barcode);
    const plannedQuantity = quantity(line.plannedQuantity);
    if (!BARCODE.test(code) || seen.has(code)) {
      throw new Error(`PURCHASE_DRAFT_REGENERATION_BARCODE_INVALID:${code}`);
    }
    if (plannedQuantity < 1 || plannedQuantity > MAX_QUANTITY) {
      throw new Error(`PURCHASE_DRAFT_REGENERATION_QUANTITY_INVALID:${code}`);
    }
    seen.add(code);
    return {
      ...line,
      barcode: code,
      plannedQuantity,
      referenceDemandQuantity: quantity(line.referenceDemandQuantity),
      note: text(line.note).slice(0, 300),
    };
  });
}

function operationRow(
  event: ReturnType<typeof normalizeChinaOrderCommitmentEvent>,
  result: Record<string, unknown>,
) {
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

export async function regenerateValidatedMonthlyPurchaseDraft(input: {
  sourceFingerprint: string;
  cycleMonth: string;
  lines: FastPurchaseInternalDraftLine[];
  expectedDraftId: string;
}): Promise<PurchaseCycleDraftRegenerationResult> {
  if (!FINGERPRINT.test(text(input.sourceFingerprint))) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_FINGERPRINT_INVALID");
  }
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.cycleMonth)) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_CYCLE_INVALID");
  }
  if (!DRAFT_ID.test(text(input.expectedDraftId))) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_DRAFT_ID_INVALID");
  }
  const lines = normalizeLines(input.lines);
  const stable = {
    regeneration: true,
    sourceFingerprint: input.sourceFingerprint,
    dataMode: "PURCHASE_PREFLIGHT",
    cycleMonth: input.cycleMonth,
    lines: lines.map((line) => ({
      barcode: line.barcode,
      plannedQuantity: line.plannedQuantity,
      stockSense: line.stockSense,
      referenceDemandQuantity: line.referenceDemandQuantity,
    })),
  };
  const draftId = `fast-purchase-draft:${hash(stable).slice(0, 20)}`;
  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(
      `PURCHASE_DRAFT_REGENERATION_LEDGER_UNAVAILABLE:${ledger.error}`,
    );
  }
  const cycleRows = ledger.commitments.filter(
    (row) =>
      row.sourceSystem === SOURCE_SYSTEM &&
      chinaOrderCommitmentCycleMonth(row) === input.cycleMonth,
  );
  const targetRows = cycleRows.filter((row) => row.sourceRunId === draftId);
  const previousRows = cycleRows.filter(
    (row) => row.sourceRunId === input.expectedDraftId,
  );
  if (
    targetRows.length > 0 &&
    targetRows.every((row) => row.openQuantity > 0) &&
    previousRows.length > 0 &&
    previousRows.every((row) => row.openQuantity === 0)
  ) {
    return {
      draft: {
        draftId,
        sourceFingerprint: input.sourceFingerprint,
        dataMode: "PURCHASE_PREFLIGHT",
        createdAt: targetRows[0].reservedAt ?? targetRows[0].updatedAt,
        cycleMonth: input.cycleMonth,
        lineCount: lines.length,
        totalQuantity: lines.reduce(
          (sum, line) => sum + line.plannedQuantity,
          0,
        ),
        duplicate: true,
        lines,
        externalOrderExecuted: false,
      },
      previousDraftId: input.expectedDraftId,
      supersededLineCount: previousRows.length,
      externalOrderExecuted: false,
    };
  }

  const activeRows = assertDraftCanBeRegenerated(
    cycleRows,
    input.expectedDraftId,
  );
  if (draftId === input.expectedDraftId) {
    return {
      draft: {
        draftId,
        sourceFingerprint: input.sourceFingerprint,
        dataMode: "PURCHASE_PREFLIGHT",
        createdAt: activeRows[0].reservedAt ?? activeRows[0].updatedAt,
        cycleMonth: input.cycleMonth,
        lineCount: lines.length,
        totalQuantity: lines.reduce(
          (sum, line) => sum + line.plannedQuantity,
          0,
        ),
        duplicate: true,
        lines,
        externalOrderExecuted: false,
      },
      previousDraftId: input.expectedDraftId,
      supersededLineCount: 0,
      externalOrderExecuted: false,
    };
  }

  const createdAt = new Date().toISOString();
  const cancelEvents = activeRows.map((row) =>
    normalizeChinaOrderCommitmentEvent({
      sourceSystem: row.sourceSystem,
      sourceLineId: row.sourceLineId,
      sourceRunId: row.sourceRunId,
      sourceEventId: `${row.sourceRunId}:${row.barcode}:regenerated-by:${draftId}`,
      barcode: row.barcode,
      status: "CANCELLED",
      cancelledQuantity: Math.max(
        0,
        row.committedQuantity - row.receivedQuantity,
      ),
      occurredAt: createdAt,
      note: `${input.cycleMonth} 최신 발주 로직 재계산으로 기존 RESERVED 약정을 대체했습니다.`,
      payload: {
        cycleMonth: input.cycleMonth,
        supersededByDraftId: draftId,
        regeneration: true,
        externalOrderExecuted: false,
      },
    }),
  );
  const reserveEvents = lines.map((line) =>
    normalizeChinaOrderCommitmentEvent({
      sourceSystem: SOURCE_SYSTEM,
      sourceLineId: `${draftId}:${line.barcode}`,
      sourceRunId: draftId,
      sourceEventId: `${draftId}:${line.barcode}:reserved`,
      barcode: line.barcode,
      status: "RESERVED",
      requestedQuantity: line.plannedQuantity,
      occurredAt: createdAt,
      note: `${input.cycleMonth} 최신 발주 로직 재생성 Draft · ${
        line.stockSense === "OUT" ? "품절" : "부족"
      }`,
      payload: {
        sourceFingerprint: input.sourceFingerprint,
        dataMode: "PURCHASE_PREFLIGHT",
        cycleMonth: input.cycleMonth,
        modelNo: line.modelNo,
        productName: line.productName,
        referenceDemandQuantity: line.referenceDemandQuantity,
        stockSense: line.stockSense,
        operatorNote: line.note,
        regeneration: true,
        supersedesDraftId: input.expectedDraftId,
        externalOrderExecuted: false,
      },
    }),
  );
  const operations = [
    ...cancelEvents.map((event) =>
      operationRow(event, {
        accepted: true,
        draftRegenerationSupersede: true,
        sourceDraftId: input.expectedDraftId,
        regeneratedDraftId: draftId,
        barcode: event.barcode,
        cancelledQuantity: event.cancelledQuantity,
        externalOrderExecuted: false,
      }),
    ),
    ...reserveEvents.map((event) =>
      operationRow(event, {
        accepted: true,
        internalDraft: true,
        draftRegeneration: true,
        cycleMonth: input.cycleMonth,
        draftId,
        barcode: event.barcode,
        requestedQuantity: event.requestedQuantity,
        externalOrderExecuted: false,
      }),
    ),
  ];
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `PURCHASE_DRAFT_REGENERATION_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  const inserted = body ? (JSON.parse(body) as unknown) : [];
  if (!Array.isArray(inserted) || inserted.length !== operations.length) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_PARTIAL_WRITE");
  }
  return {
    draft: {
      draftId,
      sourceFingerprint: input.sourceFingerprint,
      dataMode: "PURCHASE_PREFLIGHT",
      createdAt,
      cycleMonth: input.cycleMonth,
      lineCount: lines.length,
      totalQuantity: lines.reduce(
        (sum, line) => sum + line.plannedQuantity,
        0,
      ),
      duplicate: false,
      lines,
      externalOrderExecuted: false,
    },
    previousDraftId: input.expectedDraftId,
    supersededLineCount: cancelEvents.length,
    externalOrderExecuted: false,
  };
}
