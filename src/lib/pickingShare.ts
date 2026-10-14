import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TABLE = "commerce_os_picking_snapshots";

export type PickingShareItem = {
  barcode: string;
  quantity: number;
  modelNames: string[];
  modelNumbers: string[];
  productNames: string[];
  optionNames: string[];
  picked: boolean;
};

export type PickingSharePayload = {
  snapshotId: string;
  date: string;
  createdAt: string;
  source: string;
  status: string;
  summary: Record<string, number>;
  items: PickingShareItem[];
  delta: {
    addedQuantity: number;
    changedQuantity: number;
    removedQuantity: number;
    quantityToPick: number;
    addedOrderCount: number;
    changedOrderCount: number;
    removedOrderCount: number;
    toPickItems: Array<{
      barcode: string;
      quantityToPick: number;
      modelNames: string[];
      modelNumbers: string[];
      productNames: string[];
      optionNames: string[];
    }>;
  };
  unresolved: Array<Record<string, unknown>>;
};

type PickingRow = {
  payload: PickingSharePayload;
  completed: Record<string, { pickedQuantity: number; completedAt: string; completed?: boolean }>;
  updated_at: string;
  expires_at: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validPickingShareToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function asPickingRow(value: unknown): PickingRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PickingRow>;
  if (!row.payload || !Array.isArray(row.payload.items) || !row.completed || typeof row.completed !== "object") return null;
  return row as PickingRow;
}

export async function readPickingShare(token: string) {
  if (!validPickingShareToken(token)) return { ok: false as const, status: 404, code: "PICKING_SHARE_NOT_FOUND" };
  const admin = await createSupabaseAdminClient();
  if (!admin) return { ok: false as const, status: 503, code: "PICKING_SHARE_STORAGE_UNAVAILABLE" };
  const result = await admin
    .from(TABLE)
    .select("payload,completed,updated_at,expires_at")
    .eq("token_hash", tokenHash(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (result.error) return { ok: false as const, status: 503, code: "PICKING_SHARE_READ_FAILED" };
  const row = asPickingRow(result.data);
  if (!row) return { ok: false as const, status: 404, code: "PICKING_SHARE_NOT_FOUND" };
  const items = row.payload.items.map((item) => ({
    ...item,
    picked: row.completed[item.barcode]?.completed === false
      ? false
      : Boolean(row.completed[item.barcode]) || item.picked === true,
    completedAt: row.completed[item.barcode]?.completedAt || null,
  }));
  return {
    ok: true as const,
    value: { ...row.payload, items, updatedAt: row.updated_at, expiresAt: row.expires_at },
  };
}

export async function updatePickingShareCompletion(token: string, barcode: string, completed: boolean) {
  if (!validPickingShareToken(token)) return { ok: false as const, status: 404, code: "PICKING_SHARE_NOT_FOUND" };
  if (!/^[A-Z]{3}\d+-\d+$/.test(barcode)) return { ok: false as const, status: 400, code: "PICKING_BARCODE_INVALID" };
  const admin = await createSupabaseAdminClient();
  if (!admin) return { ok: false as const, status: 503, code: "PICKING_SHARE_STORAGE_UNAVAILABLE" };
  const hash = tokenHash(token);

  // Completion is stored as one JSON object. Compare updated_at so two phones or
  // tabs cannot silently overwrite each other's nearly simultaneous checks.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date().toISOString();
    const lookup = await admin
      .from(TABLE)
      .select("payload,completed,updated_at,expires_at")
      .eq("token_hash", hash)
      .gt("expires_at", now)
      .maybeSingle();
    if (lookup.error) return { ok: false as const, status: 503, code: "PICKING_SHARE_READ_FAILED" };
    const row = asPickingRow(lookup.data);
    const item = row?.payload.items.find((value) => value.barcode === barcode);
    if (!row || !item) return { ok: false as const, status: 404, code: "PICKING_ITEM_NOT_FOUND" };

    const completion = completed
      ? { pickedQuantity: item.quantity, completedAt: now }
      : { pickedQuantity: 0, completedAt: now, completed: false };
    const next = { ...row.completed, [barcode]: completion };
    const update = await admin
      .from(TABLE)
      .update({ completed: next, updated_at: now })
      .eq("token_hash", hash)
      .eq("updated_at", row.updated_at)
      .gt("expires_at", now);
    if (update.error) return { ok: false as const, status: 503, code: "PICKING_SHARE_UPDATE_FAILED" };
    if (Array.isArray(update.data) && update.data.length > 0) {
      return { ok: true as const, value: completion };
    }
  }

  return { ok: false as const, status: 409, code: "PICKING_SHARE_CONFLICT" };
}
