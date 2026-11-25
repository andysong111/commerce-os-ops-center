import {
  normalizeShoplingBcodeIndexMoves,
  reconcileShoplingBcodeIndex,
} from "@/lib/shopling/shoplingBcodeIndexReconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export async function POST(request: Request) {
  const supplied = request.headers.get("x-commerce-os-integration-secret")?.trim();
  const allowed = [
    process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim(),
    process.env.AAA022_RECONCILIATION_OPS_SECRET?.trim(),
  ].filter(Boolean);
  if (!supplied || !allowed.includes(supplied)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const mode = text(body.mode) === "apply" ? "apply" : "plan";
    const entries = normalizeShoplingBcodeIndexMoves(body.entries);
    const result = await reconcileShoplingBcodeIndex({
      mode,
      entries,
      source: text(body.source),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SHOPLING_INDEX_RECONCILIATION_FAILED";
    const conflict = /CONFLICT|SOURCE_MISSING|READBACK/.test(detail);
    const invalid = /ENTRY_(?:COUNT_)?INVALID/.test(detail);
    return Response.json(
      { ok: false, error: conflict ? "SHOPLING_INDEX_RECONCILIATION_CONFLICT" : invalid ? "INVALID_REQUEST" : "SHOPLING_INDEX_RECONCILIATION_FAILED", message: detail },
      { status: conflict ? 409 : invalid ? 400 : 503 },
    );
  }
}
