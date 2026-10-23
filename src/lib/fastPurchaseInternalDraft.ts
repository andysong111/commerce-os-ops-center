import { createHash } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { loadFastPurchaseMvpResilient } from "@/lib/fastPurchaseMvpResilient";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import {
  inferPurchaseRunCycleBasis,
  isPurchaseRunCycleBasis,
  seoulDateFromTimestamp,
  type PurchaseRunCycleBasis,
} from "@/lib/purchaseRunCycle";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const MAX_LINES = 100;
const MANUAL_QUANTITY_MAX = 9_999;
const BARCODE = /^B[A-Z]{2}\d+-\d+$/;

export type FastPurchaseDraftStockSense = "LOW" | "OUT";
export type PurchaseDraftDataMode =
  | "LIVE"
  | "LAST_KNOWN_MANUAL_FALLBACK"
  | "PURCHASE_PREFLIGHT";

export type FastPurchaseInternalDraftLineInput = {
  barcode: string;
  plannedQuantity: number;
  stockSense: FastPurchaseDraftStockSense;
  referenceDemandQuantity: number;
  note?: string;
};

export type FastPurchaseInternalDraftInput = {
  sourceFingerprint: string;
  dataMode: "LIVE" | "LAST_KNOWN_MANUAL_FALLBACK";
  lines: FastPurchaseInternalDraftLineInput[];
};

export type FastPurchaseInternalDraftLine = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  plannedQuantity: number;
  stockSense: FastPurchaseDraftStockSense;
  referenceDemandQuantity: number;
  note: string;
};

export type FastPurchaseInternalDraft = {
  draftId: string;
  sourceFingerprint: string;
  dataMode: PurchaseDraftDataMode;
  createdAt: string;
  cycleMonth: string;
  cycleMode: "ON_DEMAND" | "MONTHLY_LEGACY";
  cycleKey: string | null;
  cycleStartDate: string;
  previousCycleStartDate: string | null;
  revenueRangeStartDate: string | null;
  revenueRangeEndDate: string | null;
  cycleBootstrap: boolean;
  lineCount: number;
  totalQuantity: number;
  duplicate: boolean;
  lines: FastPurchaseInternalDraftLine[];
  externalOrderExecuted: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

export async function createFastPurchaseInternalDraft(
  input: FastPurchaseInternalDraftInput,
): Promise<FastPurchaseInternalDraft> {
  const report = await loadFastPurchaseMvpResilient();
  if (!/^sha256:[a-f0-9]{64}$/.test(text(input.sourceFingerprint))) {
    throw new Error("FAST_PURCHASE_DRAFT_FINGERPRINT_INVALID");
  }
  if (report.fingerprint !== input.sourceFingerprint) {
    throw new Error("FAST_PURCHASE_DRAFT_SOURCE_CHANGED");
  }
  if (report.dataMode !== input.dataMode) {
    throw new Error("FAST_PURCHASE_DRAFT_MODE_CHANGED");
  }
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > MAX_LINES
  ) {
    throw new Error("FAST_PURCHASE_DRAFT_LINES_INVALID");
  }

  const reportByBarcode = new Map(
    report.rows.map((row) => [barcode(row.barcode), row] as const),
  );
  const seen = new Set<string>();
  const lines: FastPurchaseInternalDraftLine[] = input.lines.map((raw) => {
    const key = barcode(raw.barcode);
    if (!BARCODE.test(key) || seen.has(key)) {
      throw new Error(`FAST_PURCHASE_DRAFT_BARCODE_INVALID:${key}`);
    }
    seen.add(key);
    const current = reportByBarcode.get(key);
    if (!current) {
      throw new Error(`FAST_PURCHASE_DRAFT_BARCODE_NOT_CURRENT:${key}`);
    }
    if (
      current.action !== "MANUAL_REVIEW" &&
      current.action !== "DEMAND_ONLY_REVIEW"
    ) {
      throw new Error(`FAST_PURCHASE_DRAFT_NOT_MANUAL:${key}`);
    }
    if (raw.stockSense !== "LOW" && raw.stockSense !== "OUT") {
      throw new Error(`FAST_PURCHASE_DRAFT_STOCK_JUDGMENT_REQUIRED:${key}`);
    }
    const plannedQuantity = quantity(raw.plannedQuantity);
    if (plannedQuantity <= 0) {
      throw new Error(`FAST_PURCHASE_DRAFT_QUANTITY_REQUIRED:${key}`);
    }
    if (plannedQuantity > MANUAL_QUANTITY_MAX) {
      throw new Error(`FAST_PURCHASE_DRAFT_QUANTITY_EXCEEDED:${key}`);
    }
    const currentReference = quantity(current.referenceDemandQuantity);
    if (quantity(raw.referenceDemandQuantity) !== currentReference) {
      throw new Error(`FAST_PURCHASE_DRAFT_REFERENCE_CHANGED:${key}`);
    }
    return {
      barcode: key,
      modelNo: current.modelNo,
      productName: current.productName,
      plannedQuantity,
      stockSense: raw.stockSense,
      referenceDemandQuantity: currentReference,
      note: text(raw.note).slice(0, 300),
    };
  });

  return storeValidatedMonthlyPurchaseDraft({
    sourceFingerprint: input.sourceFingerprint,
    dataMode: input.dataMode,
    cycleMonth: seoulCalendarMonth(new Date()),
    lines,
    allowAdoptExistingReservedDraft: true,
  });
}

export async function storeValidatedMonthlyPurchaseDraft(input: {
  sourceFingerprint: string;
  dataMode: PurchaseDraftDataMode;
  cycleMonth: string;
  lines: FastPurchaseInternalDraftLine[];
  allowAdoptExistingReservedDraft?: boolean;
  operatorExcludedBarcodes?: string[];
  operatorQuantityOverrides?: Array<{ barcode: string; targetQuantity: number }>;
  purchaseRunCycle?: PurchaseRunCycleBasis;
}): Promise<FastPurchaseInternalDraft> {
  if (!/^sha256:[a-f0-9]{64}$/.test(text(input.sourceFingerprint))) {
    throw new Error("FAST_PURCHASE_DRAFT_FINGERPRINT_INVALID");
  }
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.cycleMonth)) {
    throw new Error("FAST_PURCHASE_DRAFT_CYCLE_INVALID");
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_LINES) {
    throw new Error("FAST_PURCHASE_DRAFT_LINES_INVALID");
  }
  const seen = new Set<string>();
  const lines = input.lines.map((line) => {
    const key = barcode(line.barcode);
    if (!BARCODE.test(key) || seen.has(key)) {
      throw new Error(`FAST_PURCHASE_DRAFT_BARCODE_INVALID:${key}`);
    }
    seen.add(key);
    const plannedQuantity = quantity(line.plannedQuantity);
    if (plannedQuantity <= 0 || plannedQuantity > MANUAL_QUANTITY_MAX) {
      throw new Error(`FAST_PURCHASE_DRAFT_QUANTITY_INVALID:${key}`);
    }
    return {
      ...line,
      barcode: key,
      plannedQuantity,
      referenceDemandQuantity: quantity(line.referenceDemandQuantity),
      note: text(line.note).slice(0, 300),
    };
  });

  const totalQuantity = lines.reduce(
    (sum, line) => sum + line.plannedQuantity,
    0,
  );
  const operatorExcludedBarcodes = [...new Set(
    (input.operatorExcludedBarcodes ?? []).map(barcode).filter((value) => BARCODE.test(value)),
  )].sort();
  const excluded = new Set(operatorExcludedBarcodes);
  const operatorQuantityOverrides = [...new Map(
    (input.operatorQuantityOverrides ?? [])
      .map((row) => [barcode(row.barcode), quantity(row.targetQuantity)] as const)
      .filter(([code, target]) => BARCODE.test(code) && !excluded.has(code) && target > 0 && target <= MANUAL_QUANTITY_MAX),
  )]
    .map(([code, targetQuantity]) => ({ barcode: code, targetQuantity }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
  const createdAt = new Date().toISOString();
  const existing = await loadFastPurchaseInternalDrafts();
  if (existing.error) {
    throw new Error(`FAST_PURCHASE_CYCLE_LEDGER_UNAVAILABLE:${existing.error}`);
  }
  const purchaseRunCycle = input.purchaseRunCycle ?? inferPurchaseRunCycleBasis({
    targetDate: seoulDateFromTimestamp(createdAt),
    drafts: existing.drafts,
  });
  const stable = {
    sourceFingerprint: input.sourceFingerprint,
    dataMode: input.dataMode,
    purchaseRunCycle,
    lines: lines.map((line) => ({
      barcode: line.barcode,
      plannedQuantity: line.plannedQuantity,
      stockSense: line.stockSense,
      referenceDemandQuantity: line.referenceDemandQuantity,
    })),
    operatorAdjustments: {
      excludedBarcodes: operatorExcludedBarcodes,
      quantityOverrides: operatorQuantityOverrides,
    },
  };
  const proposedDraftId = `fast-purchase-draft:${hash(stable).slice(0, 20)}`;
  const cycleMonth = purchaseRunCycle.cycleStartDate.slice(0, 7);

  // Recalculation on the same start date keeps one active purchase run. A new
  // start date creates a separate run, including another run in the same month.
  const sameCycle = existing.drafts.filter(
    (draft) =>
      draft.createdAt &&
      (draft.cycleKey === purchaseRunCycle.cycleKey ||
        draft.cycleStartDate === purchaseRunCycle.cycleStartDate) &&
      draft.openQuantity > 0,
  );
  if (sameCycle.length > 1) {
    throw new Error(`FAST_PURCHASE_CYCLE_MULTIPLE_DRAFTS:${purchaseRunCycle.cycleKey}`);
  }
  const currentCycleDraft = sameCycle[0] ?? null;
  if (
    currentCycleDraft &&
    currentCycleDraft.draftId !== proposedDraftId &&
    (input.allowAdoptExistingReservedDraft !== true ||
      currentCycleDraft.orderedQuantity > 0 ||
      currentCycleDraft.receivedQuantity > 0)
  ) {
    throw new Error(
      `FAST_PURCHASE_CYCLE_ALREADY_USED:${purchaseRunCycle.cycleKey}:${currentCycleDraft.draftId}`,
    );
  }
  const draftId = currentCycleDraft?.draftId || proposedDraftId;

  const { baseUrl, secret } = supabaseConnection();
  const operations = lines.map((line) => {
    const event = normalizeChinaOrderCommitmentEvent({
      sourceSystem: SOURCE_SYSTEM,
      sourceLineId: `${draftId}:${line.barcode}`,
      sourceRunId: draftId,
      sourceEventId: `${draftId}:${line.barcode}:reserved`,
      barcode: line.barcode,
      status: "RESERVED",
      requestedQuantity: line.plannedQuantity,
      occurredAt: createdAt,
      note: `${input.dataMode === "PURCHASE_PREFLIGHT" ? "발주 사전점검" : "빠른 발주안"} 내부 Draft · ${
        line.stockSense === "OUT" ? "품절" : "부족"
      }`,
      payload: {
        sourceFingerprint: input.sourceFingerprint,
        dataMode: input.dataMode,
        cycleMonth,
        cycleMode: purchaseRunCycle.mode,
        cycleKey: purchaseRunCycle.cycleKey,
        cycleStartDate: purchaseRunCycle.cycleStartDate,
        previousCycleStartDate: purchaseRunCycle.previousCycleStartDate,
        revenueRangeStartDate: purchaseRunCycle.revenueRangeStartDate,
        revenueRangeEndDate: purchaseRunCycle.revenueRangeEndDate,
        cycleBootstrap: purchaseRunCycle.bootstrap,
        modelNo: line.modelNo,
        productName: line.productName,
        referenceDemandQuantity: line.referenceDemandQuantity,
        stockSense: line.stockSense,
        operatorNote: line.note,
        operatorExcludedBarcodes,
        operatorQuantityOverrides,
        externalOrderExecuted: false,
      },
    });
    return {
      operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: SOURCE_SYSTEM,
      source_event_id: `china-order:${encodeURIComponent(
        event.sourceSystem,
      )}:${encodeURIComponent(event.sourceEventId)}`,
      correlation_id: `china-order-line:${encodeURIComponent(
        event.sourceSystem,
      )}:${encodeURIComponent(event.sourceLineId)}`,
      actor_type: "OPS_OPERATOR",
      input_snapshot: event,
      result_snapshot: {
        accepted: true,
        internalDraft: true,
        externalOrderExecuted: false,
        cycleMonth,
        cycleMode: purchaseRunCycle.mode,
        cycleKey: purchaseRunCycle.cycleKey,
        cycleStartDate: purchaseRunCycle.cycleStartDate,
        previousCycleStartDate: purchaseRunCycle.previousCycleStartDate,
        draftId,
        barcode: line.barcode,
        requestedQuantity: line.plannedQuantity,
      },
      error_message: null,
      started_at: createdAt,
      finished_at: createdAt,
      updated_at: createdAt,
    };
  });

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
      `FAST_PURCHASE_DRAFT_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  const inserted = body ? (JSON.parse(body) as unknown) : [];
  const insertedCount = Array.isArray(inserted) ? inserted.length : 0;

  return {
    draftId,
    sourceFingerprint: input.sourceFingerprint,
    dataMode: input.dataMode,
    createdAt,
    cycleMonth,
    cycleMode: purchaseRunCycle.mode,
    cycleKey: purchaseRunCycle.cycleKey,
    cycleStartDate: purchaseRunCycle.cycleStartDate,
    previousCycleStartDate: purchaseRunCycle.previousCycleStartDate,
    revenueRangeStartDate: purchaseRunCycle.revenueRangeStartDate,
    revenueRangeEndDate: purchaseRunCycle.revenueRangeEndDate,
    cycleBootstrap: purchaseRunCycle.bootstrap,
    lineCount: lines.length,
    totalQuantity,
    duplicate: insertedCount === 0,
    lines,
    externalOrderExecuted: false,
  };
}

export async function loadFastPurchaseInternalDrafts() {
  const ledger = await loadChinaOrderLedger();
  const rows = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM,
  );
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const draftId = row.sourceRunId || "UNKNOWN_DRAFT";
    groups.set(draftId, [...(groups.get(draftId) ?? []), row]);
  }
  const drafts = [...groups.entries()]
    .map(([draftId, lines]) => {
      const createdAt = lines.reduce((earliest, line) => {
        const candidate = line.reservedAt || line.updatedAt;
        if (!earliest) return candidate;
        return Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest;
      }, "");
      const payloadMonths = [
        ...new Set(
          lines
            .map((line) => text(object(line.latestPayload).cycleMonth))
            .filter((value) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value)),
        ),
      ];
      const payloadCycles = lines
        .map((line) => object(line.latestPayload))
        .map((payload) => ({
          mode: payload.cycleMode,
          cycleKey: payload.cycleKey,
          cycleStartDate: payload.cycleStartDate,
          previousCycleStartDate: payload.previousCycleStartDate,
          revenueRangeStartDate: payload.revenueRangeStartDate,
          revenueRangeEndDate: payload.revenueRangeEndDate,
          bootstrap: payload.cycleBootstrap === true,
        }))
        .filter(isPurchaseRunCycleBasis);
      const distinctCycleKeys = [...new Set(payloadCycles.map((cycle) => cycle.cycleKey))];
      const purchaseRunCycle = distinctCycleKeys.length === 1
        ? payloadCycles.find((cycle) => cycle.cycleKey === distinctCycleKeys[0]) ?? null
        : null;
      const cycleStartDate = purchaseRunCycle?.cycleStartDate || seoulDateFromTimestamp(createdAt);
      return {
        draftId,
        cycleMonth:
          payloadMonths.length === 1
            ? payloadMonths[0]
            : createdAt
              ? seoulCalendarMonth(createdAt)
              : "",
        cycleMode: purchaseRunCycle ? "ON_DEMAND" as const : "MONTHLY_LEGACY" as const,
        cycleKey: purchaseRunCycle?.cycleKey ?? null,
        cycleStartDate,
        previousCycleStartDate: purchaseRunCycle?.previousCycleStartDate ?? null,
        revenueRangeStartDate: purchaseRunCycle?.revenueRangeStartDate ?? null,
        revenueRangeEndDate: purchaseRunCycle?.revenueRangeEndDate ?? null,
        cycleBootstrap: purchaseRunCycle?.bootstrap ?? false,
        createdAt,
        lineCount: lines.length,
        requestedQuantity: lines.reduce(
          (sum, line) => sum + line.requestedQuantity,
          0,
        ),
        orderedQuantity: lines.reduce(
          (sum, line) => sum + line.orderedQuantity,
          0,
        ),
        receivedQuantity: lines.reduce(
          (sum, line) => sum + line.receivedQuantity,
          0,
        ),
        cancelledQuantity: lines.reduce(
          (sum, line) => sum + line.cancelledQuantity,
          0,
        ),
        openQuantity: lines.reduce(
          (sum, line) => sum + line.openQuantity,
          0,
        ),
        updatedAt: lines.reduce(
          (latest, line) =>
            Date.parse(line.updatedAt) > Date.parse(latest)
              ? line.updatedAt
              : latest,
          lines[0]?.updatedAt ?? new Date(0).toISOString(),
        ),
        lines: lines.map((line) => ({
          barcode: line.barcode,
          requestedQuantity: line.requestedQuantity,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          cancelledQuantity: line.cancelledQuantity,
          openQuantity: line.openQuantity,
          status: line.status,
        })),
      };
    })
    .sort((left, right) => {
      const active = Number(right.openQuantity > 0) - Number(left.openQuantity > 0);
      return active || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  return { drafts, error: ledger.error };
}
