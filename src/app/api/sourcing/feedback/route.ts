import { NextRequest } from "next/server";
import { resolveSourcingRequestContext } from "@/lib/sourcingOrganization";
import { feedbackToRow, normalizeFeedbackPayload, notConfiguredResponse, validateSourcingStorageConfig } from "@/lib/sourcingServerStorage";

export async function GET() {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  const { data, error } = await resolved.context.supabase
    .from("sourcing_feedback")
    .select("card_id, human_order_decision, sales_result, reordered, failure_reasons, memo, created_at")
    .eq("organization_id", resolved.context.organizationId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return Response.json({ ok: false, code: "SUPABASE_QUERY_FAILED", message: error.message }, { status: 500 });

  const rows = Array.isArray(data)
    ? (data as { card_id: string | null; human_order_decision: string; sales_result: string; reordered: boolean; failure_reasons: string[] | null; memo: string | null; created_at: string }[])
    : [];

  return Response.json({
    ok: true,
    feedback: rows.map((row) => ({
      cardId: row.card_id ?? "",
      mode: "FOLLOW_PROVEN",
      categoryHint: "",
      humanOrderDecision: row.human_order_decision,
      salesResult: row.sales_result,
      reordered: row.reordered,
      failureReasons: row.failure_reasons ?? [],
      memo: row.memo ?? "",
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const config = validateSourcingStorageConfig();
  if (!config.ok) return notConfiguredResponse(config);

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) return Response.json(resolved.body, { status: resolved.status });

  let feedback;
  try {
    feedback = normalizeFeedbackPayload(await request.json());
  } catch (error) {
    return Response.json({ ok: false, code: "INVALID_FEEDBACK_PAYLOAD", message: error instanceof Error ? error.message : "Invalid feedback payload." }, { status: 400 });
  }

  const { data, error } = await resolved.context.supabase
    .from("sourcing_feedback")
    .insert(feedbackToRow(feedback, resolved.context.organizationId))
    .select("id")
    .single();

  if (error) return Response.json({ ok: false, code: "SUPABASE_WRITE_FAILED", message: error.message }, { status: 500 });

  return Response.json({ ok: true, id: (data as { id: string }).id, feedback }, { status: 201 });
}
