import { NextRequest } from "next/server";
import { resolveSourcingRequestContext } from "@/lib/sourcingOrganization";
import { cardToRecommendationRow, normalizeRecommendationCardPayload, notConfiguredResponse, validateSourcingStorageConfig } from "@/lib/sourcingServerStorage";

export async function GET() {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  const { data, error } = await resolved.context.supabase
    .from("recommendation_cards")
    .select("card_payload, created_at")
    .eq("organization_id", resolved.context.organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ ok: false, code: "SUPABASE_QUERY_FAILED", message: error.message }, { status: 500 });

  const rows = Array.isArray(data) ? (data as { card_payload: unknown }[]) : [];

  return Response.json({ ok: true, cards: rows.map((row) => row.card_payload) });
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
    .select("card_payload")
    .single();

  if (error) return Response.json({ ok: false, code: "SUPABASE_WRITE_FAILED", message: error.message }, { status: 500 });

  return Response.json({ ok: true, card: (data as { card_payload: unknown }).card_payload }, { status: 201 });
}
