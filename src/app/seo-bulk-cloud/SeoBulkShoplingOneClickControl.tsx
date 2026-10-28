"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SEO_RUN_API = "/api/seo-run-jobs";
const AUTO_API = "/api/shopling-market-auto-orchestration";
const BRIDGE_PROBE = "commerce-os-shopling-market-auto-probe-v0330";
const BRIDGE_PROBE_ACK = "commerce-os-shopling-market-auto-probe-ack-v0330";
const BRIDGE_HANDOFF = "commerce-os-shopling-market-auto-handoff-v0330";
const BRIDGE_HANDOFF_ACK = "commerce-os-shopling-market-auto-handoff-ack-v0330";
const PENDING_STORAGE_KEY = "commerceOs.shoplingMarketAutoHandoff.v0330";
const LATEST_EXTENSION_DOWNLOAD =
  "/api/shopling-market-group-canary/v0344/download";
const POLL_MS = 4_000;

type UnknownRecord = Record<string, unknown>;
type SeoRunRow = {
  run_id: string;
  batch_id: string;
  status: string;
  registration_status: string;
  registration_job_id: string;
  model_number: string;
  run_created_at: string;
  updated_at: string;
};

type PipelineMode = "full_pipeline" | "market_only";

type AutoRow = {
  id: string;
  state: string;
  run_ids: unknown;
  error_message: string;
  result: unknown;
  created_at: string;
  updated_at: string;
};

class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function createHandoffToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function runTimestamp(row: SeoRunRow) {
  const parsed = Date.parse(text(row.run_created_at || row.updated_at));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function requestJson(url: string, init?: RequestInit) {
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
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok || body.ok !== true) {
    throw new RequestError(
      text(body.message) || text(body.error) || `HTTP ${response.status}`,
      response.status,
    );
  }
  return body;
}

function waitForBridgeAck(type: string, requestId: string, timeoutMs: number) {
  return new Promise<UnknownRecord | null>((resolve) => {
    let done = false;
    const finish = (value: UnknownRecord | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const row = record(event.data);
      if (text(row.type) !== type || text(row.requestId) !== requestId) return;
      finish(row);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
  });
}

async function probeExtension() {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_PROBE_ACK, requestId, 1_800);
  window.postMessage({ type: BRIDGE_PROBE, requestId }, window.location.origin);
  const ack = await pending;
  return ack?.ok === true && text(ack.version) === "0.3.30";
}

async function handoffToExtension(orchestrationId: string, token: string) {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_HANDOFF_ACK, requestId, 3_000);
  window.postMessage(
    { type: BRIDGE_HANDOFF, requestId, orchestrationId, token },
    window.location.origin,
  );
  const ack = await pending;
  return ack?.ok === true;
}

async function createOrResumeOrchestration(
  mode: PipelineMode,
  runIds: string[],
  token: string,
) {
  return requestJson(AUTO_API, {
    method: "POST",
    body: JSON.stringify({
      action: mode === "market_only" ? "create_market_only" : "create",
      runIds,
      handoffToken: token,
    }),
  });
}

function stateLabel(state: string) {
  return (
    {
      waiting_upload: "Shopling 업로드 대기",
      uploading: "Shopling 업로드 중",
      market_ready: "마켓전송 준비",
      market_claimed: "브라우저 에이전트 연결",
      market_running: "마켓전송 중",
      completed: "Shopling 업로드 + 마켓전송 완료",
      completed_with_exceptions: "완료 · 일부 예외 확인필요",
      exception: "예외",
      cancelled: "취소",
    }[state] ?? state
  ) || "대기";
}

function terminalState(state: string) {
  return ["completed", "completed_with_exceptions", "exception", "cancelled"].includes(state);
}

export default function SeoBulkShoplingOneClickControl() {
  const [jobs, setJobs] = useState<SeoRunRow[]>([]);
  const [orchestrations, setOrchestrations] = useState<AutoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null);

  const checkBridge = useCallback(async () => {
    setError("");
    setMessage("브라우저 에이전트 연결을 확인합니다…");
    const available = await probeExtension();
    setBridgeReady(available);
    if (available) {
      setMessage("브라우저 에이전트 연결 확인 완료 · 아직 상품 전송은 시작하지 않았습니다.");
      return;
    }
    setMessage("");
    setError(
      "최신 Shopling Market Sender v0.3.44 연결이 필요합니다. 설치 후 Commerce OS와 Shopling A18 탭을 새로고침하세요.",
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const [runsBody, autoBody] = await Promise.all([
        requestJson(SEO_RUN_API),
        requestJson(AUTO_API),
      ]);
      setJobs(Array.isArray(runsBody.jobs) ? (runsBody.jobs as SeoRunRow[]) : []);
      setOrchestrations(
        Array.isArray(autoBody.orchestrations)
          ? (autoBody.orchestrations as AutoRow[])
          : [],
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "원클릭 상태 조회 실패");
    }
  }, []);

  const latestBatchId = useMemo(() => {
    const newest = [...jobs]
      .filter((job) => text(job.batch_id))
      .sort((left, right) => runTimestamp(right) - runTimestamp(left))[0];
    return text(newest?.batch_id);
  }, [jobs]);
  const latestBatchRuns = useMemo(
    () => jobs.filter((job) => text(job.batch_id) === latestBatchId),
    [jobs, latestBatchId],
  );
  const readyRuns = useMemo(
    () =>
      latestBatchRuns.filter(
        (job) => job.status === "ready" && job.registration_status === "idle",
      ),
    [latestBatchRuns],
  );
  const marketOnlyRuns = useMemo(
    () =>
      latestBatchRuns.filter(
        (job) =>
          job.status === "ready" &&
          job.registration_status === "success" &&
          text(job.registration_job_id),
      ),
    [latestBatchRuns],
  );
  const latest = orchestrations[0] ?? null;

  const retryPendingHandoff = useCallback(async () => {
    let pending: UnknownRecord = {};
    try {
      pending = record(JSON.parse(window.localStorage.getItem(PENDING_STORAGE_KEY) || "{}"));
    } catch {
      return;
    }
    let orchestrationId = text(pending.orchestrationId);
    const token = text(pending.token);
    const mode: PipelineMode = pending.mode === "market_only" ? "market_only" : "full_pipeline";
    const runIds = Array.isArray(pending.runIds)
      ? pending.runIds.map(text).filter(Boolean)
      : [];
    if (!token || (!orchestrationId && !runIds.length)) return;
    try {
      if (!orchestrationId) {
        const body = await createOrResumeOrchestration(mode, runIds, token);
        orchestrationId = text(body.orchestrationId);
        if (!orchestrationId) return;
        window.localStorage.setItem(
          PENDING_STORAGE_KEY,
          JSON.stringify({ ...pending, orchestrationId }),
        );
      }
      const available = await probeExtension();
      setBridgeReady(available);
      if (!available) return;
      if (await handoffToExtension(orchestrationId, token)) {
        window.localStorage.removeItem(PENDING_STORAGE_KEY);
        setMessage(
          mode === "market_only"
            ? "마켓전송만 재개 연결 완료 · 기존 SEO와 Shopling 상품등록은 다시 실행하지 않습니다."
            : "브라우저 에이전트 연결 복구 완료 · Shopling 업로드 후 마켓전송까지 자동으로 이어집니다.",
        );
      }
    } catch (retryError) {
      if (retryError instanceof RequestError && retryError.status < 500) {
        window.localStorage.removeItem(PENDING_STORAGE_KEY);
      }
      setError(
        retryError instanceof Error
          ? retryError.message
          : "저장된 원클릭 작업 재연결 실패",
      );
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
      void retryPendingHandoff();
    }, 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load, retryPendingHandoff]);

  const startPipeline = useCallback(async (
    mode: PipelineMode,
    targets: SeoRunRow[],
  ) => {
    if (!targets.length || busy) return;
    setBusy(true);
    setError("");
    setMessage("v0.3.30 브라우저 에이전트 연결을 확인합니다…");
    try {
      const available = await probeExtension();
      setBridgeReady(available);
      if (!available) {
        throw new Error("Shopling Market Sender가 연결되지 않았습니다. 최신 v0.3.44 설치 후 Commerce OS와 Shopling 관리자/A18 탭을 새로고침하고 다시 확인하세요.");
      }
      const runIds = targets.map((row) => row.run_id);
      const token = createHandoffToken();
      setMessage(
        mode === "market_only"
          ? `${targets.length}개 상품은 SEO·Shopling 재등록 없이 마켓전송만 재개합니다…`
          : `${targets.length}개 상품의 Shopling 업로드 + 마켓전송 원클릭 작업을 서버에 등록합니다…`,
      );
      window.localStorage.setItem(
        PENDING_STORAGE_KEY,
        JSON.stringify({ mode, runIds, token, createdAt: Date.now() }),
      );
      const body = await createOrResumeOrchestration(mode, runIds, token);
      const orchestrationId = text(body.orchestrationId);
      if (!orchestrationId || text(body.handoffToken) !== token) {
        throw new Error("원클릭 작업 인계 확인값이 일치하지 않습니다.");
      }
      window.localStorage.setItem(
        PENDING_STORAGE_KEY,
        JSON.stringify({ mode, runIds, orchestrationId, token, createdAt: Date.now() }),
      );
      let handed = false;
      for (let attempt = 0; attempt < 4 && !handed; attempt += 1) {
        if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 700));
        handed = await handoffToExtension(orchestrationId, token);
      }
      if (!handed) {
        throw new Error("서버 작업은 생성됐지만 확장프로그램 인계 확인을 받지 못했습니다. 이 페이지를 유지하면 자동 재연결을 시도합니다.");
      }
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
      setMessage(
        mode === "market_only"
          ? `${Number(body.acceptedCount || targets.length)}개 상품·${Number(body.verifiedGoodsKeyCount || targets.length * 6)}개 기존 goods_key 검증 완료 · 마켓전송만 진행합니다.`
          : `${Number(body.acceptedCount || targets.length)}개 상품 인계 완료 · 이제 Shopling 업로드 → 도매1~소매2 마켓전송까지 자동 진행합니다.`,
      );
      await load();
    } catch (startError) {
      if (startError instanceof RequestError && startError.status < 500) {
        window.localStorage.removeItem(PENDING_STORAGE_KEY);
      }
      setError(startError instanceof Error ? startError.message : "원클릭 작업 시작 실패");
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const start = useCallback(
    () => startPipeline("full_pipeline", readyRuns),
    [readyRuns, startPipeline],
  );
  const startMarketOnly = useCallback(
    () => startPipeline("market_only", marketOnlyRuns),
    [marketOnlyRuns, startPipeline],
  );

  return (
    <section className="mx-auto mt-5 max-w-[1500px] px-5">
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
              COMMERCE OS · ONE CLICK SHOPLING PIPELINE
            </p>
            <h2 className="mt-1 text-xl font-black">Shopling 업로드 → 마켓전송 원클릭</h2>
            <p className="mt-1 text-sm text-slate-600">
              Shopling 로그인/A18 탭과 최신 확장 v0.3.44를 열어두면 확장프로그램 팝업을 조작하지 않아도 됩니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
              <a
                href={LATEST_EXTENSION_DOWNLOAD}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-emerald-800"
              >
                최신 확장 v0.3.44 다운로드
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => void checkBridge()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 disabled:opacity-40"
              >
                연결 다시 확인
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || readyRuns.length === 0}
              onClick={() => void start()}
              className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-40"
            >
              {busy
                ? "원클릭 작업 연결 중…"
                : `샵플링 일괄 대량등록 및 마켓전송 (${readyRuns.length})`}
            </button>
            <button
              type="button"
              disabled={busy || marketOnlyRuns.length === 0}
              onClick={() => void startMarketOnly()}
              className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-40"
            >
              {busy
                ? "재개 작업 연결 중…"
                : `기존 등록상품 마켓전송만 재개 (${marketOnlyRuns.length})`}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-emerald-200">
            등록 가능 {readyRuns.length}개
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900 ring-1 ring-amber-200">
            마켓전송만 재개 가능 {marketOnlyRuns.length}개
          </span>
          <span className={`rounded-full px-3 py-1 ${bridgeReady === true ? "bg-emerald-100 text-emerald-800" : bridgeReady === false ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"}`}>
            브라우저 에이전트 {bridgeReady === true ? "연결 완료" : bridgeReady === false ? "연결 필요" : "확인 대기"}
          </span>
          {latest ? (
            <span className={`rounded-full px-3 py-1 ${terminalState(text(latest.state)) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              최근 원클릭 · {stateLabel(text(latest.state))}
            </span>
          ) : null}
        </div>
        {marketOnlyRuns.length ? (
          <p className="mt-3 text-xs font-bold text-amber-800">
            이 버튼은 최신 작업묶음의 기존 goods_key만 사용합니다. SEO 생성과 Shopling 상품등록은 다시 실행하지 않습니다.
          </p>
        ) : null}
        {message ? <p className="mt-3 text-sm font-bold text-emerald-800">{message}</p> : null}
        {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
        {latest?.error_message ? (
          <p className="mt-2 text-xs font-bold text-rose-700">최근 예외: {latest.error_message}</p>
        ) : null}
      </div>
    </section>
  );
}
