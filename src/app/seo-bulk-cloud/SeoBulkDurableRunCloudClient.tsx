"use client";

import Link from "next/link";
import { seoBulkSourceLabel } from "@/lib/seoBulkSourceFallback";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";
const SEO_RUN_API = "/api/seo-run-jobs";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const SHOPLING_UPLOAD_API = "/api/product-launch-tracker/shopling-upload";
const POLL_INTERVAL_MS = 4_000;
const REGISTRATION_CONCURRENCY = 3;
const SERVER_OWNS_SHOPLING_REGISTRATION = true;
void REGISTRATION_CONCURRENCY;

type UnknownRecord = Record<string, unknown>;
type SeoFinal = {
  productName: string;
  groupProductNames: Record<string, string>;
  searchKeywords: string[];
  searchLine: string;
  source: string;
  sourceUrl: string;
  offerId: string;
  generatedAt: string;
  mallTitles: Array<{
    productGroup: string;
    marketName: string;
    mallKey: string;
    accountIdLabel: string;
    title: string;
  }>;
};
type SeoRunJob = {
  run_id: string;
  batch_id: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  product_name: string;
  source_url: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  stage: string;
  stage_index: number;
  progress_percent: number;
  message: string;
  result_payload: UnknownRecord;
  error_message: string;
  attempt_count: number;
  max_attempts: number;
  registration_status:
    | "idle"
    | "submitting"
    | "queued"
    | "running"
    | "success"
    | "failed";
  registration_job_id: string;
  registration_request_id: string;
  registration_payload: UnknownRecord;
  run_created_at: string;
  completed_at: string | null;
  updated_at: string;
};

type StoredRun = {
  id: string;
  runId: string;
  runCreatedAt: string;
  batchId?: string;
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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function readableError(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => readableError(entry, depth + 1))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 700);
  }
  if (typeof value === "object") {
    const row = value as UnknownRecord;
    for (const key of ["message", "error", "details", "reason", "code"]) {
      const message = readableError(row[key], depth + 1);
      if (message) return message;
    }
  }
  return "";
}

async function requestJson<T extends UnknownRecord>(
  url: string,
  init?: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
    cache: "no-store",
  });
  const raw = await response.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  }
  const body = parsed as T;
  if (!response.ok || body.ok !== true) {
    throw new Error(
      readableError(body.message) ||
        readableError(body.error) ||
        `HTTP ${response.status}`,
    );
  }
  return body;
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
}
void mapLimit;

function normalizeSeoFinal(value: unknown): SeoFinal | null {
  const root = record(value);
  const source = record(root.seoFinal || record(root.result).seoFinal);
  const searchKeywords = stringList(source.searchKeywords);
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
  if (searchKeywords.length !== 10 || mallTitles.length !== 29) return null;
  return {
    productName: text(source.productName),
    groupProductNames: Object.fromEntries(
      Object.entries(record(source.groupProductNames)).map(([key, title]) => [
        key,
        text(title),
      ]),
    ),
    searchKeywords,
    searchLine: text(source.searchLine) || searchKeywords.join(","),
    source: text(source.source),
    sourceUrl: text(source.sourceUrl),
    offerId: text(source.offerId),
    generatedAt: text(source.generatedAt),
    mallTitles,
  };
}

function readStoredBatch() {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = record(raw ? JSON.parse(raw) : null);
    const batchId = text(parsed.batchId) || `seo-bulk-${crypto.randomUUID()}`;
    const runs = array(parsed.items)
      .map(record)
      .map((row) => ({
        id: text(row.id),
        runId: text(row.runId),
        runCreatedAt: text(row.runCreatedAt) || new Date().toISOString(),
        batchId,
      }))
      .filter((row) => row.id && row.runId) as StoredRun[];
    return { batchId, runs };
  } catch {
    return { batchId: `seo-bulk-${crypto.randomUUID()}`, runs: [] as StoredRun[] };
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return stringList(parsed).slice(0, 200);
  } catch {
    return [];
  }
}

function itemGoodsKeys(item: UnknownRecord | null) {
  return Object.values(record(item?.shoplingProducts))
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean);
}

function nextSelfCode() {
  return `PLR${crypto.randomUUID().replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10)}`.slice(
    0,
    54,
  );
}

function statusTone(status: SeoRunJob["status"]) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "failed" || status === "cancelled") {
    return "bg-rose-100 text-rose-800";
  }
  if (status === "running") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function registrationTone(status: SeoRunJob["registration_status"]) {
  if (status === "success") return "bg-emerald-100 text-emerald-800";
  if (status === "failed") return "bg-rose-100 text-rose-800";
  if (["submitting", "queued", "running"].includes(status)) {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-slate-100 text-slate-600";
}

function statusLabel(job: SeoRunJob) {
  if (job.status === "ready") return "FINAL 완료";
  if (job.status === "failed") return "생성 오류";
  if (job.status === "cancelled") return "취소됨";
  if (job.status === "running") return "서버 실행 중";
  return "서버 대기";
}

function registrationLabel(status: SeoRunJob["registration_status"]) {
  return {
    idle: "등록 대기",
    submitting: "등록 준비 중",
    queued: "서버 등록 대기",
    running: "Shopling 등록 중",
    success: "등록 완료",
    failed: "등록 실패",
  }[status];
}

function groupByItem(jobs: SeoRunJob[]) {
  const groups = new Map<string, SeoRunJob[]>();
  for (const job of jobs) {
    const current = groups.get(job.launch_item_id) ?? [];
    current.push(job);
    groups.set(job.launch_item_id, current);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((a, b) => a.run_created_at.localeCompare(b.run_created_at)),
  );
}
void groupByItem;

export default function SeoBulkDurableRunCloudClient() {
  const [jobs, setJobs] = useState<SeoRunJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalError, setGlobalError] = useState("");
  const loadingRef = useRef(false);
  const migrationRef = useRef(false);
  const registrationResumeRef = useRef(new Set<string>());

  const loadJobs = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const body = await requestJson<{ ok?: boolean; jobs?: SeoRunJob[] }>(
        SEO_RUN_API,
      );
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setGlobalError("");
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "SEO RUN 목록을 불러오지 못했습니다.",
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const enqueueStoredRuns = useCallback(async () => {
    if (migrationRef.current) return;
    const stored = readStoredBatch();
    if (!stored.runs.length) return;
    migrationRef.current = true;
    setMigrating(true);
    setGlobalMessage(
      `${stored.runs.length}개 등록회차를 서버 작업 원장으로 인계합니다. 인계 후 컴퓨터를 꺼도 계속 실행됩니다.`,
    );
    try {
      await requestJson(SEO_RUN_API, {
        method: "POST",
        body: JSON.stringify({
          action: "enqueue",
          batchId: stored.batchId,
          runs: stored.runs,
          customBlockedTerms: readCustomBlockedTerms(),
        }),
      });
      window.localStorage.removeItem(BATCH_STORAGE_KEY);
      setGlobalMessage(
        "서버 인계 완료 · 브라우저를 닫거나 컴퓨터를 꺼도 단계별 체크포인트에서 계속 실행됩니다.",
      );
      await loadJobs();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "SEO RUN 서버 인계에 실패했습니다.",
      );
    } finally {
      migrationRef.current = false;
      setMigrating(false);
    }
  }, [loadJobs]);

  const patchRegistration = useCallback(
    async (
      runId: string,
      registrationStatus: SeoRunJob["registration_status"],
      options: {
        registrationJobId?: string;
        registrationRequestId?: string;
        registrationPayload?: UnknownRecord;
      } = {},
    ) => {
      await requestJson(SEO_RUN_API, {
        method: "POST",
        body: JSON.stringify({
          action: "update_registration",
          runIds: [runId],
          registrationStatus,
          registrationJobId: options.registrationJobId ?? "",
          registrationRequestId: options.registrationRequestId ?? "",
          registrationPayload: options.registrationPayload ?? {},
        }),
      });
    },
    [],
  );

  const reloadItem = useCallback(async (itemId: string) => {
    const query = new URLSearchParams({ mode: "item", id: itemId });
    const body = await requestJson<{ ok?: boolean; item?: unknown }>(
      `${NORMALIZED_API}?${query.toString()}`,
    );
    return record(body.item);
  }, []);

  const patchItem = useCallback(
    async (itemId: string, patch: UnknownRecord, updatedBy: string) => {
      await requestJson(NORMALIZED_API, {
        method: "PATCH",
        body: JSON.stringify({
          operation: "patch_item",
          itemId,
          patch,
          updatedBy,
        }),
      });
    },
    [],
  );

  const pollShoplingJob = useCallback(
    async (run: SeoRunJob, jobId: string) => {
      for (let poll = 0; poll < 120; poll += 1) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, poll === 0 ? 1_500 : 5_000),
        );
        const query = new URLSearchParams({ jobId });
        const body = await requestJson<{ ok?: boolean; job?: unknown }>(
          `${SHOPLING_UPLOAD_API}?${query.toString()}`,
        );
        const job = record(body.job);
        const status = text(job.status);
        if (status === "queued") {
          await patchRegistration(run.run_id, "queued", {
            registrationJobId: jobId,
            registrationRequestId: run.registration_request_id,
            registrationPayload: run.registration_payload,
          });
          continue;
        }
        if (status === "running") {
          await patchRegistration(run.run_id, "running", {
            registrationJobId: jobId,
            registrationRequestId: run.registration_request_id,
            registrationPayload: run.registration_payload,
          });
          continue;
        }
        if (status === "success") return job;
        if (status === "failed" || status === "partial_failure") {
          throw new Error(text(job.error_message) || `Shopling 등록 ${status}`);
        }
      }
      throw new Error("Shopling 등록 결과 대기 시간이 초과되었습니다.");
    },
    [patchRegistration],
  );

  const rollbackRegistration = useCallback(
    async (run: SeoRunJob, detail: string) => {
      const payload = record(run.registration_payload);
      const previous = record(payload.previous);
      if (Object.keys(previous).length) {
        await patchItem(
          run.launch_item_id,
          {
            shoplingProducts: previous.shoplingProducts,
            seoFinal: previous.seoFinal,
            selfCodeBase: previous.selfCodeBase,
            mallSeoApply: previous.mallSeoApply,
            pricePolicy: previous.pricePolicy,
            shoplingRegistrationHistory: previous.shoplingRegistrationHistory,
            seoRunDispatch: {
              status: "failed",
              seoRunId: run.run_id,
              failedAt: new Date().toISOString(),
              error: detail,
            },
          },
          "서버 SEO RUN Shopling 등록 실패 복구",
        ).catch(() => null);
      }
      await patchRegistration(run.run_id, "failed", {
        registrationJobId: run.registration_job_id,
        registrationRequestId: run.registration_request_id,
        registrationPayload: { ...payload, error: detail },
      });
    },
    [patchItem, patchRegistration],
  );

  const finalizeRegistration = useCallback(
    async (
      run: SeoRunJob,
      jobId: string,
      requestId: string,
      payloadOverride?: UnknownRecord,
    ) => {
      const payload = payloadOverride ?? record(run.registration_payload);
      const historyEntry = record(payload.historyEntry);
      const hasExistingGoods = payload.hasExistingGoods === true;
      const refreshed = await reloadItem(run.launch_item_id);
      const refreshedHistory = array(refreshed.shoplingRegistrationHistory).map(record);
      const successAt = new Date().toISOString();
      const nextHistory = hasExistingGoods
        ? refreshedHistory.map((entry) =>
            text(entry.seoRunId) === run.run_id
              ? {
                  ...entry,
                  status: "success",
                  completedAt: successAt,
                  jobId,
                  requestId,
                  newProducts: refreshed.shoplingProducts,
                  registeredSeoFinal: normalizeSeoFinal(run.result_payload),
                }
              : entry,
          )
        : [
            ...refreshedHistory,
            {
              ...historyEntry,
              status: "success",
              completedAt: successAt,
              jobId,
              requestId,
              newProducts: refreshed.shoplingProducts,
              registeredSeoFinal: normalizeSeoFinal(run.result_payload),
            },
          ];
      await patchItem(
        run.launch_item_id,
        {
          shoplingRegistrationHistory: nextHistory,
          seoRunDispatch: {
            status: "success",
            seoRunId: run.run_id,
            jobId,
            requestId,
            completedAt: successAt,
          },
        },
        "서버 SEO RUN Shopling 등록 완료",
      );
      const goodsKeys = itemGoodsKeys(refreshed);
      await patchRegistration(run.run_id, "success", {
        registrationJobId: jobId,
        registrationRequestId: requestId,
        registrationPayload: {
          ...payload,
          registeredGoodsKeys: goodsKeys,
          completedAt: successAt,
        },
      });
    },
    [patchItem, patchRegistration, reloadItem],
  );

  const registerOne = useCallback(
    async (run: SeoRunJob) => {
      const seoFinal = normalizeSeoFinal(run.result_payload);
      if (!seoFinal) throw new Error(`${run.model_number}: FINAL RESULT가 없습니다.`);
      const original = await reloadItem(run.launch_item_id);
      const previousHistory = array(original.shoplingRegistrationHistory).map(record);
      const hasExistingGoods = itemGoodsKeys(original).length > 0;
      const newSelfCodeBase = nextSelfCode();
      const reservedAt = new Date().toISOString();
      const historyEntry = {
        registrationType: hasExistingGoods
          ? "seo_inventory_append"
          : "seo_run_initial",
        seoRunId: run.run_id,
        status: "reserved",
        archivedAt: reservedAt,
        previousSelfCodeBase: text(original.selfCodeBase),
        previousProducts: original.shoplingProducts,
        previousSeoFinal: original.seoFinal ?? null,
        newSeoFinal: seoFinal,
      };
      const registrationPayload: UnknownRecord = {
        hasExistingGoods,
        reservedAt,
        newSelfCodeBase,
        historyEntry,
        previous: {
          shoplingProducts: original.shoplingProducts,
          seoFinal: original.seoFinal ?? null,
          selfCodeBase: text(original.selfCodeBase),
          mallSeoApply: original.mallSeoApply ?? null,
          pricePolicy: original.pricePolicy ?? null,
          shoplingRegistrationHistory: previousHistory,
        },
      };
      await patchRegistration(run.run_id, "submitting", {
        registrationPayload,
      });
      try {
        await patchItem(
          run.launch_item_id,
          {
            seoFinal,
            selfCodeBase: newSelfCodeBase,
            mallSeoApply: null,
            pricePolicy: null,
            shoplingRegistrationHistory: hasExistingGoods
              ? [...previousHistory, historyEntry]
              : previousHistory,
            seoRunDispatch: {
              status: "prepared",
              seoRunId: run.run_id,
              preparedAt: reservedAt,
              newSelfCodeBase,
            },
          },
          "서버 SEO RUN Shopling 등록 준비",
        );
        const started = await requestJson<{
          ok?: boolean;
          jobId?: unknown;
          requestId?: unknown;
        }>(SHOPLING_UPLOAD_API, {
          method: "POST",
          body: JSON.stringify({
            itemId: run.launch_item_id,
            force: hasExistingGoods,
          }),
        });
        const jobId = text(started.jobId);
        const requestId = text(started.requestId);
        if (!jobId) throw new Error("Shopling 작업 ID를 받지 못했습니다.");
        await patchRegistration(run.run_id, "queued", {
          registrationJobId: jobId,
          registrationRequestId: requestId,
          registrationPayload,
        });
        const resumableRun = {
          ...run,
          registration_status: "queued" as const,
          registration_job_id: jobId,
          registration_request_id: requestId,
          registration_payload: registrationPayload,
        };
        await pollShoplingJob(resumableRun, jobId);
        await finalizeRegistration(
          resumableRun,
          jobId,
          requestId,
          registrationPayload,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Shopling 등록 실패";
        await rollbackRegistration(
          { ...run, registration_payload: registrationPayload },
          detail,
        );
        throw error;
      }
    },
    [
      finalizeRegistration,
      patchItem,
      patchRegistration,
      pollShoplingJob,
      reloadItem,
      rollbackRegistration,
    ],
  );
  void registerOne;

  const registerRows = useCallback(
    async (targets: SeoRunJob[]) => {
      if (!targets.length) return;
      setRegistering(true);
      setGlobalError("");
      setGlobalMessage(
        `${targets.length}개 RUN을 서버 Shopling 등록큐에 인계합니다. 인계 후 브라우저를 닫아도 계속 처리됩니다.`,
      );
      try {
        const body = await requestJson<{
          ok?: boolean;
          queuedCount?: unknown;
          skippedCount?: unknown;
          message?: unknown;
        }>(SEO_RUN_API, {
          method: "POST",
          body: JSON.stringify({
            action: "queue_registration",
            runIds: targets.map((run) => run.run_id),
          }),
        });
        const queuedCount = Number(body.queuedCount ?? 0);
        const skippedCount = Number(body.skippedCount ?? 0);
        setGlobalMessage(
          `${queuedCount}개 RUN을 서버 등록큐에 넣었습니다.${skippedCount ? ` 이미 처리 중/완료 ${skippedCount}개는 제외했습니다.` : ""} PC를 꺼도 서버가 분 단위로 계속 소화합니다.`,
        );
        await loadJobs();
      } catch (error) {
        setGlobalError(
          error instanceof Error
            ? error.message
            : "Shopling 서버 일괄등록 요청에 실패했습니다.",
        );
      } finally {
        setRegistering(false);
      }
    },
    [loadJobs],
  );

  const retryRuns = useCallback(
    async (runIds: string[]) => {
      await requestJson(SEO_RUN_API, {
        method: "POST",
        body: JSON.stringify({ action: "retry", runIds }),
      });
      setGlobalMessage("저장된 서버 체크포인트에서 재실행을 시작했습니다.");
      await loadJobs();
    },
    [loadJobs],
  );

  const archiveRuns = useCallback(
    async (runIds: string[]) => {
      await requestJson(SEO_RUN_API, {
        method: "POST",
        body: JSON.stringify({ action: "archive", runIds }),
      });
      await loadJobs();
    },
    [loadJobs],
  );

  useEffect(() => {
    void (async () => {
      await enqueueStoredRuns();
      await loadJobs();
    })();
    const timer = window.setInterval(() => void loadJobs(), POLL_INTERVAL_MS);
    const onStorage = (event: StorageEvent) => {
      if (event.key === BATCH_STORAGE_KEY) void enqueueStoredRuns();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", loadJobs);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", loadJobs);
    };
  }, [enqueueStoredRuns, loadJobs]);

  useEffect(() => {
    if (SERVER_OWNS_SHOPLING_REGISTRATION) return;
    for (const run of jobs) {
      if (
        !["queued", "running"].includes(run.registration_status) ||
        !run.registration_job_id ||
        registrationResumeRef.current.has(run.run_id)
      ) {
        continue;
      }
      registrationResumeRef.current.add(run.run_id);
      void (async () => {
        try {
          await pollShoplingJob(run, run.registration_job_id);
          await finalizeRegistration(
            run,
            run.registration_job_id,
            run.registration_request_id,
          );
        } catch (error) {
          await rollbackRegistration(
            run,
            error instanceof Error ? error.message : "Shopling 등록 재개 실패",
          );
        } finally {
          registrationResumeRef.current.delete(run.run_id);
          await loadJobs();
        }
      })();
    }
  }, [finalizeRegistration, jobs, loadJobs, pollShoplingJob, rollbackRegistration]);

  const readyRows = useMemo(
    () => jobs.filter((job) => job.status === "ready" && normalizeSeoFinal(job.result_payload)),
    [jobs],
  );
  const registerableRows = useMemo(
    () => readyRows.filter((job) => job.registration_status === "idle"),
    [readyRows],
  );
  const failedRows = useMemo(
    () => jobs.filter((job) => job.status === "failed"),
    [jobs],
  );
  const completedRows = useMemo(
    () => jobs.filter((job) => job.registration_status === "success"),
    [jobs],
  );
  const runningRows = useMemo(
    () => jobs.filter((job) => ["queued", "running"].includes(job.status)),
    [jobs],
  );
  const registrationQueueRows = useMemo(
    () =>
      jobs.filter((job) =>
        ["submitting", "queued", "running"].includes(job.registration_status),
      ),
    [jobs],
  );

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-5 py-7 text-slate-900">
      <header className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">
              COMMERCE OS · DURABLE SEO RUN CLOUD
            </p>
            <h1 className="mt-2 text-3xl font-black">SEO 대량등록 클라우드</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              SEO 생성과 Shopling 일괄등록은 Supabase 체크포인트와 Vercel 서버 worker에서 실행됩니다.
              브라우저를 닫거나 컴퓨터를 꺼도 계속 진행하며, 한 상품이 실패해도 나머지 서버 큐는 계속 처리됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-launch-tracker"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
            >
              상품출시 진행관리
            </Link>
            <button
              type="button"
              disabled={registering || !registerableRows.length}
              onClick={() => void registerRows(registerableRows)}
              className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {registering
                ? "서버 등록큐 인계 중…"
                : `Shopling 일괄 대량등록 (${registerableRows.length})`}
            </button>
            <button
              type="button"
              disabled={!completedRows.length || registering}
              onClick={() =>
                void archiveRuns(completedRows.map((row) => row.run_id))
              }
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 disabled:opacity-40"
            >
              등록완료 카드 보관 ({completedRows.length})
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-violet-200">
            활성 등록회차 {jobs.length}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
            SEO 서버 실행 {runningRows.length}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
            Shopling 서버 큐 {registrationQueueRows.length}
          </span>
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">
            FINAL {readyRows.length}/{jobs.length}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
            등록완료 {completedRows.length}/{jobs.length}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            PC 전원과 무관 · 분 단위 자동복구
          </span>
        </div>
        {migrating ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-950">
            브라우저 작업을 서버 원장으로 인계 중…
          </div>
        ) : null}
        {globalMessage ? (
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-bold text-cyan-950">
            {globalMessage}
          </div>
        ) : null}
        {globalError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
            {globalError}
          </div>
        ) : null}
      </header>

      {failedRows.length ? (
        <button
          type="button"
          onClick={() => void retryRuns(failedRows.map((row) => row.run_id))}
          className="rounded-xl bg-violet-700 px-5 py-2 text-sm font-black text-white"
        >
          생성 오류 체크포인트 재실행 ({failedRows.length})
        </button>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center font-bold text-slate-500">
          서버 SEO RUN을 불러오는 중…
        </div>
      ) : null}
      {!loading && !jobs.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="font-black text-slate-700">
            현재 활성 SEO 등록회차가 없습니다.
          </div>
          <div className="mt-2 text-sm text-slate-500">
            상품출시 진행관리에서 원하는 상품을 선택하고 SEO 대량등록 클라우드 열기를 누르세요.
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        {jobs.map((job, index) => {
          const seoFinal = normalizeSeoFinal(job.result_payload);
          const registeredGoodsKeys = stringList(
            record(job.registration_payload).registeredGoodsKeys,
          );
          return (
            <article
              key={job.run_id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-slate-400">
                      #{index + 1}
                    </span>
                    <span className="font-black text-slate-950">
                      {job.model_number || "모델번호 없음"}
                    </span>
                    <span className="text-sm font-semibold text-slate-600">
                      {job.product_name}
                    </span>
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-800">
                      RUN {job.run_id.slice(-8)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusTone(job.status)}`}
                    >
                      {statusLabel(job)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-black ${registrationTone(job.registration_status)}`}
                    >
                      {registrationLabel(job.registration_status)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {job.message || job.stage}
                  </p>
                  {seoBulkSourceLabel(record(job.result_payload).collectionMode) ? (
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      씨드 출처: {seoBulkSourceLabel(record(job.result_payload).collectionMode)}
                    </p>
                  ) : null}
                  {job.status === "queued" || job.status === "running" ? (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-violet-600 transition-all"
                        style={{ width: `${Math.max(2, job.progress_percent)}%` }}
                      />
                    </div>
                  ) : null}
                  {job.error_message ? (
                    <p className="mt-2 break-words text-sm font-bold text-rose-700">
                      {job.error_message}
                    </p>
                  ) : null}
                  {registeredGoodsKeys.length ? (
                    <p className="mt-2 text-xs font-bold text-emerald-700">
                      새 goods_key {registeredGoodsKeys.length}/6 · {registeredGoodsKeys.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {job.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => void retryRuns([job.run_id])}
                      className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-800"
                    >
                      이 체크포인트 재실행
                    </button>
                  ) : null}
                  {job.registration_status === "success" ? (
                    <button
                      type="button"
                      onClick={() => void archiveRuns([job.run_id])}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700"
                    >
                      완료 카드 보관
                    </button>
                  ) : null}
                </div>
              </div>

              {seoFinal ? (
                <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">
                    FINAL RESULT · 검색어 10개
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {seoFinal.searchKeywords.map((keyword, keywordIndex) => (
                      <span
                        key={`${job.run_id}-${keywordIndex}-${keyword}`}
                        className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-sm font-black text-cyan-950"
                      >
                        <span className="mr-1 text-[10px] text-cyan-500">
                          #{keywordIndex + 1}
                        </span>
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                  상품명·쇼핑몰 29개·서버 체크포인트 정보 펼치기
                </summary>
                <div className="border-t border-slate-200 p-4 text-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <span className="font-black text-slate-600">회차 ID</span>
                      <div className="mt-1 break-all text-xs">{job.run_id}</div>
                    </div>
                    <div>
                      <span className="font-black text-slate-600">현재 단계</span>
                      <div className="mt-1 text-xs">
                        {job.stage} · {job.progress_percent}%
                      </div>
                    </div>
                    <div>
                      <span className="font-black text-slate-600">마지막 서버 저장</span>
                      <div className="mt-1 text-xs">
                        {new Date(job.updated_at).toLocaleString("ko-KR")}
                      </div>
                    </div>
                  </div>
                  {seoFinal ? (
                    <>
                      <div className="mt-5 font-black text-slate-700">
                        6개 기준 상품명
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        {Object.entries(seoFinal.groupProductNames)
                          .filter(([key]) => !key.startsWith("__"))
                          .map(([key, title]) => (
                            <div
                              key={`${job.run_id}-${key}`}
                              className="rounded-lg border border-slate-200 bg-white p-3"
                            >
                              <div className="text-[10px] font-black uppercase text-slate-400">
                                {key}
                              </div>
                              <div className="mt-1 font-bold text-slate-800">
                                {title}
                              </div>
                            </div>
                          ))}
                      </div>
                      <div className="mt-5 font-black text-slate-700">
                        쇼핑몰별 상품명 29/29
                      </div>
                      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
                        {seoFinal.mallTitles.map((row, titleIndex) => (
                          <div
                            key={`${job.run_id}-${titleIndex}-${row.mallKey}-${row.accountIdLabel}`}
                            className="grid grid-cols-[145px_1fr] gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0"
                          >
                            <span className="font-black text-slate-500">
                              {row.productGroup} · {row.marketName}
                            </span>
                            <span className="font-bold text-slate-800">
                              {row.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="mt-5 rounded-lg bg-white p-4 text-sm font-bold text-slate-500">
                      서버가 현재 단계의 체크포인트를 저장하고 있습니다. 컴퓨터를 꺼도 다음 cron 실행에서 이어집니다.
                    </div>
                  )}
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </main>
  );
}
