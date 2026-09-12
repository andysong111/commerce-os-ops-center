import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeReliabilityEvent,
  type ReliabilityEventInput,
} from "@/lib/reliability/reliabilityEvent";

export type ReliabilityIngestResult = {
  ok: boolean;
  duplicate?: boolean;
  event_row_id?: string | null;
  incident_id?: string | null;
  occurrence_count?: number;
};

export type ReliabilityBatchIngestResult = {
  ok: boolean;
  accepted: number;
  duplicates: number;
  results: ReliabilityIngestResult[];
};

function firstRow(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function batchPayload(value: unknown): ReliabilityBatchIngestResult | null {
  const payload = firstRow(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (
    record.ok !== true ||
    !Number.isInteger(record.accepted) ||
    !Number.isInteger(record.duplicates) ||
    !Array.isArray(record.results)
  ) {
    return null;
  }
  return payload as ReliabilityBatchIngestResult;
}

export async function ingestReliabilityEvent(input: ReliabilityEventInput) {
  const event = normalizeReliabilityEvent(input);
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    throw new Error("OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.");
  }

  const result = await admin.rpc("ingest_reliability_event", {
    p_event: event,
  });
  if (result.error) {
    throw new Error(`신뢰성 이벤트를 저장하지 못했습니다: ${result.error.message}`);
  }

  const payload = firstRow(result.data);
  if (!payload || typeof payload !== "object") {
    throw new Error("신뢰성 이벤트 저장 결과가 비어 있습니다.");
  }
  return payload as ReliabilityIngestResult;
}

export async function ingestReliabilityEvents(inputs: ReliabilityEventInput[]) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) {
    throw new TypeError("신뢰성 이벤트 배치는 1~50건이어야 합니다.");
  }

  // Normalize the complete batch before any database write. If one event is
  // malformed, fail before the atomic RPC so callers never see partial ingest.
  const events = inputs.map((input) => normalizeReliabilityEvent(input));
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    throw new Error("OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.");
  }

  const result = await admin.rpc("ingest_reliability_events", {
    p_events: events,
  });
  if (result.error) {
    throw new Error(
      `신뢰성 이벤트 배치를 저장하지 못했습니다: ${result.error.message}`,
    );
  }

  const payload = batchPayload(result.data);
  if (!payload || payload.accepted !== events.length || payload.results.length !== events.length) {
    throw new Error("신뢰성 이벤트 배치 저장 결과가 올바르지 않습니다.");
  }
  return payload;
}
