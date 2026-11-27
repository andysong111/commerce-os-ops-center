import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWorkQueue, emptyQueue, publicQueue } from "../../shared/mobile-work-queue.mjs";

const TABLE = "commerce_os_remote_work_center";
type QueueState = ReturnType<typeof emptyQueue>;
type Row = { revision: string; queue: QueueState };

export async function runMobileWorkQueue(ownerId: string, event?: Record<string, unknown>, agent = false) {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("MOBILE_WORK_QUEUE_NOT_CONFIGURED");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await db.from(TABLE).select("revision,queue").eq("owner_id", ownerId).maybeSingle();
    if (stored.error) throw new Error("MOBILE_WORK_QUEUE_READ_FAILED");
    const row = stored.data as Row | null;
    const state = row?.queue ?? emptyQueue();
    const now = Date.now();
    if (!event) return { status: 200, body: { ok: true, ...publicQueue(state, now) } };
    const result = applyWorkQueue(state, event, now);
    if (result.state) {
      const values = { revision: randomUUID(), queue: result.state };
      const written = row
        ? await db.from(TABLE).update(values).eq("owner_id", ownerId).eq("revision", row.revision).select("revision")
        : await db.from(TABLE).upsert({ owner_id: ownerId, ...values }, { onConflict: "owner_id", ignoreDuplicates: true }).select("revision");
      // An ambiguous DB response never authorizes a worker to execute.
      if (written.error) throw new Error("MOBILE_WORK_QUEUE_WRITE_FAILED");
      if (!Array.isArray(written.data) || written.data.length !== 1) continue;
    }
    const ok = result.status < 400;
    const body = agent ? { ok, command: result.command ?? null } : { ok, ...publicQueue(result.state ?? state, now) };
    return { status: result.status, body: { ...body, code: result.code } };
  }
  return { status: 409, body: { ok: false, code: "QUEUE_CONFLICT" } };
}
