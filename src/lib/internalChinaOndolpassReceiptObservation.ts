import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  loadInternalChinaFreightBarcodeCompletion,
  loadInternalChinaFreightBarcodeReceiptEvidence,
} from "@/lib/internalChinaFreightBarcodeCompletion";
import {
  buildInternalChinaOndolpassReceiptObservation,
  parseStoredInternalChinaOndolpassReceiptObservation,
  type InternalChinaOndolpassReceiptObservation,
  type InternalChinaOndolpassReceiptObservationRow,
  type OndolpassReceiptObservationInput,
} from "@/lib/internalChinaOndolpassReceiptObservationCore";

export const INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION_OPERATION_TYPE =
  "INTERNAL_CHINA_ONDOLPASS_RECEIPT_OBSERVATION";

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

function sourceEventId(draftId: string, snapshotHash: string) {
  return `ondolpass-receipt:${draftId}:${snapshotHash.replace(/^sha256:/, "")}`;
}

async function readRows(query: URLSearchParams) {
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
  return (await response.json().catch(() => [])) as InternalChinaOndolpassReceiptObservationRow[];
}

export async function loadLatestInternalChinaOndolpassReceiptObservation(
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
  const [evidence, observation] = await Promise.all([
    loadInternalChinaFreightBarcodeReceiptEvidence(completion),
    loadLatestInternalChinaOndolpassReceiptObservation(draftId),
  ]);
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

async function storeObservation(
  observation: InternalChinaOndolpassReceiptObservation,
) {
  const { baseUrl, secret } = supabaseConnection();
  const eventId = sourceEventId(
    observation.draftId,
    observation.snapshotHash,
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
  const readback = await loadObservationBySourceEvent(
    observation.draftId,
    eventId,
  );
  if (!readback || readback.snapshotHash !== observation.snapshotHash) {
    throw new Error("ONDOLPASS_RECEIPT_STORE_READBACK_FAILED");
  }
  return readback;
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
  if (context.observation?.snapshotHash === observation.snapshotHash) {
    return { observation: context.observation, alreadyRecorded: true };
  }
  const stored = await storeObservation(observation);
  return { observation: stored, alreadyRecorded: false };
}
