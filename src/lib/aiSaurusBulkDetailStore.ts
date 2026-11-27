import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import type { ProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import type { AiSaurusDetailBatch } from "./aiSaurusBulkDetailTypes";

const TABLE = "ai_saurus_detail_batches";

type StoredBatch = {
  id: string;
  updated_at: string;
  revision: number;
  payload: AiSaurusDetailBatch;
};

export class SaurusStoreError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function query(
  config: ProductLaunchAdminConfig, params: URLSearchParams, init: RequestInit = {},
): Promise<StoredBatch[]> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${TABLE}?${params}`, {
    ...init,
    headers: { ...createSupabaseAdminHeaders(config.secretKey), ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) {
    if (body?.code === "PGRST205" || body?.code === "42P01") {
      throw new SaurusStoreError("AI 사우루스 작업 원장이 아직 설치되지 않았습니다.", 503);
    }
    throw new SaurusStoreError("AI 사우루스 작업 원장을 읽거나 저장하지 못했습니다.", 503);
  }
  return body;
}

function ownerQuery(ownerId: string) {
  return new URLSearchParams({ owner_id: `eq.${ownerId}`, select: "id,updated_at,revision,payload" });
}

function readPayload(row: StoredBatch | undefined) {
  if (!row) return null;
  if (row.payload?.id !== row.id || row.revision !== row.payload.revision || !Array.isArray(row.payload.products)) {
    throw new SaurusStoreError("저장된 작업 원장과 작업 내용이 일치하지 않습니다.", 503);
  }
  return row.payload;
}

export async function listSaurusBatches(config: ProductLaunchAdminConfig, owner: string) {
  const params = ownerQuery(owner);
  params.set("order", "updated_at.desc");
  params.set("limit", "15");
  return (await query(config, params)).map((row) => {
    const batch = readPayload(row)!;
    return { id: batch.id, updatedAt: batch.updatedAt, count: batch.products.length };
  });
}

export async function findSaurusBatch(
  config: ProductLaunchAdminConfig, owner: string, filter: { id: string } | { selectionHash: string },
) {
  const params = ownerQuery(owner);
  params.set("limit", "1");
  if ("id" in filter) params.set("id", `eq.${filter.id}`);
  else params.set("selection_hash", `eq.${filter.selectionHash}`);
  return readPayload((await query(config, params))[0]);
}

export async function insertSaurusBatch(config: ProductLaunchAdminConfig, owner: string, batch: AiSaurusDetailBatch) {
  const params = new URLSearchParams({ on_conflict: "owner_id,selection_hash" });
  await query(config, params, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      id: batch.id, owner_id: owner, selection_hash: batch.selectionHash, revision: batch.revision,
      payload: batch, created_at: batch.createdAt, updated_at: batch.updatedAt,
    }),
  });
  const current = await findSaurusBatch(config, owner, { selectionHash: batch.selectionHash });
  if (!current) throw new SaurusStoreError("작업 원장 저장 결과를 확인하지 못했습니다.", 503);
  return current;
}

export async function saveSaurusBatch(config: ProductLaunchAdminConfig, owner: string, batch: AiSaurusDetailBatch) {
  const params = ownerQuery(owner);
  params.set("id", `eq.${batch.id}`);
  params.set("revision", `eq.${batch.revision - 1}`);
  const rows = await query(config, params, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ revision: batch.revision, payload: batch, updated_at: batch.updatedAt }),
  });
  const saved = readPayload(rows[0]);
  if (rows.length !== 1 || saved?.revision !== batch.revision) {
    throw new SaurusStoreError("다른 곳에서 작업을 수정했습니다. 새로고침 후 다시 저장해 주세요.", 409);
  }
  return saved;
}
