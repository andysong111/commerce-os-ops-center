"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
type StepStatus = "WAITING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type StockRow = {
  barcode: string;
  productName: string;
  optionName: string | null;
  modelNo: string | null;
  goodsKeys: string[];
  productKind: ProductKind;
  resetAt: string;
  exactInventoryQuantity: number;
  desiredStatus: DesiredStatus;
  desiredSince: string;
  latestSyncOutcome: SyncOutcome | null;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

type StockReport = {
  state: "READY" | "BLOCKED";
  rows: StockRow[];
};

type VerificationJob = {
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
  verificationOnly: true;
  parallelVerification: true;
  parallelBatchId: string;
  parallelLane: number;
  ignoreWindowClose: true;
};

type ResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: VerificationJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

type TargetSpec = {
  barcode: string;
  exactInventoryQuantity: number;
  desiredStatus: DesiredStatus;
  productKind: ProductKind;
};

const PARALLEL_PREFIX = "stock-sync-parallel-verify";
const PARALLEL_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START";
const PARALLEL_STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_STATUS";
const TARGETS: TargetSpec[] = [
  { barcode: "BCB2-1", exactInventoryQuantity: 1, desiredStatus: "ON_SALE", productKind: "SINGLE" },
  { barcode: "BZZ341-1", exactInventoryQuantity: 0, desiredStatus: "SOLD_OUT", productKind: "OPTION" },
];

function normalizeBarcode(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function statusLabel(value: DesiredStatus) {
  return value === "SOLD_OUT" ? "품절" : "판매중";
}

function kindLabel(value: ProductKind) {
  return value === "OPTION" ? "옵션상품" : "단품";
}

function routeFor(row: StockRow) {
  return row.productKind === "OPTION"
    ? ["SHOPLING_API_OPTION_STATUS", "A21_GOODS_KEY_OPTION_SEND"]
    : ["A6_LIVE_SINGLE_BARCODE", "A21_GOODS_KEY_PRODUCT_SALE_STATUS"];
}

function makeJob(row: StockRow, batchId: string, lane: number): VerificationJob {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    jobId: `${PARALLEL_PREFIX}:${row.barcode}:${row.desiredStatus}:${nonce}`,
    barcode: row.barcode,
    productName: row.productName,
    productKind: row.productKind,
    modelNo: row.modelNo,
    goodsKeys: [...row.goodsKeys],
    desiredStatus: row.desiredStatus,
    desiredSince: row.desiredSince,
    exactInventoryQuantity: row.exactInventoryQuantity,
    resetAt: row.resetAt,
    route: routeFor(row),
    verificationOnly: true,
    parallelVerification: true,
    parallelBatchId: batchId,
    parallelLane: lane,
    ignoreWindowClose: true,
  };
}

function eventId(prefix: string, job: VerificationJob, outcome: SyncOutcome, finishedAt?: number) {
  return [prefix, job.jobId, outcome, Number(finishedAt || 0)]
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

function statusClass(status: StepStatus) {
  if (status === "SUCCEEDED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "FAILED" || status === "UNCERTAIN") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "RUNNING") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function StockSyncSerialVerificationPanel() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState("IDLE");
  const [steps, setSteps] = useState<Record<string, StepStatus>>({
    "BCB2-1": "WAITING",
    "BZZ341-1": "WAITING",
  });
  const jobs = useRef(new Map<string, VerificationJob>());
  const handledResults = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const response = await fetch("/api/inventory-stock-control", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      report?: StockReport;
      message?: string;
    };
    if (!response.ok || !payload.report) {
      throw new Error(payload.message || "병렬검증용 재고 상태를 불러오지 못했습니다.");
    }
    setReport(payload.report);
    return payload.report;
  }, []);

  const record = useCallback(
    async (
      job: VerificationJob,
      outcome: SyncOutcome,
      message: string,
      evidence?: unknown,
      finishedAt?: number,
    ) => {
      const response = await fetch("/api/inventory-stock-control/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          eventId: eventId(
            outcome === "STARTED"
              ? "shopling-stock-parallel-verification-started"
              : "shopling-stock-parallel-verification-result",
            job,
            outcome,
            finishedAt,
          ),
          jobId: job.jobId,
          barcode: job.barcode,
          productKind: job.productKind,
          modelNo: job.modelNo,
          desiredStatus: job.desiredStatus,
          outcome,
          message,
          evidence: {
            verificationReplay: true,
            parallelVerification: true,
            parallelBatchId: job.parallelBatchId,
            parallelLane: job.parallelLane,
            inventoryMutation: false,
            windowCloseIgnored: true,
            requestedExactInventory: job.exactInventoryQuantity,
            ...(evidence && typeof evidence === "object" && !Array.isArray(evidence)
              ? (evidence as Record<string, unknown>)
              : { extensionEvidence: evidence ?? null }),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "병렬검증 결과를 저장하지 못했습니다.");
      }
    },
    [],
  );

  const targetRows = useMemo(() => {
    const rows = report?.rows ?? [];
    return TARGETS.map((target) => ({
      target,
      row: rows.find((row) => normalizeBarcode(row.barcode) === target.barcode) ?? null,
    }));
  }, [report]);

  const readiness = useMemo(() => {
    const errors: string[] = [];
    for (const entry of targetRows) {
      if (!entry.row) {
        errors.push(`${entry.target.barcode} 재고원장 행 없음`);
        continue;
      }
      if (entry.row.productKind !== entry.target.productKind) {
        errors.push(`${entry.target.barcode} 상품형태 불일치`);
      }
      if (entry.row.exactInventoryQuantity !== entry.target.exactInventoryQuantity) {
        errors.push(`${entry.target.barcode} 정확재고 ${entry.row.exactInventoryQuantity}개 (기대 ${entry.target.exactInventoryQuantity}개)`);
      }
      if (entry.row.desiredStatus !== entry.target.desiredStatus) {
        errors.push(`${entry.target.barcode} 목표상태 ${statusLabel(entry.row.desiredStatus)} (기대 ${statusLabel(entry.target.desiredStatus)})`);
      }
    }
    return { ok: errors.length === 0, errors };
  }, [targetRows]);

  useEffect(() => {
    void refresh().catch((error) => {
      setNotice(error instanceof Error ? error.message : "병렬검증 상태 조회 실패");
    });
  }, [refresh]);

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
        const nextPhase = String(data.phase || "");
        setPhase(nextPhase || "RUNNING");
        if (data.ok === false) {
          setBatchRunning(false);
          setNotice(String(data.message || "HF28 병렬 시작에 실패했습니다."));
          return;
        }
        if (nextPhase === "FIRST_RESULT_DETACHED") {
          setNotice("Lane 1 송신 접수 완료 · 결과창은 닫힘을 기다리지 않고 별도 감시로 분리했습니다. 새 Shopling 창에서 Lane 2를 시작합니다.");
        } else if (nextPhase === "PARALLEL_RUNNING") {
          setNotice("2-Lane 병렬 실행 중 · Lane 1 결과대기와 Lane 2 Shopling 작업이 동시에 진행됩니다. 창 닫힘은 성공조건에서 제외했습니다.");
        } else if (nextPhase === "DONE") {
          setBatchRunning(false);
        }
        return;
      }

      if (type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;
      const result = data as unknown as ResultMessage;
      if (!String(result.jobId || "").startsWith(`${PARALLEL_PREFIX}:`)) return;
      const resultKey = `${result.jobId}:${result.outcome}:${Number(result.finishedAt || 0)}`;
      if (handledResults.current.has(resultKey)) return;
      const job = result.job || jobs.current.get(result.jobId) || null;
      if (!job) return;
      handledResults.current.add(resultKey);

      void (async () => {
        try {
          await record(job, result.outcome, result.message || "", result.evidence, result.finishedAt);
          setSteps((current) => ({ ...current, [normalizeBarcode(job.barcode)]: result.outcome }));
          await refresh();

          const outcomes = new Map<string, StepStatus>();
          setSteps((current) => {
            const next = { ...current, [normalizeBarcode(job.barcode)]: result.outcome };
            Object.entries(next).forEach(([key, value]) => outcomes.set(key, value));
            const terminal = TARGETS.every((target) => ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(next[target.barcode]));
            if (terminal) {
              setBatchRunning(false);
              if (TARGETS.every((target) => next[target.barcode] === "SUCCEEDED")) {
                setNotice("2-Lane 병렬 검증 완료 · BCB2-1 판매중과 BZZ341-1 품절이 모두 SUCCEEDED입니다. 창 닫힘 여부와 무관하게 완료 판정했습니다.");
                setPhase("DONE");
              } else {
                setNotice("2-Lane 병렬 검증 종료 · 한 Lane 이상이 FAILED/UNCERTAIN입니다. 결과별 원인을 확인하세요.");
                setPhase("DONE_WITH_ERROR");
              }
            }
            return next;
          });
        } catch (error) {
          handledResults.current.delete(resultKey);
          setBatchRunning(false);
          setNotice(error instanceof Error ? error.message : "병렬검증 결과 저장 실패");
        }
      })();
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, [record, refresh]);

  const startParallel = async () => {
    setNotice("");
    if (!extensionReady) {
      setNotice("HF28 재고상태 확장프로그램 연결 후 다시 실행하세요.");
      return;
    }
    if (batchRunning) {
      setNotice("이미 2-Lane 병렬검증이 실행 중입니다.");
      return;
    }
    if (!readiness.ok) {
      setNotice(`안전조건 불충족: ${readiness.errors.join(" · ")}`);
      return;
    }

    const rows = targetRows.map((entry) => entry.row).filter((row): row is StockRow => Boolean(row));
    if (rows.length !== TARGETS.length) {
      setNotice("병렬검증 대상 2건을 모두 찾지 못했습니다.");
      return;
    }

    const batchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `parallel-${crypto.randomUUID()}`
        : `parallel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const parallelJobs = rows.map((row, index) => makeJob(row, batchId, index + 1));
    jobs.current.clear();
    handledResults.current.clear();
    parallelJobs.forEach((job) => jobs.current.set(job.jobId, job));
    setSteps({ "BCB2-1": "RUNNING", "BZZ341-1": "RUNNING" });
    setBatchRunning(true);
    setPhase("STARTING");

    try {
      await Promise.all(
        parallelJobs.map((job) =>
          record(
            job,
            "STARTED",
            `2-Lane 병렬 동일상태 검증 Lane ${job.parallelLane} 예약 · 정확재고/재고 0 기준점은 변경하지 않습니다.`,
            { parallelVerification: true, parallelBatchId: batchId, parallelLane: job.parallelLane, windowCloseIgnored: true },
          ),
        ),
      );
      window.postMessage(
        {
          type: PARALLEL_START,
          batchId,
          jobs: parallelJobs,
        },
        window.location.origin,
      );
      setNotice("병렬검증 시작 · Lane 1이 Shopling 송신을 접수하는 즉시 결과대기를 분리하고 새 창에서 Lane 2를 겹쳐 실행합니다.");
    } catch (error) {
      setBatchRunning(false);
      setSteps({ "BCB2-1": "WAITING", "BZZ341-1": "WAITING" });
      setNotice(error instanceof Error ? error.message : "2-Lane 병렬검증 시작 실패");
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-cyan-800">
            PARALLEL CHECKPOINT · 2 LANES · NO INVENTORY MUTATION
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">2건 병렬 자동검증</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            BCB2-1 판매중과 BZZ341-1 품절을 겹쳐 검증합니다. Lane 1은 Shopling 송신 접수 후 결과창을 별도 감시로 분리하고, 새 Shopling 창을 열어 Lane 2를 즉시 시작합니다. 결과창 자동닫기는 더 이상 다음 작업 진행이나 성공판정 조건이 아닙니다. Commerce OS 정확재고·입고·판매수량·재고 0 기준점은 변경하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${extensionReady ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {extensionReady ? "HF28 연결됨" : "HF28 연결 대기"}
          </span>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${readiness.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
            {readiness.ok ? "안전조건 확인 완료" : "안전조건 확인 필요"}
          </span>
        </div>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm font-bold text-cyan-950">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {targetRows.map(({ target, row }, index) => {
          const status = steps[target.barcode] || "WAITING";
          return (
            <div key={target.barcode} className={`rounded-xl border p-4 ${statusClass(status)}`}>
              <div className="flex items-center justify-between gap-3">
                <strong>LANE {index + 1} · {target.barcode}</strong>
                <span className="rounded-full border border-current/20 px-2 py-1 text-[11px] font-black">{status}</span>
              </div>
              <div className="mt-2 text-sm font-bold text-slate-900">
                {row?.modelNo ? `${row.modelNo} · ` : ""}{row?.productName || "재고원장 확인 중"}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {kindLabel(target.productKind)} · 정확재고 {target.exactInventoryQuantity}개 · 목표 {statusLabel(target.desiredStatus)}
              </div>
            </div>
          );
        })}
      </div>

      {!readiness.ok && readiness.errors.length ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
          {readiness.errors.join(" · ")}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startParallel}
          disabled={!extensionReady || !readiness.ok || batchRunning}
          className="rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-black text-white hover:bg-cyan-800 disabled:bg-slate-400"
        >
          {batchRunning ? "2-Lane 병렬검증 실행 중" : "BCB2-1 + BZZ341-1 병렬검증"}
        </button>
        <span className="text-xs font-bold text-slate-600">현재 단계: {phase} · 창 닫힘 대기 없음</span>
      </div>
    </section>
  );
}
