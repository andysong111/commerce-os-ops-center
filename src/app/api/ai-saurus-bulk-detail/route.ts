import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PATCH as updateLaunchTracker } from "../product-launch-tracker/optimized/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  confirmSaurusApprovalReadback, newSaurusBatch, object, parseSaurusSelection, planSaurusApproval,
  refreshSaurusPreparation, requireSaurusSourcingItems, saurusSelectionHash, updateSaurusPreparation,
} from "@/lib/aiSaurusBulkDetailCore";
import { AI_SAURUS_CONNECTION } from "@/lib/aiSaurusBulkDetailTypes";
import { opsDetailSecret } from "@/lib/opsDetailDispatch";
import {
  browserLaunchUrl, readOpsSaurusRelease, readOpsSaurusStatus, reconcileOpsSaurusStatus, replaceProduct, startOpsSaurusProduct,
} from "@/lib/aiSaurusBulkDetailProvider";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function result(body: object, status = 200) {
  const output = JSON.stringify(body, (key, value) => key === "email" ? undefined : value);
  return new Response(output, { status, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" } });
}

function handleError(error: unknown) {
  if (error instanceof SaurusStoreError) return result({ ok: false, message: error.message }, error.status);
  console.error("[ai-saurus-bulk-detail]", error instanceof Error ? error.name : "unknown");
  return result({ ok: false, message: "AI 사우루스 작업 준비를 처리하지 못했습니다." }, 503);
}

function connection() {
  return opsDetailSecret() ? "connected" : AI_SAURUS_CONNECTION;
}

async function requireOperatorEmail(owner: string) {
  const supabase = await createSupabaseServerClient();
  const auth = await supabase?.auth.getUser();
  return auth?.data.user?.id === owner ? auth.data.user.email?.trim().toLowerCase() || "" : "";
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
    const [batch, batches, release] = await Promise.all([
      id ? findSaurusBatch(config.value, owner, { id }) : null,
      listSaurusBatches(config.value, owner),
      connection() === "connected" ? readOpsSaurusRelease().catch(() => null) : null,
    ]);
    if (id && !batch) return result({ ok: false, message: "작업 묶음을 찾지 못했습니다." }, 404);
    return result({ ok: true, connection: release?.sourceReview ? connection() : AI_SAURUS_CONNECTION,
      batches, batch, maxCredits: release?.maxCredits ?? null });
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
  const live = ["start", "resume", "refresh", "approve", "retry", "clear_queue"].includes(String(input.action));
  if (live && connection() !== "connected") {
    return result({ ok: false, code: "AI_SAURUS_CONNECTION_LOCKED", message: "AI 사우루스 실제 연결은 준비 단계에서 잠겨 있습니다." }, 409);
  }
  const email = connection() === "connected" ? await requireOperatorEmail(owner) : "";
  if (connection() === "connected" && !email) {
    return result({ ok: false, message: "제작 작업을 사용하려면 OPS에 로그인해 주세요." }, 401);
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
        requireSaurusSourcingItems(items, ids);
        batch = newSaurusBatch(previous?.id ?? randomUUID(), ids, items, now);
      } catch (error) {
        return result({ ok: false, message: (error as Error).message }, 409);
      }
      if (previous) {
        const refreshed = refreshSaurusPreparation(previous, batch);
        const saved = refreshed === previous ? previous : await saveSaurusBatch(config.value, owner, refreshed);
        return result({ ok: true, batch: saved, connection: connection() });
      }
      const saved = await insertSaurusBatch(config.value, owner, batch);
      return result({ ok: true, batch: saved, connection: connection() }, 201);
    }
    if ((!live && !["save", "prepare"].includes(String(input.action))) ||
        typeof input.batchId !== "string" || !UUID.test(input.batchId) || !Number.isInteger(input.revision)) {
      return result({ ok: false, message: "작업 묶음과 저장 요청을 확인해 주세요." }, 400);
    }
    const batch = await findSaurusBatch(config.value, owner, { id: input.batchId });
    if (!batch) return result({ ok: false, message: "작업 묶음을 찾지 못했습니다." }, 404);
    if (input.revision !== batch.revision) {
      return result({ ok: false, message: "다른 곳에서 작업을 수정했습니다. 새로고침 후 다시 저장해 주세요." }, 409);
    }
    if (live) {
      if (input.action === "clear_queue") {
        const next = { ...batch, queuedIds: [], updatedAt: now, revision: batch.revision + 1 };
        return result({ ok: true, batch: await saveSaurusBatch(config.value, owner, next) });
      }
      const ids = parseSaurusSelection(input.itemIds);
      const selected = ids.map((id) => batch.products.find((product) => product.id === id));
      if (selected.some((product) => !product || (product.dispatch && product.dispatch.email !== email))) {
        return result({ ok: false, message: "이 계정으로 선택한 제작 작업을 사용할 수 없습니다." }, 403);
      }
      if (input.action === "start" || input.action === "resume" || input.action === "refresh") {
        if (ids.length !== 1) return result({ ok: false, message: "제작 작업은 상품별로 실행됩니다." }, 400);
        const product = selected[0]!;
        if (input.action === "start") {
          const queuedIds = input.queueIds === undefined ? batch.queuedIds ?? [] : parseSaurusSelection(input.queueIds);
          if ((batch.queuedIds?.length && input.queueIds !== undefined) ||
              (queuedIds.length && queuedIds[0] !== ids[0]) ||
              queuedIds.some((id) => !batch.products.some((row) => row.id === id && row.stage === "waiting_connection"))) {
            return result({ ok: false, message: "저장된 제작 순서와 선택한 상품이 일치하지 않습니다." }, 409);
          }
          const selectedIds = queuedIds.length ? queuedIds : ids;
          const [release, currentItems] = await Promise.all([
            readOpsSaurusRelease(), readSelectedLaunchItems(config.value, owner, selectedIds),
          ]);
          if (!release.sourceReview) {
            return result({ ok: false, message: "AI 사우루스의 1688 수집 후 검토 기능을 확인하지 못했습니다." }, 409);
          }
          if (input.maxCredits !== release.maxCredits) {
            return result({ ok: false, message: "제작에 필요한 크레딧이 변경됐습니다. 작업판을 새로고침해 확인해 주세요." }, 409);
          }
          try { requireSaurusSourcingItems(currentItems, selectedIds); }
          catch (error) { return result({ ok: false, message: (error as Error).message }, 409); }
          const current = newSaurusBatch(batch.id, ids, currentItems, now).products[0];
          if (product.reviewOptions === undefined || current.sourceUrl !== product.sourceUrl || current.name !== product.name ||
              JSON.stringify(current.reviewOptions) !== JSON.stringify(product.reviewOptions) ||
              current.originalDetailImageUrl !== product.originalDetailImageUrl) {
            return result({ ok: false, message: "상품 정보가 변경됐습니다. 상품출시 진행관리에서 다시 선택해 주세요." }, 409);
          }
          const start = startOpsSaurusProduct(batch, ids[0], email, now, release);
          const launchUrl = browserLaunchUrl(start.product);
          const saved = await saveSaurusBatch(config.value, owner, { ...start.batch, queuedIds: queuedIds.slice(1) });
          return result({ ok: true, batch: saved, launchUrl });
        }
        if (product.stage !== "running") return result({ ok: true, batch });
        const providerStatus = await readOpsSaurusStatus(product);
        const current = reconcileOpsSaurusStatus(product, providerStatus, Date.now());
        if (input.action === "resume" && current.stage === "running" && current.dispatch && !current.dispatch.providerJobId) {
          const currentItems = await readSelectedLaunchItems(config.value, owner, ids);
          try { requireSaurusSourcingItems(currentItems, ids); }
          catch (error) { return result({ ok: false, message: (error as Error).message }, 409); }
          const latest = newSaurusBatch(batch.id, ids, currentItems, now).products[0];
          if (current.reviewOptions === undefined || latest.sourceUrl !== current.sourceUrl || latest.name !== current.name ||
              latest.originalDetailImageUrl !== current.originalDetailImageUrl ||
              JSON.stringify(latest.reviewOptions) !== JSON.stringify(current.reviewOptions)) {
            return result({ ok: false, message: "상품 정보나 수집 방식이 변경됐습니다. 상품출시 진행관리에서 상품을 다시 선택해 주세요." }, 409);
          }
          const release = await readOpsSaurusRelease();
          if (!release.sourceReview) {
            return result({ ok: false, message: "AI 사우루스의 1688 수집 후 검토 기능을 확인하지 못했습니다." }, 409);
          }
          if (current.dispatch.maxCredits !== release.maxCredits) {
            return result({ ok: false, message: "제작 크레딧이 바뀌었습니다. 현재 수집 요청을 만료시킨 뒤 다시 준비해 주세요." }, 409);
          }
          const resumed = current.dispatch.deployment === release.deployment ? current : {
            ...current, dispatch: { ...current.dispatch, importer: release.importer, deployment: release.deployment, startedAt: now },
          };
          const launchUrl = browserLaunchUrl(resumed);
          const saved = resumed === product ? batch : await saveSaurusBatch(config.value, owner, replaceProduct(batch, resumed, now));
          return result({ ok: true, batch: saved, launchUrl });
        }
        const saved = current === product ? batch : await saveSaurusBatch(config.value, owner, replaceProduct(batch, current, now));
        return result({ ok: true, batch: saved });
      }
      if (input.action === "retry") {
        const items = await readSelectedLaunchItems(config.value, owner, ids);
        try { requireSaurusSourcingItems(items, ids); }
        catch (error) { return result({ ok: false, message: (error as Error).message }, 409); }
        if (selected.some((product) => product?.stage !== "failed" || product.attempts >= 2 || !product.dispatch)) {
          return result({ ok: false, message: "비용 처리가 확인된 실패 상품만 한 번 더 준비할 수 있습니다." }, 409);
        }
        for (const product of selected) {
          const current = await readOpsSaurusStatus(product!);
          if (current.state !== "failed" && (current.state !== "collecting" || product?.dispatch?.providerJobId)) {
            return result({ ok: false, message: "이전 제작의 최종 상태가 아직 확인되지 않았습니다." }, 409);
          }
        }
        const next = { ...batch, updatedAt: now, revision: batch.revision + 1,
          products: batch.products.map((product) => ids.includes(product.id) ? { ...product, stage: "waiting_connection" as const, error: undefined } : product) };
        return result({ ok: true, batch: await saveSaurusBatch(config.value, owner, next) });
      }
      const launchRow = await readProductLaunchState(config.value, owner);
      const items = object(launchRow?.state_payload).items;
      if (!launchRow?.updated_at || !Array.isArray(items)) return result({ ok: false, message: "진행관리 상품을 확인하지 못했습니다." }, 409);
      const launchItems = items.map(object);
      const normalized = await readSelectedLaunchItems(config.value, owner, ids);
      planSaurusApproval(batch, ids, normalized);
      const planned = planSaurusApproval(batch, ids, launchItems);
      const patches = planned.flatMap((item, index) => item === launchItems[index] ? [] : [{
        itemId: item.id, patch: { detailPageAsset: { detailImageUrl: object(item.detailPageAsset).detailImageUrl } },
      }]);
      if (patches.length) {
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        const write = await updateLaunchTracker(new NextRequest(request.url, {
          method: "PATCH", headers,
          body: JSON.stringify({ operation: "bulk_patch_items", expectedStateUpdatedAt: launchRow.updated_at, patches }),
        }));
        if (!write.ok) return result(await write.json(), write.status);
      }
      const readback = await readSelectedLaunchItems(config.value, owner, ids);
      const next = confirmSaurusApprovalReadback(batch, ids, readback, now);
      return result({ ok: true, batch: await saveSaurusBatch(config.value, owner, next) });
    }
    let next;
    try { next = updateSaurusPreparation(batch, input.edits, input.action === "prepare", now); }
    catch (error) { return result({ ok: false, message: (error as Error).message }, 400); }
    const saved = await saveSaurusBatch(config.value, owner, next);
    return result({ ok: true, batch: saved, connection: connection() });
  } catch (error) {
    return handleError(error);
  }
}
