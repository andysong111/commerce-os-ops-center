import { randomUUID } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { readProductLaunchNormalizedItem } from "@/lib/productLaunchTrackerNormalizedStore";
import { recoverProductLaunchOrderOptionsFromSuccessfulUpload } from "@/lib/productLaunchShoplingHistoricalOptionRecovery";
import { buildLegacySeoShoplingPayload } from "@/lib/legacySeoShoplingPayload";
import {
  readProductLaunchState,
  readProductLaunchStorageJson,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import {
  patchOwnedLegacySeoRunJobs,
  type LegacySeoRunJobContext,
} from "@/lib/legacySeoRunJobServer";
import type { SeoRunJobRow } from "@/lib/seoRunJobServer";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";

const UPLOAD_JOB_TABLE = "product_launch_upload_jobs";
const EXPECTED_MALL_TITLE_COUNT = 29;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function itemGoodsKeys(item: UnknownRecord) {
  return Object.values(record(item.shoplingProducts))
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean);
}

function hasSyncedLegacyOptions(item: UnknownRecord) {
  return (
    text(record(item.shoplingOptionSync).source) === "shopling_live_grouped_option_sync" ||
    array(item.orderOptions)
      .map(record)
      .some(
        (option) =>
          text(record(option.shoplingOptionSync).source) ===
          "shopling_live_grouped_option_sync",
      )
  );
}

function nextSelfCode() {
  return `PLR${randomUUID().replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10)}`.slice(
    0,
    54,
  );
}

function normalizeSeoFinal(value: unknown) {
  const root = record(value);
  const source = record(root.seoFinal || record(root.result).seoFinal);
  const searchKeywords = array(source.searchKeywords).map(text).filter(Boolean);
  const mallTitles = array(source.mallTitles)
    .map(record)
    .map((row) => ({
      productGroup: text(row.productGroup),
      marketName: text(row.marketName),
      mallKey: text(row.mallKey),
      accountIdLabel: text(row.accountIdLabel),
      title: text(row.title),
    }))
    .filter((row) => row.title);
  if (searchKeywords.length !== 10 || mallTitles.length !== EXPECTED_MALL_TITLE_COUNT) {
    return null;
  }
  return {
    productName: text(source.productName),
    groupProductNames: record(source.groupProductNames),
    searchKeywords,
    searchLine: text(source.searchLine) || searchKeywords.join(","),
    source: text(source.source),
    sourceUrl: text(source.sourceUrl),
    offerId: text(source.offerId),
    generatedAt: text(source.generatedAt),
    titleExpansionCategory: text(source.titleExpansionCategory),
    titleMaterialPolicy: text(source.titleMaterialPolicy),
    titleExpansionPool: array(source.titleExpansionPool),
    mallTitles,
  };
}

async function insertUploadJob(
  config: ProductLaunchAdminConfig,
  row: UnknownRecord,
) {
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  return Array.isArray(body) ? record(body[0]) : record(body);
}

async function dispatchLaunchWorkflow(jobId: string, requestId: string) {
  const repo = process.env.SHOPLING_UPLOAD_REPO?.trim();
  const workflow =
    process.env.SHOPLING_LAUNCH_UPLOAD_WORKFLOW?.trim() ||
    "shopling-product-launch-upload.yml";
  const ref = process.env.SHOPLING_UPLOAD_REF?.trim() || "main";
  const token = process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !token) {
    throw new Error("SHOPLING_UPLOAD_REPO와 GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.");
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
  if (![200, 204].includes(response.status)) {
    const body = await response.text();
    throw new Error(
      `GitHub Actions 실행 요청에 실패했습니다. status=${response.status}${body ? ` body=${body.slice(0, 240)}` : ""}`,
    );
  }
}

export async function startLegacySeoShoplingRegistration(
  context: LegacySeoRunJobContext,
  run: SeoRunJobRow,
) {
  if (run.status !== "ready") {
    throw new Error("FINAL 완료된 이전상품 RUN만 Shopling 등록할 수 있습니다.");
  }
  if (["queued", "running", "submitting", "success"].includes(run.registration_status)) {
    return { started: false, alreadyActive: true };
  }
  const seoFinal = normalizeSeoFinal(run.result_payload);
  if (!seoFinal) {
    throw new Error(`${run.model_number}: FINAL RESULT 10개/29개가 완성되지 않았습니다.`);
  }

  await patchOwnedLegacySeoRunJobs(context, [run.run_id], {
    registration_status: "submitting",
    registration_payload: {
      ...record(run.registration_payload),
      serverSubmittingAt: new Date().toISOString(),
      error: "",
    },
  });

  try {
    const stateRow = await readProductLaunchState(context.config, context.identity.userId);
    const state = record(stateRow?.state_payload);
    const items = array(state.items).map(record);
    const itemIndex = items.findIndex((item) => text(item.id) === run.launch_item_id);
    if (itemIndex < 0) throw new Error("서버 저장본에서 출시 상품을 찾지 못했습니다.");

    const now = new Date().toISOString();
    const previousItem = { ...items[itemIndex] };
    let item = { ...previousItem };

    const normalizedItem = record(
      await readProductLaunchNormalizedItem(
        context.config,
        context.identity.userId,
        run.launch_item_id,
      ),
    );
    if (hasSyncedLegacyOptions(normalizedItem) && array(normalizedItem.orderOptions).length) {
      const normalizedOptions = array(normalizedItem.orderOptions).map(record);
      const normalizedLabels = normalizedOptions
        .map((option) => text(option.saleOption ?? option.value))
        .filter(Boolean);
      item.orderOptions = normalizedOptions;
      item.optionLabels = normalizedLabels;
      item.options = normalizedLabels;
      item.shoplingOptionSync = normalizedItem.shoplingOptionSync;
    }

    const existingGoods = itemGoodsKeys(item);
    const previousHistory = array(item.shoplingRegistrationHistory).map(record);
    const newSelfCodeBase = nextSelfCode();
    const historyEntry = {
      registrationType: "legacy_shopling_seo_cloud_append",
      seoRunId: run.run_id,
      status: "reserved",
      archivedAt: now,
      previousSelfCodeBase: text(item.selfCodeBase),
      previousProducts: item.shoplingProducts,
      previousSeoFinal: item.seoFinal ?? null,
      newSeoFinal: seoFinal,
      legacySource: record(run.input_payload).legacyShoplingEvidence ?? null,
    };

    item = {
      ...item,
      seoFinal,
      selfCodeBase: newSelfCodeBase,
      mallSeoApply: null,
      pricePolicy: null,
      shoplingRegistrationHistory:
        existingGoods.length > 0 &&
        !previousHistory.some((entry) => text(entry.seoRunId) === run.run_id)
          ? [...previousHistory, historyEntry]
          : previousHistory,
      seoRunDispatch: {
        status: "prepared",
        seoRunId: run.run_id,
        preparedAt: now,
        newSelfCodeBase,
        source: "legacy_shopling_seo_cloud",
      },
    };

    let historicalOptionRecovery:
      | Awaited<ReturnType<typeof recoverProductLaunchOrderOptionsFromSuccessfulUpload>>
      | null = null;
    if (!array(item.orderOptions).length) {
      historicalOptionRecovery =
        await recoverProductLaunchOrderOptionsFromSuccessfulUpload(
          context.config,
          run.launch_item_id,
          state.policy,
        );
      if (historicalOptionRecovery) item.orderOptions = historicalOptionRecovery.options;
    }
    if (!array(item.orderOptions).length) {
      throw new Error(
        "발주·입고 옵션가격이 없습니다. 동일 카드 과거 성공등록에서도 복구할 옵션을 찾지 못했습니다.",
      );
    }

    item.updatedAt = now;
    item.updatedBy = "이전상품 상품등록SEO 클라우드";
    items[itemIndex] = item;
    state.items = items;
    state.savedAt = now;
    await writeProductLaunchState(context.config, context.identity, state);
    await reconcileProductLaunchNormalizedAfterLegacyItems(
      context.config,
      context.identity,
      [run.launch_item_id],
    );

    const jobId = randomUUID();
    const requestId = `legacy-seo-${Date.now()}-${jobId.slice(0, 8)}`;
    const basePayload = buildLegacySeoShoplingPayload(item, state.policy, requestId);
    const payload = historicalOptionRecovery
      ? { ...basePayload, optionRecovery: historicalOptionRecovery.evidence }
      : basePayload;
    await insertUploadJob(context.config, {
      id: jobId,
      owner_id: context.identity.userId,
      owner_email: context.identity.email,
      launch_item_id: run.launch_item_id,
      request_id: requestId,
      status: "queued",
      payload,
      created_at: now,
      updated_at: now,
    });

    await patchOwnedLegacySeoRunJobs(context, [run.run_id], {
      registration_status: "queued",
      registration_job_id: jobId,
      registration_request_id: requestId,
      registration_payload: {
        previous: {
          selfCodeBase: text(previousItem.selfCodeBase),
          shoplingProducts: previousItem.shoplingProducts ?? null,
          seoFinal: previousItem.seoFinal ?? null,
        },
        newSelfCodeBase,
        historyEntry,
        dispatchedAt: now,
        error: "",
      },
    });

    await dispatchLaunchWorkflow(jobId, requestId);
    await wakeOpsDispatchTask("seo-run-worker", 0).catch(() => false);
    return { started: true, jobId, requestId, newSelfCodeBase };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopling 등록 준비 실패";
    await patchOwnedLegacySeoRunJobs(context, [run.run_id], {
      registration_status: "failed",
      registration_payload: {
        ...record(run.registration_payload),
        error: message,
        failedAt: new Date().toISOString(),
      },
    });
    throw error;
  }
}

export async function refreshLegacySeoRegistrationStatuses(
  context: LegacySeoRunJobContext,
  runs: SeoRunJobRow[],
) {
  const active = runs.filter(
    (run) =>
      run.registration_job_id &&
      ["queued", "running", "submitting"].includes(run.registration_status),
  );
  if (!active.length) return runs;
  const ids = [...new Set(active.map((run) => run.registration_job_id))];
  const params = new URLSearchParams({
    select: "id,status,error_message,result,updated_at,completed_at",
    id: `in.(${postgrestIn(ids)})`,
    limit: String(ids.length),
  });
  const { body } = await readProductLaunchStorageJson(
    `${context.config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(context.config.secretKey),
      cache: "no-store",
    },
  );
  const jobs = (Array.isArray(body) ? body : []).map(record);
  const byId = new Map(jobs.map((job) => [text(job.id), job]));

  for (const run of active) {
    const job = byId.get(run.registration_job_id);
    if (!job) continue;
    const status = text(job.status);
    const nextStatus =
      status === "success"
        ? "success"
        : ["failed", "partial_failure"].includes(status)
          ? "failed"
          : status === "running"
            ? "running"
            : "queued";
    if (nextStatus === run.registration_status) continue;
    const error =
      nextStatus === "failed"
        ? text(job.error_message) ||
          text(record(job.result).error_message) ||
          `Shopling 등록 ${status}`
        : "";
    await patchOwnedLegacySeoRunJobs(context, [run.run_id], {
      registration_status: nextStatus,
      registration_payload: {
        ...record(run.registration_payload),
        uploadJobStatus: status,
        lastJobObservedAt: new Date().toISOString(),
        error,
      },
    });
  }

  return runs;
}
