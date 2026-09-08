import { NextRequest } from "next/server";
import { prepareLegacySeoPreflight } from "@/lib/legacySeoPreflight";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function itemIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, 100);
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  const ids = itemIds(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { itemIds?: unknown }).itemIds
      : [],
  );
  if (!ids.length) {
    return Response.json(
      { ok: false, code: "ITEM_IDS_REQUIRED", message: "이전상품을 1개 이상 선택하세요." },
      { status: 400 },
    );
  }

  const result = await prepareLegacySeoPreflight({
    config: authenticated.value.config,
    identity: authenticated.value.identity,
    itemIds: ids,
  });
  return Response.json({
    ok: result.ok,
    requestedCount: result.requestedCount,
    readyCount: result.readyCount,
    excludedCount: result.excludedCount,
    failedCount: result.failedCount,
    issueCount: result.issueCount,
    optionSyncError: result.optionSyncError,
    canonicalPriceError: result.canonicalPriceError,
    canonicalBatch: result.canonicalPrice?.batch ?? null,
    results: result.results,
  }, { status: result.ok ? 200 : 422 });
}
