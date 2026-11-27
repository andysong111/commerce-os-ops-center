import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "./supabase/admin.ts";

const operation = "INTERNAL_CHINA_FORWARDER_INVOICE";
type InvoiceScope = { draftId: string; cycleMonth: string; evidenceHash: string };
export type ForwarderInvoice = { amountKrw: number; revision: string };

export function validInvoiceAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0 && amount <= 1_000_000_000;
}

function eventId(scope: InvoiceScope) {
  return `forwarder-invoice:${scope.draftId}:${scope.evidenceHash}`;
}

async function invoiceStore() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("INVOICE_UNAVAILABLE");
  return admin;
}

export async function loadForwarderInvoice(scope: InvoiceScope): Promise<ForwarderInvoice | null> {
  const store = await invoiceStore();
  const result = await store.from("commerce_operation_runs").select("result_snapshot")
    .eq("operation_type", operation).eq("source_event_id", eventId(scope)).maybeSingle();
  if (result.error) throw new Error("INVOICE_READ_FAILED");
  if (result.data === null) return null;
  const snapshot = (result.data as { result_snapshot?: ForwarderInvoice & InvoiceScope }).result_snapshot;
  if (!snapshot || snapshot.draftId !== scope.draftId || snapshot.cycleMonth !== scope.cycleMonth ||
      snapshot.evidenceHash !== scope.evidenceHash || !validInvoiceAmount(snapshot.amountKrw) || !snapshot.revision) {
    throw new Error("INVOICE_READ_FAILED");
  }
  return { amountKrw: snapshot.amountKrw, revision: snapshot.revision };
}

export async function recordForwarderInvoice(scope: InvoiceScope, amount: unknown, previousRevision: unknown) {
  if (!validInvoiceAmount(amount)) throw new Error("INVOICE_INVALID");
  const previous = await loadForwarderInvoice(scope);
  if (previous?.amountKrw === amount) return previous;
  if ((previous?.revision ?? null) !== previousRevision) throw new Error("INVOICE_CONFLICT");
  const store = await invoiceStore();
  const now = new Date().toISOString();
  const snapshot = { draftId: scope.draftId, cycleMonth: scope.cycleMonth, evidenceHash: scope.evidenceHash,
    amountKrw: amount, revision: randomUUID() };
  const fields = { result_snapshot: snapshot, updated_at: now, finished_at: now };
  const table = store.from("commerce_operation_runs");
  const result = previous
    ? await table.update(fields).eq("operation_type", operation).eq("source_event_id", eventId(scope))
        .eq("result_snapshot->>revision", previous.revision)
    : await table.upsert({
        ...fields, operation_type: operation, status: "SUCCEEDED", source: "ops-center-forwarder-invoice",
        source_event_id: eventId(scope), correlation_id: `purchase-run:${scope.draftId}`,
        actor_type: "OPS_OPERATOR", started_at: now, input_snapshot: { amountKrw: amount },
      }, { onConflict: "source_event_id", ignoreDuplicates: true });
  if (result.error) throw new Error("INVOICE_WRITE_FAILED");
  const saved = await loadForwarderInvoice(scope);
  if (saved?.amountKrw !== amount) throw new Error("INVOICE_CONFLICT");
  return saved;
}
