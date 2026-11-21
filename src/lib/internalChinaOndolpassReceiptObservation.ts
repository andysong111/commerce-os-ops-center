import { randomUUID } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  loadInternalChinaFreightBarcodeCompletion,
  loadInternalChinaFreightBarcodeReceiptEvidence,
} from "@/lib/internalChinaFreightBarcodeCompletion";
import {
  applyInternalChinaOndolpassOrderNumberCorrections,
  buildInternalChinaOndolpassReceiptSourceEventId,
  buildInternalChinaOndolpassOrderNumberCorrection,
  buildInternalChinaOndolpassReceiptObservation,
  parseStoredInternalChinaOndolpassReceiptObservation,
  type InternalChinaOndolpassReceiptObservation,
  type InternalChinaOndolpassReceiptObservationRow,
  type InternalChinaOndolpassOrderNumberCorrection,
  type OndolpassReceiptObservationInput,
} from "@/lib/internalChinaOndolpassReceiptObservationCore";

export const INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION_OPERATION_TYPE =
  "INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION";
export const INTERNAL_CHINA_ONDOLPASS_ORDER_NUMBER_CORRECTION_OPERATION_TYPE =
  "INTERNAL_CHINA_ONDOLPASS_ORDER_NUMBER_CORRECTION";

const SOURCE = "local-agent-ondolpass-receipt-status";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 10_000;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("ONDOLPASS_RECEIPT_DRAFT_INVALID");
  }
  return draftId;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function correlationId(draftId: string) {
  return `purchase-run:${draftId}`;
}

async function readRows<T = InternalChinaOndolpassReceiptObservationRow>(
  query: URLSearchParams,
) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${query.toString()}`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`ONDOLPASS_RECEIPT_READ_FAILED:${response.status}`);
  }
  return (await response.json().catch(() => [])) as T[];
}

async function loadRawLatestInternalChinaOndolpassReceiptObservation(
  draftIdInput: unknown,
): Promise<InternalChinaOndolpassReceiptObservation | null> {
  const draftId = validDraftId(draftIdInput);
  const query = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION_OPERATION_TYPE}`,
    correlation_id: `eq.${correlationId(draftId)}`,
    status: "eq.SUCCEEDED",
    select: "result_snapshot,started_at,updated_at",
    order: "started_at.desc",
    limit: "1",
  });
  const rows = await readRows(query);
  return parseStoredInternalChinaOndolpassReceiptObservation(draftId, rows[0]);
}

function correctionFromRow(
  draftId: string,
  row: InternalChinaOndolpassReceiptObservationRow | undefined,
): InternalChinaOndolpassOrderNumberCorrection | null {
  const snapshot = row?.result_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const value = snapshot as Record<string, unknown>;
  const applicationNo = text(value.applicationNo);
  const rowNo = Number(value.rowNo);
  const previousOrderNo = text(value.previousOrderNo);
  const correctedOrderNo = text(value.correctedOrderNo);
  const correctedAt = text(value.correctedAt);
  if (
    text(value.draftId) !== draftId ||
    !/^\d+$/.test(applicationNo) ||
    !Number.isInteger(rowNo) ||
    rowNo <= 0 ||
    !/^\d{19}$/.test(previousOrderNo) ||
    !/^\d{19}$/.test(correctedOrderNo) ||
    !Number.isFinite(Date.parse(correctedAt))
  ) {
    return null;
  }
  return {
    draftId,
    applicationNo,
    rowNo,
    previousOrderNo,
    correctedOrderNo,
    correctedAt: new Date(correctedAt).toISOString(),
  };
}

async function loadInternalChinaOndolpassOrderNumberCorrections(
  draftIdInput: unknown,
) {
  const draftId = validDraftId(draftIdInput);
  const query = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_ONDOLPASS_ORDER_NUMBER_CORRECTION_OPERATION_TYPE}`,
    correlation_id: `eq.${correlationId(draftId)}`,
    status: "eq.SUCCEEDED",
    select: "result_snapshot,started_at,updated_at",
    order: "started_at.desc",
    limit: "500",
  });
  const rows = await readRows(query);
  return rows.flatMap((row) => {
    const correction = correctionFromRow(draftId, row);
    return correction ? [correction] : [];
  });
}

function observationInputFromStored(
  observation: InternalChinaOndolpassReceiptObservation,
  observedAt = observation.observedAt,
): OndolpassReceiptObservationInput {
  const rowsByApplication = new Map<
    string,
    Array<{
      rowNo: number;
      quantity: number;
      status: string;
      orderNo: string;
      itemName: string;
      trackingNumbers: string[];
    }>
  >();
  for (const row of observation.rows) {
    const rows = rowsByApplication.get(row.applicationNo) ?? [];
    rows.push({
      rowNo: row.rowNo,
      quantity: row.displayedQuantity,
      status: row.status,
      orderNo: row.orderNo,
      itemName: row.itemName,
      trackingNumbers: row.trackingNumbers,
    });
    rowsByApplication.set(row.applicationNo, rows);
  }
  return {
    draftId: observation.draftId,
    evidenceHash: observation.evidenceHash,
    observedAt,
    applications: [...rowsByApplication.entries()].map(([applicationNo, rows]) => ({
      applicationNo,
      state: "",
      rows: rows.sort((left, right) => left.rowNo - right.rowNo),
    })),
  };
}

function resolveObservationAgainstCorrections(
  raw: InternalChinaOndolpassReceiptObservation | null,
  evidence: Awaited<ReturnType<typeof loadInternalChinaFreightBarcodeReceiptEvidence>>,
  corrections: readonly InternalChinaOndolpassOrderNumberCorrection[],
) {
  if (!raw) return null;
  return buildInternalChinaOndolpassReceiptObservation(
    observationInputFromStored(raw),
    applyInternalChinaOndolpassOrderNumberCorrections(evidence, corrections),
    null,
  );
}

export async function loadLatestInternalChinaOndolpassReceiptObservation(
  draftIdInput: unknown,
): Promise<InternalChinaOndolpassReceiptObservation | null> {
  const draftId = validDraftId(draftIdInput);
  const completion = await loadInternalChinaFreightBarcodeCompletion(draftId);
  if (!completion) return null;
  const [raw, evidence, corrections] = await Promise.all([
    loadRawLatestInternalChinaOndolpassReceiptObservation(draftId),
    loadInternalChinaFreightBarcodeReceiptEvidence(completion),
    loadInternalChinaOndolpassOrderNumberCorrections(draftId),
  ]);
  return resolveObservationAgainstCorrections(raw, evidence, corrections);
}

async function loadObservationBySourceEvent(
  draftId: string,
  eventId: string,
) {
  const query = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION_OPERATION_TYPE}`,
    source_event_id: `eq.${eventId}`,
    status: "eq.SUCCEEDED",
    select: "result_snapshot,started_at,updated_at",
    limit: "1",
  });
  const rows = await readRows(query);
  return parseStoredInternalChinaOndolpassReceiptObservation(draftId, rows[0]);
}

export async function loadInternalChinaOndolpassReceiptContext(
  draftIdInput: unknown,
) {
  const draftId = validDraftId(draftIdInput);
  const completion = await loadInternalChinaFreightBarcodeCompletion(draftId);
  if (!completion) throw new Error("ONDOLPASS_RECEIPT_BARCODE_COMPLETION_REQUIRED");
  const [baseEvidence, rawObservation, corrections] = await Promise.all([
    loadInternalChinaFreightBarcodeReceiptEvidence(completion),
    loadRawLatestInternalChinaOndolpassReceiptObservation(draftId),
    loadInternalChinaOndolpassOrderNumberCorrections(draftId),
  ]);
  const evidence = applyInternalChinaOndolpassOrderNumberCorrections(
    baseEvidence,
    corrections,
  );
  const observation = resolveObservationAgainstCorrections(
    rawObservation,
    baseEvidence,
    corrections,
  );
  const applications = [...new Set(evidence.lines.map((line) => line.applicationNo))]
    .sort((left, right) => left.localeCompare(right));
  return {
    draftId,
    cycleMonth: evidence.cycleMonth,
    historyRecordId: evidence.historyRecordId,
    evidenceHash: evidence.evidenceHash,
    applications,
    expectedRows: evidence.lines.map((line) => ({
      applicationNo: line.applicationNo,
      rowNo: line.rowNo,
      quantity: line.quantity,
      orderNo: line.orderNo,
    })),
    observation,
    evidence,
  };
}

async function storeOrderNumberCorrection(
  correction: InternalChinaOndolpassOrderNumberCorrection,
) {
  const { baseUrl, secret } = supabaseConnection();
  const eventId = [
    "ondolpass-order-correction",
    correction.draftId,
    correction.applicationNo,
    correction.rowNo,
    randomUUID(),
  ].join(":");
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          operation_type:
            INTERNAL_CHINA_ONDOLPASS_ORDER_NUMBER_CORRECTION_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: "ops-center-ondolpass-order-correction",
          source_event_id: eventId,
          correlation_id: correlationId(correction.draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId: correction.draftId,
            applicationNo: correction.applicationNo,
            rowNo: correction.rowNo,
            previousOrderNo: correction.previousOrderNo,
          },
          result_snapshot: correction,
          started_at: correction.correctedAt,
          finished_at: correction.correctedAt,
          updated_at: correction.correctedAt,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `ONDOLPASS_ORDER_CORRECTION_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

async function storeObservation(
  observation: InternalChinaOndolpassReceiptObservation,
) {
  const { baseUrl, secret } = supabaseConnection();
  const eventId = buildInternalChinaOndolpassReceiptSourceEventId(
    observation.draftId,
    observation.snapshotHash,
    observation.observedAt,
  );
  const query = new URLSearchParams({
    on_conflict: "source_event_id",
    select: "source_event_id",
  });
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${query.toString()}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type:
            INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: SOURCE,
          source_event_id: eventId,
          correlation_id: correlationId(observation.draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId: observation.draftId,
            historyRecordId: observation.historyRecordId,
            evidenceHash: observation.evidenceHash,
            snapshotHash: observation.snapshotHash,
          },
          result_snapshot: observation,
          started_at: observation.observedAt,
          finished_at: observation.observedAt,
          updated_at: observation.observedAt,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `ONDOLPASS_RECEIPT_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  let insertedRows: unknown;
  try {
    insertedRows = JSON.parse(body);
  } catch {
    throw new Error("ONDOLPASS_RECEIPT_STORE_RESPONSE_INVALID");
  }
  if (!Array.isArray(insertedRows)) {
    throw new Error("ONDOLPASS_RECEIPT_STORE_RESPONSE_INVALID");
  }
  const readback = await loadObservationBySourceEvent(
    observation.draftId,
    eventId,
  );
  if (
    !readback ||
    readback.snapshotHash !== observation.snapshotHash ||
    readback.observedAt !== observation.observedAt
  ) {
    throw new Error("ONDOLPASS_RECEIPT_STORE_READBACK_FAILED");
  }
  return {
    observation: readback,
    alreadyRecorded: insertedRows.length === 0,
  };
}

export async function recordInternalChinaOndolpassReceiptObservation(
  input: OndolpassReceiptObservationInput,
) {
  const draftId = validDraftId(input.draftId);
  const context = await loadInternalChinaOndolpassReceiptContext(draftId);
  const observation = buildInternalChinaOndolpassReceiptObservation(
    input,
    context.evidence,
    context.observation,
  );
  return storeObservation(observation);
}

export async function saveInternalChinaOndolpassOrderNumberCorrection(input: {
  draftId?: unknown;
  applicationNo?: unknown;
  rowNo?: unknown;
  correctedOrderNo?: unknown;
}) {
  const draftId = validDraftId(input.draftId);
  const completion = await loadInternalChinaFreightBarcodeCompletion(draftId);
  if (!completion) throw new Error("ONDOLPASS_RECEIPT_BARCODE_COMPLETION_REQUIRED");
  const [baseEvidence, rawObservation, currentCorrections] = await Promise.all([
    loadInternalChinaFreightBarcodeReceiptEvidence(completion),
    loadRawLatestInternalChinaOndolpassReceiptObservation(draftId),
    loadInternalChinaOndolpassOrderNumberCorrections(draftId),
  ]);
  const currentEvidence = applyInternalChinaOndolpassOrderNumberCorrections(
    baseEvidence,
    currentCorrections,
  );
  const currentObservation = resolveObservationAgainstCorrections(
    rawObservation,
    baseEvidence,
    currentCorrections,
  );
  const correction = buildInternalChinaOndolpassOrderNumberCorrection(
    input,
    currentEvidence,
    currentObservation,
  );
  await storeOrderNumberCorrection(correction);

  const nextObservation = currentObservation
    ? buildInternalChinaOndolpassReceiptObservation(
        observationInputFromStored(currentObservation, correction.correctedAt),
        applyInternalChinaOndolpassOrderNumberCorrections(baseEvidence, [
          correction,
          ...currentCorrections,
        ]),
        currentObservation,
      )
    : null;
  const stored = nextObservation
    ? await storeObservation(nextObservation)
    : null;
  return { correction, observation: stored?.observation ?? null };
}
