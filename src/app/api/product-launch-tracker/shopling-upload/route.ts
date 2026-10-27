import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  needsShoplingSelfCodeRotation,
  rotateShoplingSelfCodeForRetry,
} from "@/lib/productLaunchShoplingRetry";
import { recoverProductLaunchOrderOptionsFromSuccessfulUpload } from "@/lib/productLaunchShoplingHistoricalOptionRecovery";
import { buildProductLaunchShoplingPayload } from "@/lib/productLaunchTrackerShopling";
import {
  applyProductLaunchStockAvailability,
  buildProductLaunchStockStatusIndex,
  classifyProductLaunchStockAvailability,
  loadProductLaunchShoplingStockSnapshot,
  productLaunchStockBlockReason,
} from "@/lib/productLaunchStockAvailability";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const JOB_TABLE = "product_launch_upload_jobs";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: { itemId: string; force: boolean };
  try {
    const body = await request.json();
    input = {
      itemId: String(body?.itemId ?? "").trim(),
      force: body?.force === true,
    };
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_REQUEST", message: "상품 ID가 필요합니다." },
      { status: 400 },
    );
  }
  if (!input.itemId || input.itemId.length > 160) {
    return Response.json(
      { ok: false, code: "INVALID_ITEM_ID", message: "상품 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    // OptionBarcodeNO is system-owned. Repair/allocate it before *every* Shopling
    // entry point, not only durable SEO registration. The RPC also synchronizes
    // normalized options back to the legacy state that the payload builder reads.
    await ensureOptionBarcodeNos(
      config.value,
      identity.value.userId,
      input.itemId,
    );

    const stateRow = await readProductLaunchState(
      config.value,
      identity.value.userId,
    );
    const state = asRecord(stateRow?.state_payload);
    const items = Array.isArray(state.items) ? [...state.items] : [];
    const itemIndex = items.findIndex(
      (candidate) => asRecord(candidate).id === input.itemId,
    );
    if (itemIndex < 0) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_ITEM_NOT_FOUND",
          message: "서버 저장본에서 출시 상품을 찾지 못했습니다. 먼저 저장을 완료하세요.",
        },
        { status: 404 },
      );
    }

    let item = asRecord(items[itemIndex]);
    let historicalOptionRecovery:
      | Awaited<ReturnType<typeof recoverProductLaunchOrderOptionsFromSuccessfulUpload>>
      | null = null;
    const seoRunDispatch = asRecord(item.seoRunDispatch);
    const durableSeoRunPrepared =
      String(seoRunDispatch.status ?? "").trim() === "prepared" &&
      Boolean(String(seoRunDispatch.seoRunId ?? "").trim());

    // Durable SEO RUN registration may revisit an item whose option rows were lost
    // during the legacy/normalized cutover. Recover only from this exact launch item
    // and only from its own latest successful Shopling upload. Never broaden by model
    // number, so a manually edited/deleted option set on another item is not revived.
    if (
      durableSeoRunPrepared &&
      (!Array.isArray(item.orderOptions) || item.orderOptions.length === 0)
    ) {
      historicalOptionRecovery =
        await recoverProductLaunchOrderOptionsFromSuccessfulUpload(
          config.value,
          input.itemId,
          state.policy,
        );
      if (historicalOptionRecovery) {
        item = {
          ...item,
          orderOptions: historicalOptionRecovery.options,
        };
      }
    }

    if (!Array.isArray(item.orderOptions) || item.orderOptions.length === 0) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_ORDER_OPTIONS_REQUIRED",
          message:
            "발주·입고 옵션가격이 없습니다. 신규 상품은 상품출시 진행관리에서 발주·입고 데이터를 먼저 불러오세요. 동일 카드의 과거 Shopling 성공 등록이 있으면 SEO RUN 등록에서 자동 복구합니다.",
        },
        { status: 422 },
      );
    }

    const stockIndex = buildProductLaunchStockStatusIndex(
      await loadProductLaunchShoplingStockSnapshot({ maxAgeMs: 0 }),
    );
    const stock = classifyProductLaunchStockAvailability(item, stockIndex);
    const stockBlockReason = productLaunchStockBlockReason(stock);
    if (stockBlockReason) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STOCK_BLOCKED",
          message: stockBlockReason,
          stockAvailability: stock,
        },
        { status: 422 },
      );
    }
    item = applyProductLaunchStockAvailability(item, stock);

    const currentProducts = Object.values(asRecord(item.shoplingProducts)).map(asRecord);
    if (
      !input.force &&
      currentProducts.some((product) => String(product.goodsKey ?? "").trim())
    ) {
      return Response.json(
        {
          ok: false,
          code: "SHOPLING_PRODUCT_ALREADY_REGISTERED",
          message: "이미 등록된 goods_key가 있습니다. 중복 등록 방지를 위해 실행하지 않았습니다.",
        },
        { status: 409 },
      );
    }

    let selfCodeRotation:
      | {
          previousSelfCodeBase: string;
          selfCodeBase: string;
          rotatedAt: string;
        }
      | null = null;
    if (needsShoplingSelfCodeRotation(item)) {
      const rotatedAt = new Date().toISOString();
      const rotated = rotateShoplingSelfCodeForRetry({
        item,
        allItems: items,
        now: rotatedAt,
      });
      item = rotated.item;
      selfCodeRotation = {
        previousSelfCodeBase: rotated.previousSelfCodeBase,
        selfCodeBase: rotated.selfCodeBase,
        rotatedAt,
      };
    }

    const jobId = randomUUID();
    const requestId = `product-launch-${Date.now()}-${jobId.slice(0, 8)}`;
    const basePayload = buildProductLaunchShoplingPayload(
      item,
      state.policy,
      requestId,
    );
    const recoveredPayload = historicalOptionRecovery
      ? {
          ...basePayload,
          optionRecovery: historicalOptionRecovery.evidence,
        }
      : basePayload;
    const payload = selfCodeRotation
      ? {
          ...recoveredPayload,
          retrySelfCode: {
            previousSelfCodeBase: selfCodeRotation.previousSelfCodeBase,
            selfCodeBase: selfCodeRotation.selfCodeBase,
            reason: "SHOPLING_SELF_CODE_DUPLICATE",
            rotatedAt: selfCodeRotation.rotatedAt,
          },
        }
      : recoveredPayload;
    const now = new Date().toISOString();
    const jobRow = {
      id: jobId,
      owner_id: identity.value.userId,
      owner_email: identity.value.email,
      launch_item_id: input.itemId,
      request_id: requestId,
      status: "queued",
      payload,
      created_at: now,
      updated_at: now,
    };
    const insertResponse = await fetch(
      `${config.value.supabaseUrl}/rest/v1/${JOB_TABLE}`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(config.value.secretKey),
          Prefer: "return=representation",
        },
        body: JSON.stringify(jobRow),
        cache: "no-store",
      },
    );
    const insertBody = await readResponseJson(insertResponse);
    if (!insertResponse.ok) {
      throw new Error(readProductLaunchError(insertBody, insertResponse.status));
    }

    const dispatch = await dispatchLaunchWorkflow(jobId, requestId);
    if (!dispatch.ok) {
      await updateJobFailure(config.value, jobId, dispatch.message);
      return Response.json(
        {
          ok: false,
          code: "SHOPLING_WORKFLOW_DISPATCH_FAILED",
          message: dispatch.message,
          jobId,
          requestId,
          actionsUrl: dispatch.actionsUrl,
        },
        { status: 502 },
      );
    }

    return Response.json({
      ok: true,
      status: "queued",
      jobId,
      requestId,
      actionsUrl: dispatch.actionsUrl,
      selfCodeRotated: Boolean(selfCodeRotation),
      previousSelfCodeBase: selfCodeRotation?.previousSelfCodeBase ?? "",
      selfCodeBase: selfCodeRotation?.selfCodeBase ?? String(item.selfCodeBase ?? ""),
      optionRecovery: historicalOptionRecovery?.evidence ?? null,
      message: selfCodeRotation
        ? `샵플링 자사상품코드 중복을 감지해 ${selfCodeRotation.selfCodeBase}로 새 코드를 사용해 6채널 재등록을 시작했습니다.`
        : historicalOptionRecovery
          ? `과거 동일 카드의 성공 등록 옵션 ${historicalOptionRecovery.options.length}개를 복구해 샵플링 6채널 등록을 시작했습니다.`
          : "샵플링 6채널 등록 작업을 시작했습니다.",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_UPLOAD_PREPARE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "샵플링 등록 작업을 준비하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_JOB_ID", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    select:
      "id,launch_item_id,request_id,status,result,error_message,created_at,updated_at,completed_at",
    id: `eq.${jobId}`,
    owner_id: `eq.${identity.value.userId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.value.supabaseUrl}/rest/v1/${JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.value.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_JOB_READ_FAILED",
        message: readProductLaunchError(body, response.status),
      },
      { status: 500 },
    );
  }
  const job = Array.isArray(body) ? body[0] : null;
  if (!job) {
    return Response.json(
      { ok: false, code: "SHOPLING_JOB_NOT_FOUND", message: "등록 작업을 찾지 못했습니다." },
      { status: 404 },
    );
  }
  return Response.json({ ok: true, job });
}

async function ensureOptionBarcodeNos(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
  itemId: string,
) {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/rpc/ensure_product_launch_item_option_barcode_nos`,
    {
      method: "POST",
      headers: createSupabaseAdminHeaders(config.secretKey),
      body: JSON.stringify({
        p_owner_id: ownerId,
        p_item_id: itemId,
      }),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return body;
}

async function dispatchLaunchWorkflow(jobId: string, requestId: string) {
  const repo = process.env.SHOPLING_UPLOAD_REPO?.trim();
  const workflow =
    process.env.SHOPLING_LAUNCH_UPLOAD_WORKFLOW?.trim() ||
    "shopling-product-launch-upload.yml";
  const ref = process.env.SHOPLING_UPLOAD_REF?.trim() || "main";
  const token = process.env.GITHUB_ACTIONS_TOKEN?.trim();
  const actionsUrl = repo
    ? `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}`
    : undefined;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !token) {
    return {
      ok: false as const,
      message:
        "SHOPLING_UPLOAD_REPO와 GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.",
      actionsUrl,
    };
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: { job_id: jobId, request_id: requestId },
      }),
      cache: "no-store",
    },
  );
  if (response.status !== 204 && response.status !== 200) {
    const text = await response.text();
    return {
      ok: false as const,
      message: `GitHub Actions 실행 요청에 실패했습니다. status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`,
      actionsUrl,
    };
  }
  return { ok: true as const, actionsUrl };
}

async function updateJobFailure(
  config: { supabaseUrl: string; secretKey: string },
  jobId: string,
  message: string,
) {
  const params = new URLSearchParams({ id: `eq.${jobId}` });
  await fetch(
    `${config.supabaseUrl}/rest/v1/${JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
