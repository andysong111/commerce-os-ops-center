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
  findSaurusBatch, findSaurusReviewConflict, insertSaurusBatch, listSaurusBatches, saveSaurusBatch,
  saveSaurusReviewBatch, SaurusStoreError,
} from "@/lib/aiSaurusBulkDetailStore";
import {
  confirmSaurusApprovalReadback, newSaurusBatch, object, parseSaurusSelection, planSaurusApproval,
  planSaurusReviewDecision, refreshSaurusPreparation, requireSaurusProductIdentity, requireSaurusSourcingItems,
  reserveSaurusApproval, sameSaurusReviewOptions, saurusBatchRevisionMode, saurusSelectionHash, updateSaurusPreparation,
} from "@/lib/aiSaurusBulkDetailCore";
import { AI_SAURUS_CONNECTION } from "@/lib/aiSaurusBulkDetailTypes";
import {
  sameSaurusLaunchMaterials, saurusLaunchMaterials, saurusManualMaterials, saurusProductBCodes,
  type SaurusLaunchMaterials,
} from "@/lib/aiSaurusLaunchMaterials";
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
  const chosen = new Set(ids);
  return Array.isArray(state.items) ? state.items.map(object).filter(({ id }) => typeof id === "string" && chosen.has(id)) : [];
}

function imagePatch(itemId: string, materials: SaurusLaunchMaterials) {
  return { itemId, patch: { detailPageAsset: materials } };
}

async function saveLaunchImagePatches(request: NextRequest, expectedStateUpdatedAt: string, patches: ReturnType<typeof imagePatch>[]) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return updateLaunchTracker(new NextRequest(request.url, {
    method: "PATCH", headers,
    body: JSON.stringify({ operation: "bulk_patch_items", expectedStateUpdatedAt, patches }),
  }));
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
    const olderResults = batch?.products.filter((item) => !item.bCodes?.length && item.stage !== "draft") ?? [];
    const fresh = olderResults.length ? await readSelectedLaunchItems(config.value, owner, olderResults.map(({ id }) => id)) : [];
    const displayBatch = batch && fresh.length ? { ...batch, products: batch.products.map((item) => {
      const current = !item.bCodes?.length ? fresh.find(({ id }) => id === item.id) : undefined;
      return current ? { ...item, bCodes: saurusProductBCodes(current) } : item;
    }) } : batch;
    return result({ ok: true, connection: release?.sourceReview ? connection() : AI_SAURUS_CONNECTION,
      batches, batch: displayBatch, maxCredits: release?.maxCredits ?? null });
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
  const live = ["start", "resume", "refresh", "approve", "retry", "reject", "manual_save", "clear_queue"].includes(String(input.action));
  if (["start", "resume", "refresh"].includes(String(input.action)) && connection() !== "connected") {
    return result({ ok: false, code: "AI_SAURUS_CONNECTION_LOCKED", message: "AI 사우루스 실제 연결은 준비 단계에서 잠겨 있습니다." }, 409);
  }
  const needsOperator = live || connection() === "connected";
  const email = needsOperator ? await requireOperatorEmail(owner) : "";
  if (needsOperator && !email) {
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
      const conflict = await findSaurusReviewConflict(config.value, owner, batch);
      if (conflict) {
        const note = conflict.stage === "rejected"
          ? "승인 거절된 상품은 기존 작업에서 직접 제작 URL을 입력할 수 있습니다."
          : "이미 제작을 시작한 상품은 기존 작업에서 결과를 확인해 주세요.";
        return result({ ok: false, message: `${conflict.model} · ${note}`, batchId: conflict.batch_id }, 409);
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
    const revision = saurusBatchRevisionMode(input.action, Number(input.revision), batch.revision);
    if (revision === "conflict") {
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
        // A second tab can finish the same poll first. Return its saved snapshot.
        if (revision === "read-latest") return result({ ok: true, batch });
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
          if (!current || product.reviewOptions === undefined || current.sourceUrl !== product.sourceUrl ||
              current.name !== product.name || current.model !== product.model ||
              !sameSaurusReviewOptions(current.reviewOptions, product.reviewOptions) ||
              (product.originalImageMaterials
                ? !sameSaurusLaunchMaterials(current.originalImageMaterials!, product.originalImageMaterials)
                : current.originalDetailImageUrl !== product.originalDetailImageUrl) ||
              product.bCodes?.some((code) => !current.bCodes?.includes(code))) {
            return result({ ok: false, message: "상품 정보가 변경됐습니다. 상품출시 진행관리에서 다시 선택해 주세요." }, 409);
          }
          const withIdentity = { ...batch, products: batch.products.map((row) => row.id === product.id
            ? { ...row, bCodes: current.bCodes, originalImageMaterials: current.originalImageMaterials }
            : row) };
          const start = startOpsSaurusProduct(withIdentity, ids[0], email, now, release);
          const launchUrl = browserLaunchUrl(start.product);
          const saved = await saveSaurusReviewBatch(config.value, owner, { ...start.batch, queuedIds: queuedIds.slice(1) }, ids);
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
          if (!latest || current.reviewOptions === undefined || latest.sourceUrl !== current.sourceUrl ||
              latest.name !== current.name || latest.model !== current.model ||
              (current.originalImageMaterials
                ? !sameSaurusLaunchMaterials(latest.originalImageMaterials!, current.originalImageMaterials)
                : latest.originalDetailImageUrl !== current.originalDetailImageUrl) ||
              current.bCodes?.some((code) => !latest.bCodes?.includes(code)) ||
              !sameSaurusReviewOptions(latest.reviewOptions, current.reviewOptions)) {
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
          const resumedBatch = replaceProduct(batch, { ...resumed, bCodes: latest.bCodes,
            originalImageMaterials: current.originalImageMaterials ?? latest.originalImageMaterials }, now);
          const saved = await saveSaurusReviewBatch(config.value, owner, resumedBatch, ids);
          return result({ ok: true, batch: saved, launchUrl });
        }
        const saved = current === product ? batch : await saveSaurusBatch(config.value, owner, replaceProduct(batch, current, now));
        return result({ ok: true, batch: saved });
      }
      if (input.action === "retry" || input.action === "reject") {
        const items = await readSelectedLaunchItems(config.value, owner, ids);
        let next;
        try {
          if (input.action === "retry") requireSaurusSourcingItems(items, ids);
          next = planSaurusReviewDecision(batch, ids, items, input.action, now);
        } catch (error) {
          return result({ ok: false, message: (error as Error).message }, 409);
        }
        // A successful review candidate already has a persisted final receipt.
        // Check the provider for failed attempts before allowing another start.
        if (input.action === "retry") {
          for (const product of selected) {
            if (product?.stage !== "failed") continue;
            if (!product.dispatch) return result({ ok: false, message: "이전 제작 이력을 확인하지 못했습니다." }, 409);
            const current = await readOpsSaurusStatus(product);
            if (current.state !== "failed" && (current.state !== "collecting" || product.dispatch.providerJobId)) {
              return result({ ok: false, message: "이전 제작의 최종 상태가 아직 확인되지 않았습니다." }, 409);
            }
          }
        }
        return result({ ok: true, batch: await saveSaurusReviewBatch(config.value, owner, next, ids) });
      }

      const [launchRow, currentItems] = await Promise.all([
        readProductLaunchState(config.value, owner), readSelectedLaunchItems(config.value, owner, ids),
      ]);
      const items = object(launchRow?.state_payload).items;
      if (!launchRow?.updated_at || !Array.isArray(items)) return result({ ok: false, message: "진행관리 상품을 확인하지 못했습니다." }, 409);
      const launchItems = items.map(object);

      if (input.action === "manual_save") {
        const product = selected[0]!;
        if (ids.length !== 1 || product.stage !== "rejected") {
          return result({ ok: false, message: "승인 거절된 상품 한 건의 직접 제작 URL을 입력해 주세요." }, 409);
        }
        let materials;
        try {
          const item = requireSaurusProductIdentity(product, currentItems.find(({ id }) => id === product.id));
          requireSaurusProductIdentity(product, launchItems.find(({ id }) => id === product.id));
          materials = saurusManualMaterials(input.images, String(item.productName || product.name));
        } catch (error) {
          return result({ ok: false, message: (error as Error).message }, 409);
        }
        const write = await saveLaunchImagePatches(request, launchRow.updated_at, [imagePatch(product.id, materials)]);
        if (!write.ok) return result(await write.json(), write.status);
        const readback = await readSelectedLaunchItems(config.value, owner, ids);
        const savedItem = readback.find(({ id }) => id === product.id);
        if (!savedItem || !sameSaurusLaunchMaterials(saurusLaunchMaterials(savedItem), materials)) {
          return result({ ok: false, message: "직접 제작 이미지 주소의 저장 결과를 확인하지 못했습니다." }, 409);
        }
        const next = replaceProduct(batch, { ...product, manualImageSavedAt: now }, now);
        return result({ ok: true, batch: await saveSaurusBatch(config.value, owner, next) });
      }

      let reserved;
      let patches;
      try {
        reserved = reserveSaurusApproval(batch, ids, currentItems, now);
        const plan = planSaurusApproval(reserved, ids, launchItems);
        const normalizedPlan = planSaurusApproval(reserved, ids, currentItems);
        const changedNormalized = new Set(normalizedPlan.filter((row, index) => row !== currentItems[index]).map(({ id }) => id));
        patches = plan.flatMap((row, index) => row === launchItems[index] && !changedNormalized.has(row.id) ? []
          : [imagePatch(String(row.id), saurusLaunchMaterials(row))]);
      } catch (error) {
        return result({ ok: false, message: (error as Error).message }, 409);
      }
      // Persist the decision before updating the tracker so a late reject or retry
      // cannot race a successful image save. Reopening approval resumes the write.
      const approval = reserved === batch ? batch : await saveSaurusReviewBatch(config.value, owner, reserved, ids);
      if (patches.length) {
        const write = await saveLaunchImagePatches(request, launchRow.updated_at, patches);
        if (!write.ok) return result({ ...(await write.json()), batch: approval }, write.status);
      }
      const readback = await readSelectedLaunchItems(config.value, owner, ids);
      let next;
      try {
        next = confirmSaurusApprovalReadback(approval, ids, readback, now);
      } catch (error) {
        return result({ ok: false, message: (error as Error).message, batch: approval }, 409);
      }
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
