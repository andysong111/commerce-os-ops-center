import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig, readProductLaunchState, resolveProductLaunchIdentity,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import {
  readProductLaunchNormalizedItems, readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  findSaurusBatch, insertSaurusBatch, listSaurusBatches, saveSaurusBatch, SaurusStoreError,
} from "@/lib/aiSaurusBulkDetailStore";
import {
  newSaurusBatch, object, parseSaurusSelection, refreshSaurusPreparation, saurusSelectionHash, updateSaurusPreparation,
} from "@/lib/aiSaurusBulkDetailCore";
import { AI_SAURUS_CONNECTION } from "@/lib/aiSaurusBulkDetailTypes";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function result(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function handleError(error: unknown) {
  if (error instanceof SaurusStoreError) return result({ ok: false, message: error.message }, error.status);
  console.error("[ai-saurus-bulk-detail]", error instanceof Error ? error.name : "unknown");
  return result({ ok: false, message: "AI 사우루스 작업 준비를 처리하지 못했습니다." }, 503);
}

async function readSelectedLaunchItems(config: ProductLaunchAdminConfig, owner: string, ids: string[]) {
  try {
    const workspace = await readProductLaunchNormalizedWorkspace(config, owner);
    if (workspace?.normalized_read_enabled) {
      const items = await readProductLaunchNormalizedItems(config, owner, ids);
      if (items.length === ids.length) return items.map(object);
    }
  } catch (error) {
    console.warn("[ai-saurus-bulk-detail] normalized product read", error instanceof Error ? error.name : "unknown");
  }
  const state = object((await readProductLaunchState(config, owner))?.state_payload);
  return Array.isArray(state.items) ? state.items.map(object) : [];
}

export async function GET(request: NextRequest) {
  const auth = await resolveProductLaunchIdentity(request);
  if (!auth.ok) return result(auth.body, auth.status);
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return result(config.body, config.status);
  const owner = auth.value.userId;
  const id = request.nextUrl.searchParams.get("batch");
  if (id !== null && !UUID.test(id)) return result({ ok: false, message: "잘못된 작업 묶음입니다." }, 400);
  try {
    const [batch, batches] = await Promise.all([
      id ? findSaurusBatch(config.value, owner, { id }) : null,
      listSaurusBatches(config.value, owner),
    ]);
    if (id && !batch) return result({ ok: false, message: "작업 묶음을 찾지 못했습니다." }, 404);
    return result({ ok: true, connection: AI_SAURUS_CONNECTION, batches, batch });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await resolveProductLaunchIdentity(request);
  if (!auth.ok) return result(auth.body, auth.status);
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return result(config.body, config.status);
  const owner = auth.value.userId;
  const input = object(await request.json().catch(() => null));
  const now = new Date().toISOString();
  // No branch in this route can call the producer, verify a browser session, or
  // publish a URL. A future authenticated worker and verified receipts are prerequisites.
  if (["start", "approve", "retry", "receipt"].includes(String(input.action))) {
    return result({ ok: false, code: "AI_SAURUS_CONNECTION_LOCKED", message: "AI 사우루스 실제 연결은 준비 단계에서 잠겨 있습니다." }, 409);
  }
  try {
    if (input.action === "create") {
      let ids: string[];
      try { ids = parseSaurusSelection(input.itemIds); }
      catch (error) { return result({ ok: false, message: (error as Error).message }, 400); }
      const previous = await findSaurusBatch(config.value, owner, { selectionHash: saurusSelectionHash(ids) });
      const items = await readSelectedLaunchItems(config.value, owner, ids);
      let batch;
      try {
        batch = newSaurusBatch(previous?.id ?? randomUUID(), ids, items, now);
      } catch (error) {
        return result({ ok: false, message: (error as Error).message }, 409);
      }
      if (previous) {
        const refreshed = refreshSaurusPreparation(previous, batch);
        const saved = refreshed === previous ? previous : await saveSaurusBatch(config.value, owner, refreshed);
        return result({ ok: true, batch: saved, connection: AI_SAURUS_CONNECTION });
      }
      const saved = await insertSaurusBatch(config.value, owner, batch);
      return result({ ok: true, batch: saved, connection: AI_SAURUS_CONNECTION }, 201);
    }
    if (!["save", "prepare"].includes(String(input.action)) ||
        typeof input.batchId !== "string" || !UUID.test(input.batchId) || !Number.isInteger(input.revision)) {
      return result({ ok: false, message: "작업 묶음과 저장 요청을 확인해 주세요." }, 400);
    }
    const batch = await findSaurusBatch(config.value, owner, { id: input.batchId });
    if (!batch) return result({ ok: false, message: "작업 묶음을 찾지 못했습니다." }, 404);
    if (input.revision !== batch.revision) {
      return result({ ok: false, message: "다른 곳에서 작업을 수정했습니다. 새로고침 후 다시 저장해 주세요." }, 409);
    }
    let next;
    try { next = updateSaurusPreparation(batch, input.edits, input.action === "prepare", now); }
    catch (error) { return result({ ok: false, message: (error as Error).message }, 400); }
    const saved = await saveSaurusBatch(config.value, owner, next);
    return result({ ok: true, batch: saved, connection: AI_SAURUS_CONNECTION });
  } catch (error) {
    return handleError(error);
  }
}
