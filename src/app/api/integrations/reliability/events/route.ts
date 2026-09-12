import { NextResponse } from "next/server";
import { authorizeReliabilityIngest } from "@/lib/reliability/reliabilityIngestAuth";
import { ingestReliabilityEvents } from "@/lib/reliability/reliabilityStore";
import type { ReliabilityEventInput } from "@/lib/reliability/reliabilityEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64_000;
const MAX_BATCH_SIZE = 50;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function asEvents(value: unknown): ReliabilityEventInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("이벤트 본문은 객체여야 합니다.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.events)) return [record as ReliabilityEventInput];
  if (record.events.length === 0 || record.events.length > MAX_BATCH_SIZE) {
    throw new TypeError(`배치 이벤트는 1~${MAX_BATCH_SIZE}건만 허용됩니다.`);
  }
  return record.events as ReliabilityEventInput[];
}

export async function POST(request: Request) {
  const authorization = authorizeReliabilityIngest(request);
  if (!authorization.ok) {
    return errorResponse(
      authorization.status,
      authorization.code,
      authorization.message,
    );
  }

  const bodyText = await request.text();
  if (!bodyText || Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "RELIABILITY_EVENT_BODY_INVALID",
      "신뢰성 이벤트 본문이 비었거나 허용 크기를 초과했습니다.",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return errorResponse(
      400,
      "RELIABILITY_EVENT_JSON_INVALID",
      "신뢰성 이벤트 JSON을 해석하지 못했습니다.",
    );
  }

  try {
    const events = asEvents(payload);
    const batch = await ingestReliabilityEvents(events);
    return NextResponse.json(
      {
        ok: true,
        accepted: batch.accepted,
        duplicates: batch.duplicates,
        results: batch.results,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "신뢰성 이벤트를 처리하지 못했습니다.";
    const invalid = error instanceof TypeError;
    return errorResponse(
      invalid ? 400 : 503,
      invalid
        ? "RELIABILITY_EVENT_VALIDATION_FAILED"
        : "RELIABILITY_EVENT_INGEST_FAILED",
      message,
    );
  }
}
