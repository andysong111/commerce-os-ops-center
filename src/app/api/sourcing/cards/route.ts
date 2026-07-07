import { NextRequest } from "next/server";
import { resolveSourcingRequestContext } from "@/lib/sourcingOrganization";
import { cardToRecommendationRow, normalizeRecommendationCardPayload, notConfiguredResponse, validateSourcingStorageConfig } from "@/lib/sourcingServerStorage";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET() {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  const { data, error } = await resolved.context.supabase
    .from("recommendation_cards")
    .select("id, card_payload, created_at")
    .eq("organization_id", resolved.context.organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ ok: false, code: "SUPABASE_QUERY_FAILED", message: error.message }, { status: 500 });

  const rows = Array.isArray(data) ? (data as { id: string; card_payload: unknown; created_at?: string }[]) : [];
  const cards = rows.map((row) => {
    const payload = row.card_payload && typeof row.card_payload === "object" ? row.card_payload : {};
    return { ...payload, serverId: row.id, serverCreatedAt: row.created_at };
  });

  return Response.json({ ok: true, cards });
}

export async function POST(request: NextRequest) {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  let card;
  try {
    card = normalizeRecommendationCardPayload(await request.json());
  } catch (error) {
    return Response.json({ ok: false, code: "INVALID_CARD_PAYLOAD", message: error instanceof Error ? error.message : "Invalid card payload." }, { status: 400 });
  }

  const { data, error } = await resolved.context.supabase
    .from("recommendation_cards")
    .insert(cardToRecommendationRow(card, resolved.context.organizationId))
    .select("id, card_payload, created_at")
    .single();

  if (error) return Response.json({ ok: false, code: "SUPABASE_WRITE_FAILED", message: error.message }, { status: 500 });

  const row = data as { id: string; card_payload: unknown; created_at?: string };
  const payload = row.card_payload && typeof row.card_payload === "object" ? row.card_payload : {};
  return Response.json({ ok: true, card: { ...payload, serverId: row.id, serverCreatedAt: row.created_at } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!isUuid(id)) {
    return Response.json({ ok: false, code: "INVALID_CARD_ID", message: "A valid server card id is required." }, { status: 400 });
  }

  const { error } = await resolved.context.supabase
    .from("recommendation_cards")
    .delete()
    .eq("organization_id", resolved.context.organizationId)
    .eq("id", id);

  if (error) return Response.json({ ok: false, code: "SUPABASE_DELETE_FAILED", message: error.message }, { status: 500 });

  return Response.json({ ok: true, deletedId: id });
}
