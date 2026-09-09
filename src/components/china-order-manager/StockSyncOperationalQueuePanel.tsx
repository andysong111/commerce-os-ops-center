"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type SyncJob = {
  jobId: string;
  barcode: string;
  productName: string;
  productKind: ProductKind;
  modelNo: string | null;
  goodsKeys: string[];
  desiredStatus: DesiredStatus;
  desiredSince: string;
  exactInventoryQuantity: number;
  resetAt: string;
  route: string[];
  operationalQueue?: true;
  parallelBatchId?: string;
  parallelLane?: number;
  ignoreWindowClose?: true;
};

type StockRow = {
  barcode: string;
  productName: string;
  productKind: ProductKind;
  exactInventoryQuantity: number;
  desiredStatus: DesiredStatus;
  desiredSince: string;
  latestSyncOutcome: SyncOutcome | null;
  latestSyncAt: string | null;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

type StockReport = {
  state: "READY" | "BLOCKED";
  pendingSyncCount: number;
  uncertainSyncCount: number;
  rows: StockRow[];
};

type QueuePayload = {
  ok?: boolean;
  jobs?: SyncJob[];
  report?: StockReport;
  message?: string;
};

type ResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: SyncJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

type ActiveBatch = {
  mode: "PARALLEL" | "SINGLE";
  batchId: string;
  jobs: SyncJob[];
  terminalJobIds: Set<string>;
};

type LocalException = {
  jobId: string;
  barcode: string;
  outcome: "FAILED" | "UNCERTAIN";
  message: string;
};

const PARALLEL_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START";
const PARALLEL_STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_STATUS";
const SINGLE_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
const REFRESH_MS = 30_000;

function statusLabel(value: DesiredStatus) {
  return value === "SOLD_OUT" ? "품절" : "판매중";
}

function kindLabel(value: ProductKind) {
  return value === "OPTION" ? "옵션" : "단품";
}

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function stableEventId(prefix: string, job: SyncJob, outcome: SyncOutcome, finishedAt?: number) {
  return [prefix, job.jobId, outcome, Number(finishedAt || 0)]
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

function prioritySort(left: SyncJob, right: SyncJob) {
  // 품절을 먼저 처리해 초과판매 위험을 낮추고, 같은 상태에서는 오래된 전환부터 처리한다.
  const leftPriority = left.desiredStatus === "SOLD_OUT" ? 0 : 1;
  const rightPriority = right.desiredStatus === "SOLD_OUT" ? 0 : 1;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const time = Date.parse(left.desiredSince) - Date.parse(right.desiredSince);
  if (Number.isFinite(time) && time !== 0) return time;
  return left.barcode.localeCompare(right.barcode);
}

function operationalJob(job: SyncJob, batchId: string, lane: number): SyncJob {
  return {
    ...job,
    operationalQueue: true,
    parallelBatchId: batchId,
    parallelLane: lane,
    ignoreWindowClose: true,
  };
}

export function StockSyncOperationalQueuePanel() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [report, setReport] = useState<StockReport | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [draining, setDraining] = useState(false);
  const [phase, setPhase] = useState("IDLE");
  const [notice, setNotice] = useState("");
  const [runningBarcodes, setRunningBarcodes] = useState<string[]>([]);
  const [localExceptions, setLocalExceptions] = useState<LocalException[]>([]);

  const jobsById = useRef(new Map<string, SyncJob>());
  const handledResults = useRef(new Set<string>());
  const activeBatch = useRef<ActiveBatch | null>(null);
  const excludedThisRun = useRef(new Set<string>());
  const continueAfterBatch = useRef(false);

  const loadQueue = useCallback(async () => {
    const response = await fetch("/api/inventory-stock-control/sync", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json().catch(() => ({}))) as QueuePayload;
    if (!response.ok || !payload.report) {
      throw new Error(payload.message || "운영 재고상태 큐를 불러오지 못했습니다.");
    }
    const nextJobs = Array.isArray(payload.jobs) ? [...payload.jobs].sort(prioritySort) : [];
    setJobs(nextJobs);
    setReport(payload.report);
    nextJobs.forEach((job) => jobsById.current.set(job.jobId, job));
    return { jobs: nextJobs, report: payload.report };
  }, []);

  const recordSync = useCallback(
    async (
      job: SyncJob,
      outcome: SyncOutcome,
      message: string,
      evidence?: unknown,
      finishedAt?: number,
    ) => {
      const response = await fetch("/api/inventory-stock-control/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          eventId:
            outcome === "STARTED"
              ? stableEventId("shopling-stock-started", job, outcome)
              : stableEventId("shopling-stock-result", job, outcome, finishedAt || Date.now()),
          jobId: job.jobId,
          barcode: job.barcode,
          productKind: job.productKind,
          modelNo: job.modelNo,
          desiredStatus: job.desiredStatus,
          outcome,
          message,
          evidence: {
            operationalQueue: true,
            twoLaneMax: 2,
            windowCloseIgnored: true,
            ...(evidence && typeof evidence === "object" && !Array.isArray(evidence)
              ? (evidence as Record<string, unknown>)
              : { extensionEvidence: evidence ?? null }),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "운영 큐 Shopling 결과를 원장에 저장하지 못했습니다.");
      }
    },
    [],
  );

  const blockedRows = useMemo(
    () =>
      (report?.rows ?? []).filter((row) => row.syncNeeded && row.syncBlocked),
    [report],
  );

  const launchNext = useCallback(async () => {
    if (!continueAfterBatch.current) {
      setDraining(false);
      setPhase("PAUSED");
      activeBatch.current = null;
      setRunningBarcodes([]);
      return;
    }

    const payload = await loadQueue();
    const available = payload.jobs
      .filter((job) => !excludedThisRun.current.has(job.jobId))
      .sort(prioritySort);

    if (!available.length) {
      activeBatch.current = null;
      setRunningBarcodes([]);
      setDraining(false);
      setPhase("DONE");
      setNotice(
        localExceptions.length || blockedRows.length
          ? "실행 가능한 운영 큐는 비었습니다. 실패/보류 건은 예외 큐에 남겨 자동 재시도하지 않습니다."
          : "운영 재고상태 큐 처리 완료 · 현재 실행 가능한 Shopling 품절·판매중 대기건이 없습니다.",
      );
      return;
    }

    const selected = available.slice(0, 2);
    const batchId = randomId("stock-sync-ops-batch");
    const prepared = selected.map((job, index) => operationalJob(job, batchId, index + 1));
    jobsById.current.clear();
    prepared.forEach((job) => jobsById.current.set(job.jobId, job));
    setRunningBarcodes(prepared.map((job) => job.barcode));
    setPhase(prepared.length === 2 ? "STARTING_2_LANE" : "STARTING_SINGLE");

    await Promise.all(
      prepared.map((job) =>
        recordSync(
          job,
          "STARTED",
          `운영 큐 ${job.parallelLane || 1}번 Lane 시작 · 현재 정확재고 ${job.exactInventoryQuantity}개 기준 Shopling ${statusLabel(job.desiredStatus)} 반영`,
          {
            operationalQueue: true,
            operationalBatchId: batchId,
            operationalLane: job.parallelLane || 1,
            desiredSince: job.desiredSince,
          },
        ),
      ),
    );

    activeBatch.current = {
      mode: prepared.length === 2 ? "PARALLEL" : "SINGLE",
      batchId,
      jobs: prepared,
      terminalJobIds: new Set<string>(),
    };

    if (prepared.length === 2) {
      window.postMessage(
        { type: PARALLEL_START, batchId, jobs: prepared },
        window.location.origin,
      );
      setNotice(
        `${prepared[0].barcode} + ${prepared[1].barcode} 운영 큐 2-Lane 시작 · 품절 우선순위로 최대 2건을 겹쳐 처리합니다.`,
      );
    } else {
      window.postMessage(
        { type: SINGLE_START, job: prepared[0] },
        window.location.origin,
      );
      setNotice(`${prepared[0].barcode} 운영 큐 마지막 1건을 단독 실행합니다.`);
    }
  }, [blockedRows.length, loadQueue, localExceptions.length, recordSync]);

  useEffect(() => {
    void loadQueue().catch((error) => {
      setNotice(error instanceof Error ? error.message : "운영 큐 조회 실패");
    });
    const timer = window.setInterval(() => {
      if (!activeBatch.current) {
        void loadQueue().catch(() => undefined);
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      const data = event.data as Record<string, unknown>;
      const type = String(data.type || "");

      if (type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY") {
        setExtensionReady(true);
        return;
      }

      if (type === PARALLEL_STATUS) {
        const batch = activeBatch.current;
        if (!batch || batch.mode !== "PARALLEL") return;
        const batchId = String(data.batchId || "");
        if (batchId && batchId !== batch.batchId) return;
        const nextPhase = String(data.phase || "");
        if (nextPhase) setPhase(nextPhase);
        if (data.ok === false) {
          void (async () => {
            const message = String(data.message || "HF28 운영 큐 병렬 시작에 실패했습니다.");
            for (const job of batch.jobs) {
              if (batch.terminalJobIds.has(job.jobId)) continue;
              excludedThisRun.current.add(job.jobId);
              await recordSync(job, "FAILED", message, {
                code: String(data.code || "OPERATIONAL_PARALLEL_START_FAILED"),
                operationalQueue: true,
                operationalBatchId: batch.batchId,
              }).catch(() => undefined);
              setLocalExceptions((current) => [
                ...current.filter((row) => row.jobId !== job.jobId),
                { jobId: job.jobId, barcode: job.barcode, outcome: "FAILED", message },
              ]);
            }
            activeBatch.current = null;
            setRunningBarcodes([]);
            setNotice(`${message} · 해당 2건은 이번 실행에서 자동 재시도하지 않습니다.`);
            window.setTimeout(() => void launchNext(), 800);
          })();
        }
        return;
      }

      if (type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;
      const result = data as unknown as ResultMessage;
      const batch = activeBatch.current;
      if (!batch || !batch.jobs.some((job) => job.jobId === result.jobId)) return;
      const resultKey = `${result.jobId}:${result.outcome}:${Number(result.finishedAt || 0)}`;
      if (handledResults.current.has(resultKey)) return;
      const job = result.job || batch.jobs.find((row) => row.jobId === result.jobId) || jobsById.current.get(result.jobId) || null;
      if (!job) return;
      handledResults.current.add(resultKey);

      void (async () => {
        try {
          await recordSync(job, result.outcome, result.message || "", result.evidence, result.finishedAt);
          batch.terminalJobIds.add(job.jobId);

          if (result.outcome !== "SUCCEEDED") {
            excludedThisRun.current.add(job.jobId);
            setLocalExceptions((current) => [
              ...current.filter((row) => row.jobId !== job.jobId),
              {
                jobId: job.jobId,
                barcode: job.barcode,
                outcome: result.outcome,
                message: result.message || "원인 확인 필요",
              },
            ]);
          }

          if (batch.terminalJobIds.size < batch.jobs.length) {
            setNotice(
              `${job.barcode} ${result.outcome} · 같은 배치의 다른 Lane 결과를 기다리며 창 닫힘 여부는 무시합니다.`,
            );
            return;
          }

          activeBatch.current = null;
          setRunningBarcodes([]);
          await loadQueue();
          setNotice(
            batch.jobs.every((row) => !excludedThisRun.current.has(row.jobId))
              ? "현재 운영 배치 완료 · 다음 대기건을 자동으로 이어서 배정합니다."
              : "현재 운영 배치 종료 · 실패/불확실 건은 예외 큐로 격리하고 정상 대기건만 계속 처리합니다.",
          );
          window.setTimeout(() => void launchNext(), 900);
        } catch (error) {
          handledResults.current.delete(resultKey);
          continueAfterBatch.current = false;
          activeBatch.current = null;
          setRunningBarcodes([]);
          setDraining(false);
          setPhase("RESULT_PERSIST_FAILED");
          setNotice(error instanceof Error ? error.message : "운영 큐 결과 저장 실패");
        }
      })();
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, [launchNext, loadQueue, recordSync]);

  const startDrain = async () => {
    setNotice("");
    if (!extensionReady) {
      setNotice("HF28 재고상태 확장프로그램이 연결되어야 운영 큐를 실행할 수 있습니다.");
      return;
    }
    if (draining || activeBatch.current) {
      setNotice("이미 운영 재고상태 큐가 실행 중입니다.");
      return;
    }
    if (report?.state !== "READY") {
      setNotice("정확재고 원장이 READY가 아니므로 Shopling 자동송신을 시작하지 않습니다.");
      return;
    }
    handledResults.current.clear();
    excludedThisRun.current.clear();
    setLocalExceptions([]);
    continueAfterBatch.current = true;
    setDraining(true);
    setPhase("QUEUE_DRAIN_START");
    try {
      await launchNext();
    } catch (error) {
      continueAfterBatch.current = false;
      setDraining(false);
      setPhase("START_FAILED");
      setNotice(error instanceof Error ? error.message : "운영 큐 시작 실패");
    }
  };

  const pauseAfterCurrent = () => {
    continueAfterBatch.current = false;
    setNotice(
      activeBatch.current
        ? "현재 실행 중인 Lane은 끝까지 기록하고, 그 다음 대기건부터 자동배정을 중지합니다."
        : "운영 큐 자동배정을 중지했습니다.",
    );
    if (!activeBatch.current) {
      setDraining(false);
      setPhase("PAUSED");
    }
  };

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-sky-800">
            OPERATION QUEUE · EXACT INVENTORY → SHOPLING · MAX 2 LANES
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">실제 운영 재고상태 자동 큐</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
            Commerce OS 정확재고가 만든 syncNeeded만 실행 대상으로 사용합니다. 품절을 판매중보다 먼저 처리하고 최대 2건을 HF28 Lane으로 겹쳐 실행합니다. FAILED/UNCERTAIN은 같은 실행에서 자동 재시도하지 않고 예외 큐로 격리하며, 결과창 닫힘 여부는 다음 작업 진행과 성공판정 조건에서 제외합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className={`rounded-full border px-3 py-1.5 ${extensionReady ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {extensionReady ? "HF28 연결됨" : "HF28 연결 대기"}
          </span>
          <span className={`rounded-full border px-3 py-1.5 ${report?.state === "READY" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
            원장 {report?.state || "조회중"}
          </span>
        </div>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-sky-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-500">실행 가능 대기</div>
          <div className="mt-1 text-2xl font-black text-slate-950">{jobs.length}</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-500">현재 Lane</div>
          <div className="mt-1 text-lg font-black text-slate-950">{runningBarcodes.length ? runningBarcodes.join(" + ") : "없음"}</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-500">차단/확인 필요</div>
          <div className="mt-1 text-2xl font-black text-slate-950">{blockedRows.length + localExceptions.length}</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-500">운영 단계</div>
          <div className="mt-1 text-sm font-black text-slate-950">{phase}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void startDrain()}
          disabled={draining || !extensionReady || report?.state !== "READY" || !jobs.length}
          className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:bg-slate-400"
        >
          현재 대기건 2-Lane 자동처리
        </button>
        <button
          type="button"
          onClick={pauseAfterCurrent}
          disabled={!draining}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
        >
          현재 배치 후 중지
        </button>
        <button
          type="button"
          onClick={() => void loadQueue().catch((error) => setNotice(error instanceof Error ? error.message : "큐 새로고침 실패"))}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
        >
          큐 새로고침
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-sky-200 bg-white">
        <table className="min-w-[900px] text-left text-xs">
          <thead className="bg-sky-100/70 text-slate-600">
            <tr>
              <th className="px-3 py-3">우선순위 / B코드</th>
              <th className="px-3 py-3">형태</th>
              <th className="px-3 py-3 text-right">정확재고</th>
              <th className="px-3 py-3">목표상태</th>
              <th className="px-3 py-3">상태전환 시점</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job, index) => (
              <tr key={job.jobId}>
                <td className="px-3 py-3">
                  <span className="mr-2 rounded-full bg-slate-100 px-2 py-1 font-black">{index + 1}</span>
                  <strong className="font-mono text-slate-950">{job.barcode}</strong>
                  <span className="ml-2 text-slate-500">{job.productName}</span>
                </td>
                <td className="px-3 py-3 font-bold">{kindLabel(job.productKind)}</td>
                <td className="px-3 py-3 text-right font-black">{job.exactInventoryQuantity}개</td>
                <td className={`px-3 py-3 font-black ${job.desiredStatus === "SOLD_OUT" ? "text-rose-700" : "text-emerald-700"}`}>
                  {statusLabel(job.desiredStatus)}
                </td>
                <td className="px-3 py-3 text-slate-600">{new Date(job.desiredSince).toLocaleString("ko-KR")}</td>
              </tr>
            ))}
            {!jobs.length ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">현재 실행 가능한 Shopling 재고상태 대기건이 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {(blockedRows.length > 0 || localExceptions.length > 0) ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-black text-amber-950">예외 큐 · 자동 재시도 금지</h3>
          <div className="mt-2 space-y-2 text-xs text-amber-950">
            {blockedRows.map((row) => (
              <div key={`blocked:${row.barcode}`} className="rounded-lg bg-white px-3 py-2">
                <strong>{row.barcode}</strong> · {statusLabel(row.desiredStatus)} · {row.syncBlockReason || "수동 확인 필요"}
              </div>
            ))}
            {localExceptions.map((row) => (
              <div key={`local:${row.jobId}`} className="rounded-lg bg-white px-3 py-2">
                <strong>{row.barcode}</strong> · {row.outcome} · {row.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-5 text-slate-500">
        자동감지는 30초마다 큐를 갱신하지만, 현재 단계에서는 새 대기건의 실제 송신 시작은 위 버튼으로 승인합니다. 이 운영 큐가 실전 대기건에서 안정적으로 통과하면 다음 단계에서 승인 버튼 자체를 제거해 완전자동으로 전환할 수 있습니다.
      </p>
    </section>
  );
}
