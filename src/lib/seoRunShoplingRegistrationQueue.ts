import { randomUUID } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { recoverProductLaunchOrderOptionsFromSuccessfulUpload } from "@/lib/productLaunchShoplingHistoricalOptionRecovery";
import {
  needsShoplingSelfCodeRotation,
  rotateShoplingSelfCodeForRetry,
} from "@/lib/productLaunchShoplingRetry";
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
  readProductLaunchState,
  readProductLaunchStorageJson,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const SEO_RUN_TABLE = "seo_run_jobs";
const UPLOAD_JOB_TABLE = "product_launch_upload_jobs";
const DEFAULT_MAX_STARTS = 5;
const DEFAULT_MAX_MONITORS = 100;
const MAX_TRANSIENT_RETRIES = 3;
const EXPECTED_MALL_TITLE_COUNT = 29;

const CHANNEL_SUFFIX: Record<string, string> = {
  wholesale1: "a",
  wholesale2: "b",
  wholesale3: "c",
  wholesale4: "d",
  retail1: "e",
  retail2: "f",
};

type UnknownRecord = Record<string, unknown>;

type RegistrationRun = {
  run_id: string;
  owner_id: string;
  owner_email: string;
  launch_item_id: string;
  model_number: string;
  result_payload: UnknownRecord;
  registration_status: string;
  registration_job_id: string;
  registration_request_id: string;
  registration_payload: UnknownRecord;
  run_created_at: string;
  updated_at: string;
};

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

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function itemGoodsKeys(item: UnknownRecord) {
  return Object.values(record(item.shoplingProducts))
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean);
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
    mallTitles,
  };
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function selfCodeBaseFromPayload(payloadInput: unknown) {
  const channels = array(record(payloadInput).channels).map(record);
  if (channels.length !== 6) return "";
  const seen = new Set<string>();
  const bases = new Set<string>();
  for (const channel of channels) {
    const key = text(channel.key);
    const suffix = CHANNEL_SUFFIX[key];
    const code = normalizeCode(channel.ptnGoodsCd ?? channel.ptn_goods_cd);
    if (!suffix || !code || seen.has(key)) return "";
    seen.add(key);
    if (!code.toLowerCase().endsWith(suffix)) return "";
    bases.add(code.slice(0, -1));
  }
  return seen.size === 6 && bases.size === 1 ? [...bases][0] : "";
}

function isTransientRegistrationError(messageInput: unknown) {
  const message = text(messageInput).toLowerCase();
  return [
    "aborted",
    "aborterror",
    "timeout",
    "timed out",
    "fetch failed",
    "network",
    "pgrst002",
    "schema cache",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
  ].some((token) => message.includes(token));
}

async function readRegistrationRuns(config: ProductLaunchAdminConfig) {
  const params = new URLSearchParams({
    select:
      "run_id,owner_id,owner_email,launch_item_id,model_number,result_payload,registration_status,registration_job_id,registration_request_id,registration_payload,run_created_at,updated_at",
    status: "eq.ready",
    archived_at: "is.null",
    registration_status: "in.(queued,running,submitting)",
    order: "run_created_at.asc,created_at.asc",
    limit: "500",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${SEO_RUN_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : []).map((value) => {
    const row = record(value);
    return {
      run_id: text(row.run_id),
      owner_id: text(row.owner_id),
      owner_email: text(row.owner_email),
      launch_item_id: text(row.launch_item_id),
      model_number: text(row.model_number),
      result_payload: record(row.result_payload),
      registration_status: text(row.registration_status),
      registration_job_id: text(row.registration_job_id),
      registration_request_id: text(row.registration_request_id),
      registration_payload: record(row.registration_payload),
      run_created_at: text(row.run_created_at),
      updated_at: text(row.updated_at),
    } as RegistrationRun;
  });
}

async function patchRun(
  config: ProductLaunchAdminConfig,
  runId: string,
  patch: UnknownRecord,
) {
  const params = new URLSearchParams({ run_id: `eq.${runId}` });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${SEO_RUN_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      cache: "no-store",
    },
  );
}

async function readUploadJobsByIds(config: ProductLaunchAdminConfig, ids: string[]) {
  const unique = [...new Set(ids.map(text).filter(Boolean))].slice(0, 200);
  if (!unique.length) return [];
  const params = new URLSearchParams({
    select: "id,request_id,status,error_message,result,updated_at,completed_at",
    id: `in.(${postgrestIn(unique)})`,
    limit: String(unique.length),
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : []).map(record);
}

async function readRecentUploadJobs(
  config: ProductLaunchAdminConfig,
  launchItemId: string,
) {
  const params = new URLSearchParams({
    select:
      "id,launch_item_id,request_id,status,payload,result,error_message,created_at,updated_at,completed_at",
    launch_item_id: `eq.${launchItemId}`,
    order: "created_at.desc",
    limit: "30",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : []).map(record);
}

async function persistPreparedItem(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  state: UnknownRecord,
  items: UnknownRecord[],
  itemIndex: number,
  item: UnknownRecord,
) {
  const now = new Date().toISOString();
  item.updatedAt = now;
  item.updatedBy = "SEO RUN 서버 Shopling 등록큐";
  items[itemIndex] = item;
  state.items = items;
  state.savedAt = now;
  await writeProductLaunchState(config, identity, state);
  await reconcileProductLaunchNormalizedAfterLegacyItems(config, identity, [text(item.id)]);
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

async function markUploadJobFailed(
  config: ProductLaunchAdminConfig,
  jobId: string,
  message: string,
) {
  const now = new Date().toISOString();
  const params = new URLSearchParams({ id: `eq.${jobId}` });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${UPLOAD_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "failed",
        error_message: message,
        updated_at: now,
        completed_at: now,
      }),
      cache: "no-store",
    },
  ).catch(() => null);
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

async function startRegistrationRun(
  config: ProductLaunchAdminConfig,
  run: RegistrationRun,
) {
  const now = new Date().toISOString();
  const currentPayload = record(run.registration_payload);
  let latestPayload: UnknownRecord = {
    ...currentPayload,
    error: "",
    serverQueue: true,
    serverSubmittingAt: now,
  };
  const retryCount = Math.max(0, Math.floor(numeric(currentPayload.retryCount)));
  const nextRetryAt = Date.parse(text(currentPayload.nextRetryAt));
  if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) {
    return { started: false, deferred: true };
  }

  await patchRun(config, run.run_id, {
    registration_status: "submitting",
    registration_payload: latestPayload,
  });

  try {
    const stateRow = await readProductLaunchState(config, run.owner_id);
    const state = record(stateRow?.state_payload);
    const items = array(state.items).map(record);
    const itemIndex = items.findIndex((item) => text(item.id) === run.launch_item_id);
    if (itemIndex < 0) throw new Error("서버 저장본에서 출시 상품을 찾지 못했습니다.");

    const seoFinal = normalizeSeoFinal(run.result_payload);
    if (!seoFinal) throw new Error(`${run.model_number}: FINAL RESULT 10개/29개가 완성되지 않았습니다.`);

    let item = { ...items[itemIndex] };
    const previousSnapshot = record(currentPayload.previous);
    const hasSnapshot = Object.keys(previousSnapshot).length > 0;
    const previousHistory = array(item.shoplingRegistrationHistory).map(record);
    const hasExistingGoods =
      currentPayload.hasExistingGoods === true || itemGoodsKeys(item).length > 0;
    let newSelfCodeBase = text(currentPayload.newSelfCodeBase) || nextSelfCode();

    const historyEntry = Object.keys(record(currentPayload.historyEntry)).length
      ? record(currentPayload.historyEntry)
      : {
          registrationType: hasExistingGoods
            ? "seo_inventory_append"
            : "seo_run_initial",
          seoRunId: run.run_id,
          status: "reserved",
          archivedAt: now,
          previousSelfCodeBase: text(item.selfCodeBase),
          previousProducts: item.shoplingProducts,
          previousSeoFinal: item.seoFinal ?? null,
          newSeoFinal: seoFinal,
        };

    let registrationPayload: UnknownRecord = {
      ...latestPayload,
      queuedAt: text(currentPayload.queuedAt) || now,
      reservedAt: text(currentPayload.reservedAt) || now,
      hasExistingGoods,
      newSelfCodeBase,
      historyEntry,
      retryCount,
      nextRetryAt: "",
      previous: hasSnapshot
        ? previousSnapshot
        : {
            shoplingProducts: item.shoplingProducts,
            seoFinal: item.seoFinal ?? null,
            selfCodeBase: text(item.selfCodeBase),
            mallSeoApply: item.mallSeoApply ?? null,
            pricePolicy: item.pricePolicy ?? null,
            shoplingRegistrationHistory: previousHistory,
          },
    };
    latestPayload = registrationPayload;

    item = {
      ...item,
      seoFinal,
      selfCodeBase: newSelfCodeBase,
      mallSeoApply: null,
      pricePolicy: null,
      shoplingRegistrationHistory:
        hasExistingGoods &&
        !previousHistory.some((entry) => text(entry.seoRunId) === run.run_id)
          ? [...previousHistory, historyEntry]
          : previousHistory,
      seoRunDispatch: {
        status: "prepared",
        seoRunId: run.run_id,
        preparedAt: now,
        newSelfCodeBase,
      },
    };

    let historicalOptionRecovery:
      | Awaited<ReturnType<typeof recoverProductLaunchOrderOptionsFromSuccessfulUpload>>
      | null = null;
    if (!array(item.orderOptions).length) {
      historicalOptionRecovery =
        await recoverProductLaunchOrderOptionsFromSuccessfulUpload(
          config,
          run.launch_item_id,
          state.policy,
        );
      if (historicalOptionRecovery) {
        item.orderOptions = historicalOptionRecovery.options;
      }
    }
    if (!array(item.orderOptions).length) {
      throw new Error(
        "발주·입고 옵션가격이 없습니다. 동일 카드 과거 성공등록에서도 복구할 옵션을 찾지 못했습니다.",
      );
    }

    const stockIndex = buildProductLaunchStockStatusIndex(
      await loadProductLaunchShoplingStockSnapshot({ maxAgeMs: 0 }),
    );
    const stockAvailability = classifyProductLaunchStockAvailability(item, stockIndex);
    const stockBlockReason = productLaunchStockBlockReason(stockAvailability);
    if (stockBlockReason) throw new Error(stockBlockReason);

    const recentJobs = await readRecentUploadJobs(config, run.launch_item_id);
    const sameCodeJob = recentJobs.find(
      (job) => selfCodeBaseFromPayload(job.payload) === normalizeCode(newSelfCodeBase),
    );
    if (sameCodeJob) {
      const sameStatus = text(sameCodeJob.status);
      if (["queued", "running", "success"].includes(sameStatus)) {
        latestPayload = {
          ...registrationPayload,
          attachedExistingJob: true,
          attachedAt: now,
        };
        await persistPreparedItem(
          config,
          { userId: run.owner_id, email: run.owner_email },
          state,
          items,
          itemIndex,
          item,
        );
        await patchRun(config, run.run_id, {
          registration_status: sameStatus === "running" ? "running" : "queued",
          registration_job_id: text(sameCodeJob.id),
          registration_request_id: text(sameCodeJob.request_id),
          registration_payload: latestPayload,
        });
        return { started: false, attached: true };
      }
      newSelfCodeBase = nextSelfCode();
      item.selfCodeBase = newSelfCodeBase;
      item.seoRunDispatch = {
        ...record(item.seoRunDispatch),
        newSelfCodeBase,
        rotatedAt: now,
        rotationReason: "previous_same_self_code_job_failed",
      };
      registrationPayload = {
        ...registrationPayload,
        previousAttemptSelfCodeBase: registrationPayload.newSelfCodeBase,
        newSelfCodeBase,
      };
      latestPayload = registrationPayload;
    }

    if (needsShoplingSelfCodeRotation(item)) {
      const rotated = rotateShoplingSelfCodeForRetry({
        item,
        allItems: items,
        now,
      });
      item = rotated.item;
      newSelfCodeBase = rotated.selfCodeBase;
      registrationPayload = {
        ...registrationPayload,
        previousAttemptSelfCodeBase: registrationPayload.newSelfCodeBase,
        newSelfCodeBase,
        retrySelfCode: {
          previousSelfCodeBase: rotated.previousSelfCodeBase,
          selfCodeBase: rotated.selfCodeBase,
          reason: "SHOPLING_SELF_CODE_DUPLICATE",
          rotatedAt: now,
        },
      };
      latestPayload = registrationPayload;
    }

    await persistPreparedItem(
      config,
      { userId: run.owner_id, email: run.owner_email },
      state,
      items,
      itemIndex,
      item,
    );

    const jobId = randomUUID();
    const requestId = `product-launch-${Date.now()}-${jobId.slice(0, 8)}`;
    const basePayload = buildProductLaunchShoplingPayload(
      applyProductLaunchStockAvailability(item, stockAvailability),
      state.policy,
      requestId,
    );
    const payload = historicalOptionRecovery
      ? { ...basePayload, optionRecovery: historicalOptionRecovery.evidence }
      : basePayload;
    const jobRow = {
      id: jobId,
      owner_id: run.owner_id,
      owner_email: run.owner_email,
      launch_item_id: run.launch_item_id,
      request_id: requestId,
      status: "queued",
      payload,
      created_at: now,
      updated_at: now,
    };
    await insertUploadJob(config, jobRow);
    latestPayload = {
      ...registrationPayload,
      newSelfCodeBase,
      dispatchJobId: jobId,
      dispatchRequestId: requestId,
      dispatchPreparedAt: new Date().toISOString(),
      error: "",
    };
    await patchRun(config, run.run_id, {
      registration_status: "queued",
      registration_job_id: jobId,
      registration_request_id: requestId,
      registration_payload: latestPayload,
    });

    try {
      await dispatchLaunchWorkflow(jobId, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopling workflow dispatch failed";
      await markUploadJobFailed(config, jobId, message);
      throw error;
    }

    latestPayload = {
      ...latestPayload,
      dispatchedAt: new Date().toISOString(),
      error: "",
    };
    await patchRun(config, run.run_id, {
      registration_status: "queued",
      registration_job_id: jobId,
      registration_request_id: requestId,
      registration_payload: latestPayload,
    });
    return { started: true, jobId, requestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopling 등록 준비 실패";
    const transient = isTransientRegistrationError(message);
    const nextRetryCount = retryCount + 1;
    const retryable = transient && nextRetryCount <= MAX_TRANSIENT_RETRIES;
    await patchRun(config, run.run_id, {
      registration_status: retryable ? "queued" : "failed",
      registration_job_id: text(latestPayload.dispatchJobId),
      registration_request_id: text(latestPayload.dispatchRequestId),
      registration_payload: {
        ...latestPayload,
        serverQueue: true,
        error: message,
        retryCount: nextRetryCount,
        lastFailedAt: new Date().toISOString(),
        nextRetryAt: retryable
          ? new Date(Date.now() + Math.min(120_000, 20_000 * nextRetryCount)).toISOString()
          : "",
      },
    });
    return { started: false, failed: true, retryable, error: message };
  }
}

async function monitorActiveRegistrations(
  config: ProductLaunchAdminConfig,
  runs: RegistrationRun[],
  maxMonitors: number,
) {
  const active = runs
    .filter((run) => run.registration_job_id)
    .slice(0, maxMonitors);
  const jobs = await readUploadJobsByIds(
    config,
    active.map((run) => run.registration_job_id),
  );
  const byId = new Map(jobs.map((job) => [text(job.id), job]));
  let runningCount = 0;
  let terminalFailureCount = 0;
  for (const run of active) {
    const job = byId.get(run.registration_job_id);
    if (!job) continue;
    const status = text(job.status);
    if (["queued", "running"].includes(status)) {
      await patchRun(config, run.run_id, {
        registration_status: status,
        registration_payload: {
          ...run.registration_payload,
          error: "",
          lastJobObservedAt: new Date().toISOString(),
        },
      });
      if (status === "running") runningCount += 1;
      continue;
    }
    if (["failed", "partial_failure"].includes(status)) {
      const error =
        text(job.error_message) ||
        text(record(job.result).error_message) ||
        `Shopling 등록 ${status}`;
      await patchRun(config, run.run_id, {
        registration_status: "failed",
        registration_payload: {
          ...run.registration_payload,
          error,
          uploadJobTerminalStatus: status,
          uploadJobFailedAt: text(job.completed_at) || new Date().toISOString(),
        },
      });
      terminalFailureCount += 1;
    }
  }
  return { monitoredCount: active.length, runningCount, terminalFailureCount };
}

function eligibleStartRuns(runs: RegistrationRun[], maxStarts: number) {
  const candidates = runs.filter(
    (run) =>
      !run.registration_job_id &&
      ["queued", "submitting"].includes(run.registration_status),
  );
  const earliestByItem = new Map<string, RegistrationRun>();
  for (const run of candidates) {
    const existing = earliestByItem.get(run.launch_item_id);
    if (!existing || run.run_created_at < existing.run_created_at) {
      earliestByItem.set(run.launch_item_id, run);
    }
  }
  return [...earliestByItem.values()]
    .sort((a, b) => a.run_created_at.localeCompare(b.run_created_at))
    .slice(0, maxStarts);
}

export async function processSeoRunShoplingRegistrationQueue(options: {
  maxStarts?: number;
  maxMonitors?: number;
} = {}) {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error("Shopling 서버 등록큐 저장소가 설정되지 않았습니다.");
  }
  const config = configResult.value;
  const maxStarts = Math.max(
    1,
    Math.min(12, Math.floor(options.maxStarts ?? DEFAULT_MAX_STARTS)),
  );
  const maxMonitors = Math.max(
    1,
    Math.min(200, Math.floor(options.maxMonitors ?? DEFAULT_MAX_MONITORS)),
  );
  const runs = await readRegistrationRuns(config);
  const monitor = await monitorActiveRegistrations(config, runs, maxMonitors);
  const starts = eligibleStartRuns(runs, maxStarts);
  let startedCount = 0;
  let attachedCount = 0;
  let failedCount = 0;
  let deferredCount = 0;
  const startedRuns: string[] = [];

  // Prepare sequentially because all launch items for one owner share one legacy state row.
  // Shopling workflows themselves run concurrently after dispatch, so this avoids lost-update races
  // without sacrificing throughput at the external worker layer.
  for (const run of starts) {
    const result = await startRegistrationRun(config, run);
    if (result.started) {
      startedCount += 1;
      startedRuns.push(run.run_id);
    } else if ("attached" in result && result.attached) {
      attachedCount += 1;
    } else if ("deferred" in result && result.deferred) {
      deferredCount += 1;
    } else if ("failed" in result && result.failed) {
      failedCount += 1;
    }
  }

  return {
    queuedOrActiveCount: runs.length,
    startedCount,
    attachedCount,
    failedCount,
    deferredCount,
    startedRuns,
    ...monitor,
  };
}
