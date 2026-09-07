import { NextRequest } from "next/server";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function modelNumbers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, 100);
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const body = record(await request.json().catch(() => ({})));
  const models = modelNumbers(body.modelNumbers);
  if (!models.length) {
    return Response.json(
      { ok: false, message: "동기화할 이전상품을 1개 이상 선택하세요." },
      { status: 400 },
    );
  }

  try {
    const result = await syncLegacySeoShoplingOptions({
      config: context.config,
      identity: context.identity,
      modelNumbers: models,
    });
    const warnings = result.results
      .filter((row) => !row.changed)
      .map((row) => `${row.modelNumber}:${row.reason}`);
    return Response.json({
      ok: true,
      requestedCount: models.length,
      changedCount: result.changedCount,
      warnings,
      results: result.results,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
