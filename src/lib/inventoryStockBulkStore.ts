import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InventoryBulkOperationInput = {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  snapshot: unknown;
  actorType?: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function storeInventoryOperationBatch(
  inputs: InventoryBulkOperationInput[],
) {
  if (!inputs.length) throw new Error("INVENTORY_BATCH_EMPTY");
  if (inputs.length > 50) throw new Error("INVENTORY_BATCH_TOO_LARGE");
  const sourceIds = inputs.map((input) => input.sourceEventId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("INVENTORY_BATCH_SOURCE_EVENT_DUPLICATE");
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const now = new Date().toISOString();
  const rows = inputs.map((input) => {
    const occurredAt = iso(object(input.snapshot).occurredAt) || now;
    return {
      operation_type: input.operationType,
      status: "SUCCEEDED",
      source: "COMMERCE_OS_INVENTORY_STOCK_CONTROL",
      source_event_id: input.sourceEventId,
      correlation_id: input.correlationId,
      actor_type: input.actorType || "OPS_OPERATOR",
      input_snapshot: input.snapshot,
      result_snapshot: {
        accepted: true,
        snapshot: input.snapshot,
      },
      error_message: null,
      started_at: occurredAt,
      finished_at: occurredAt,
      updated_at: occurredAt,
    };
  });

  const written = await admin
    .from("commerce_operation_runs")
    .upsert(rows, { onConflict: "source_event_id", ignoreDuplicates: true })
    .select("source_event_id");
  if (written.error) {
    throw new Error(`INVENTORY_BATCH_STORE_FAILED:${written.error.message}`);
  }

  const readback = await admin
    .from("commerce_operation_runs")
    .select("source_event_id")
    .in("source_event_id", sourceIds)
    .limit(sourceIds.length + 1);
  if (readback.error) {
    throw new Error(`INVENTORY_BATCH_READBACK_FAILED:${readback.error.message}`);
  }
  const visible = new Set(
    (Array.isArray(readback.data) ? readback.data : [])
      .map((row) => String((row as Record<string, unknown>).source_event_id ?? ""))
      .filter(Boolean),
  );
  const missing = sourceIds.filter((sourceId) => !visible.has(sourceId));
  if (missing.length) {
    throw new Error(`INVENTORY_BATCH_PERSISTENCE_NOT_VISIBLE:${missing.join(",")}`);
  }

  const insertedCount = Array.isArray(written.data) ? written.data.length : 0;
  return {
    requestedCount: inputs.length,
    insertedCount,
    duplicateCount: Math.max(0, inputs.length - insertedCount),
    sourceEventIds: sourceIds,
  };
}
