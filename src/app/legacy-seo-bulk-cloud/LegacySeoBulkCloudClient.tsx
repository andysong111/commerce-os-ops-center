"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = "/api/legacy-seo-run-jobs";
const POLL_MS = 5_000;
const REGISTRATION_BATCH_SIZE = 8;
const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";

type UnknownRecord = Record<string, unknown>;
type LegacyItem = {
  id: string;
  trackerRowNumber: number | null;
  workBatch: string;
  modelNumber: string;
  productName: string;
  shoplingCategory: string;
  shoplingUploadStatus: string;
  overallStatus: string;
  optionLabels: string[];
  updatedAt: string;
};
type Job = {
  run_id: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  product_name: string;
  source_url: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  stage: string;
  progress_percent: number;
  message: string;
  input_payload: UnknownRecord;
  checkpoint_payload: UnknownRecord;
  result_payload: UnknownRecord;
  error_message: string;
  registration_status:
    | "idle"
    | "submitting"
    | "queued"
    | "running"
    | "success"
    | "failed";
  registration_job_id: string;
  registration_payload: UnknownRecord;
  run_created_at: string;
  updated_at: string;
};

type SeoFinal = {
  searchKeywords: string[];
  mallTitles: Array<{
    productGroup: string;
    marketName: string;
    mallKey: string;
    accountIdLabel: string;
    title: string;
  }>;
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

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    return raw ? stringList(JSON.parse(raw)).slice(0, 200) : [];
  } catch {
    return [];
  }
}

function readableError(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => readableError(entry, depth + 1))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1000);
  }
  const row = record(value);
  for (const key of ["message", "error", "details", "reason", "code"]) {
    const message = readableError(row[key], depth + 1);
    if (message) return message;
  }
  return "";
}

async function requestJson<T extends UnknownRecord>(
  url: string,
  init?: RequestInit,
): Promise<T> {
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
  let body: UnknownRecord = {};
  try {
    body = raw ? record(JSON.parse(raw)) : {};
  } catch {
    throw new Error(`서버 응답을 읽지 못했습니다. HTTP ${response.status}`);
  }
  if (!response.ok || body.ok !== true) {
    throw new Error(
      readableError(body.message) || readableError(body.error) || `HTTP ${response.status}`,
    );
  }
  return body as T;
}

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
  return { searchKeywords, mallTitles };
}

function jobTone(status: Job["status"]) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "failed" || status === "cancelled") return "bg-rose-100 text-rose-800";
  if (status === "running") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function registrationTone(status: Job["registration_status"]) {
  if (status === "success") return "bg-emerald-100 text-emerald-800";
  if (status === "failed") return "bg-rose-100 text-rose-800";
  if (["submitting", "queued", "running"].includes(status)) {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-slate-100 text-slate-600";
}

function actualSourceMode(job: Job) {
  const checkpoint = record(job.checkpoint_payload);
  const actual = text(checkpoint.legacySourceMode);
  if (actual === "1688_plus_shopling") return "1688 + Shopling";
  if (actual === "shopling_fallback") return "Shopling 대체";
  const evidence = record(job.input_payload.legacyShoplingEvidence);
  const planned = text(evidence.sourceMode);
  return planned === "1688_plus_shopling" ? "1688 + Shopling 준비" : "Shopling-only 준비";
}

function sourceTone(mode: string) {
  return mode.includes("대체") || mode.includes("only")
    ? "bg-violet-100 text-violet-800"
    : "bg-sky-100 text-sky-800";
}

export default function LegacySeoBulkCloudClient() {
  const [items, setItems] = useState<LegacyItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const body = await requestJson<{
        ok?: boolean;
        items?: LegacyItem[];
        jobs?: Job[];
      }>(API);
      setItems(Array.isArray(body.items) ? body.items : []);
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "목록을 불러오지 못했습니다.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.modelNumber, item.productName, item.shoplingCategory, ...item.optionLabels]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [items, search]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => !["ready", "failed", "cancelled"].includes(job.status)),
    [jobs],
  );
  const readyJobs = useMemo(() => jobs.filter((job) => job.status === "ready"), [jobs]);
  const failedJobs = useMemo(() => jobs.filter((job) => job.status === "failed"), [jobs]);
  const registerableJobs = useMemo(
    () => readyJobs.filter((job) => ["idle", "failed"].includes(job.registration_status)),
    [readyJobs],
  );

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected(new Set(filteredItems.slice(0, 100).map((item) => item.id)));
  };

  const runAction = useCallback(
    async (action: string, payload: UnknownRecord) => {
      setBusy(true);
      setError("");
      try {
        const body = await requestJson(API, {
          method: "POST",
          body: JSON.stringify({ action, ...payload }),
        });
        const missing = stringList(body.missing);
        if (action === "enqueue") {
          setMessage(
            `이전상품 SEO RUN ${Number(body.insertedCount) || 0}건을 시작했습니다.${
              missing.length ? ` · 제외 ${missing.length}건: ${missing.slice(0, 5).join(", ")}` : ""
            }`,
          );
          setSelected(new Set());
        } else if (action === "register") {
          const results = array(body.results).map(record);
          const started = results.filter((row) => row.started === true).length;
          const failed = results.filter((row) => text(row.error)).length;
          setMessage(`Shopling 신규등록 ${started}건 시작${failed ? ` · 준비실패 ${failed}건` : ""}`);
        } else {
          setMessage("요청을 반영했습니다.");
        }
        await load();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "요청에 실패했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const enqueue = () => {
    if (!selected.size) {
      setError("이전상품을 1개 이상 선택하세요.");
      return;
    }
    void runAction("enqueue", {
      itemIds: [...selected],
      customBlockedTerms: readCustomBlockedTerms(),
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        이전상품·전용 SEO 원장을 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(message || error) && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">1. 이전상품 선택</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              상품출시 진행관리의 `등록완료건` 중 Shopling 등록완료 상품만 표시합니다. 실행 시 Product Master의 모델번호 연결을 통해 실제 goods_key가 있는지 다시 검증합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={selectVisible}
              className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50"
            >
              현재목록 선택
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50"
            >
              선택해제
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={enqueue}
              className="rounded-lg bg-violet-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              선택 {selected.size}개 SEO RUN 시작
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="모델번호·상품명·카테고리 검색"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <span className="text-xs text-slate-500">
            후보 {filteredItems.length}개 · 최대 100개/실행
          </span>
        </div>

        <div className="mt-4 max-h-[470px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="w-12 px-3 py-2">선택</th>
                <th className="px-3 py-2">모델번호</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">Shopling 카테고리</th>
                <th className="px-3 py-2">옵션</th>
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-semibold">{item.modelNumber || "-"}</td>
                  <td className="px-3 py-2">{item.productName || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{item.shoplingCategory || "-"}</td>
                  <td className="max-w-[360px] px-3 py-2 text-xs text-slate-500">
                    {item.optionLabels.length ? item.optionLabels.join(", ") : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                      기존 Shopling 완료
                    </span>
                  </td>
                </tr>
              ))}
              {!filteredItems.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    조건에 맞는 이전상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">2. 이전상품 SEO 작업원장</h2>
            <p className="mt-1 text-xs text-slate-500">
              기존 `seo_run_jobs`와 다른 전용 원장입니다. 브라우저가 닫혀도 Adaptive Dispatcher가 이어서 실행합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1">전체 {jobs.length}</span>
            <span className="rounded-full bg-amber-100 px-2 py-1">실행중 {activeJobs.length}</span>
            <span className="rounded-full bg-emerald-100 px-2 py-1">FINAL {readyJobs.length}</span>
            <span className="rounded-full bg-rose-100 px-2 py-1">오류 {failedJobs.length}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || failedJobs.length === 0}
            onClick={() =>
              void runAction("retry", { runIds: failedJobs.map((job) => job.run_id) })
            }
            className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-40"
          >
            생성실패 전체 재시도
          </button>
          <button
            type="button"
            disabled={busy || registerableJobs.length === 0}
            onClick={() =>
              void runAction("register", {
                runIds: registerableJobs.slice(0, REGISTRATION_BATCH_SIZE).map((job) => job.run_id),
              })
            }
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            FINAL Shopling 신규등록 (8건씩)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            새로고침
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {[...jobs]
            .sort((a, b) => b.run_created_at.localeCompare(a.run_created_at))
            .map((job) => {
              const evidence = record(job.input_payload.legacyShoplingEvidence);
              const goodsKeys = stringList(evidence.goodsKeys);
              const legacyTitles = stringList(evidence.titles);
              const legacyKeywords = stringList(evidence.searchKeywords);
              const final = normalizeSeoFinal(job.result_payload);
              const mode = actualSourceMode(job);
              return (
                <div key={job.run_id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold">{job.model_number || job.product_name}</span>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${jobTone(job.status)}`}>
                          {job.status === "ready"
                            ? "FINAL 완료"
                            : job.status === "running"
                              ? "실행 중"
                              : job.status === "queued"
                                ? "대기"
                                : job.status === "failed"
                                  ? "오류"
                                  : "취소"}
                        </span>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${sourceTone(mode)}`}>
                          {mode}
                        </span>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${registrationTone(
                            job.registration_status,
                          )}`}
                        >
                          Shopling {job.registration_status}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{job.product_name}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {job.message} · {Math.max(0, Math.min(100, job.progress_percent || 0))}%
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {job.status === "failed" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("retry", { runIds: [job.run_id] })}
                          className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700"
                        >
                          다시시도
                        </button>
                      )}
                      {job.status === "ready" && ["idle", "failed"].includes(job.registration_status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("register", { runIds: [job.run_id] })}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Shopling 신규등록
                        </button>
                      )}
                      {!["running", "queued"].includes(job.status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("archive", { runIds: [job.run_id] })}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
                        >
                          보관
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-violet-600 transition-all"
                      style={{ width: `${Math.max(1, Math.min(100, job.progress_percent || 1))}%` }}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-500">Shopling 원본</div>
                      <div className="mt-1 text-xs leading-5 text-slate-700">
                        goods_key: {goodsKeys.length ? goodsKeys.slice(0, 12).join(", ") : "-"}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-600">
                        상품명 {legacyTitles.length}개 · 검색어 {legacyKeywords.length}개
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-500">1688 원본</div>
                      <div className="mt-1 break-all text-xs leading-5 text-slate-700">
                        {job.source_url.startsWith("shopling://") ? "없음 · Shopling 대체" : job.source_url}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-500">FINAL</div>
                      <div className="mt-1 text-xs leading-5 text-slate-700">
                        {final
                          ? `상품명 29개 · 검색어 ${final.searchKeywords.join(", ")}`
                          : job.status === "failed"
                            ? job.error_message || "생성 실패"
                            : "생성 중"}
                      </div>
                    </div>
                  </div>

                  {(legacyTitles.length > 0 || legacyKeywords.length > 0) && (
                    <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                        사용한 기존 Shopling 상품명·검색어 보기
                      </summary>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-500">기존 상품명</div>
                          <div className="mt-1 text-xs leading-5 text-slate-700">
                            {legacyTitles.join(" · ") || "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-500">기존 검색어</div>
                          <div className="mt-1 text-xs leading-5 text-slate-700">
                            {legacyKeywords.join(", ") || "-"}
                          </div>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          {!jobs.length && (
            <div className="rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">
              아직 이전상품 SEO RUN 기록이 없습니다.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
