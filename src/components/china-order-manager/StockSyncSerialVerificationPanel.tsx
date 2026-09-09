"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

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

type StepStatus = "WAITING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type TargetSpec = {
  barcode: string;
  exactInventoryQuantity: number;
  desiredStatus: DesiredStatus;
  productKind: ProductKind;
};

const SERIAL_PREFIX = "stock-sync-serial-verify";
const SERIAL_TARGETS: TargetSpec[] = [
  {
    barcode: "BCB2-1",
    exactInventoryQuantity: 1,
    desiredStatus: "ON_SALE",
    productKind: "SINGLE",
  },
  {
    barcode: "BZZ341-1",
    exactInventoryQuantity: 0,
    desiredStatus: "SOLD_OUT",
    productKind: "OPTION",
  },
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
    : ["A4_PRODUCT_STATUS", "A21_GOODS_KEY_PRODUCT_SALE_STATUS"];
}

function makeJob(row: StockRow): VerificationJob {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    jobId: `${SERIAL_PREFIX}:${row.barcode}:${row.desiredStatus}:${nonce}`,
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
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [steps, setSteps] = useState<Record<string, StepStatus>>(() => ({
    "BCB2-1": "WAITING",
    "BZZ341-1": "WAITING",
  }));
  const manualJobs = useRef(new Map<string, VerificationJob>());
  const handledResults = useRef(new Set<string>());
  const pendingRows = useRef<StockRow[]>([]);

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
      throw new Error(payload.message || "연속검증용 재고 상태를 불러오지 못했습니다.");
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
              ? "shopling-stock-serial-verification-started"
              : "shopling-stock-serial-verification-result",
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
            serialVerification: true,
            inventoryMutation: false,
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
        throw new Error(payload.message || "연속검증 결과를 저장하지 못했습니다.");
      }
    },
    [],
  );

  const targetRows = useMemo(() => {
    const rows = report?.rows ?? [];
    return SERIAL_TARGETS.map((target) => ({
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
        errors.push(
          `${entry.target.barcode} 정확재고 ${entry.row.exactInventoryQuantity}개 (기대 ${entry.target.exactInventoryQuantity}개)`,
        );
      }
      if (entry.row.desiredStatus !== entry.target.desiredStatus) {
        errors.push(
          `${entry.target.barcode} 목표상태 ${statusLabel(entry.row.desiredStatus)} (기대 ${statusLabel(entry.target.desiredStatus)})`,
        );
      }
    }
    return { ok: errors.length === 0, errors };
  }, [targetRows]);

  const dispatchOne = useCallback(
    async (row: StockRow) => {
      const job = makeJob(row);
      manualJobs.current.set(job.jobId, job);
      setRunningJobId(job.jobId);
      setSteps((current) => ({ ...current, [normalizeBarcode(row.barcode)]: "RUNNING" }));
      await record(
        job,
        "STARTED",
        "2건 직렬 동일상태 검증의 현재 단계를 시작했습니다. Commerce OS 정확재고와 재고 0 기준점은 변경하지 않습니다.",
        { serialVerification: true, inventoryMutation: false },
      );
      window.postMessage(
        {
          type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_START",
          job,
        },
        window.location.origin,
      );
      setNotice(
        `${job.barcode} ${statusLabel(job.desiredStatus)} 검증 실행 중 · 이 건이 성공해야 다음 상품으로 넘어갑니다.`,
      );
    },
    [record],
  );

  useEffect(() => {
    void refresh().catch((error) => {
      setNotice(error instanceof Error ? error.message : "연속검증 상태 조회 실패");
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
      if (data.type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY") {
        setExtensionReady(true);
        return;
      }
      if (data.type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;
      const result = data as unknown as ResultMessage;
      if (!String(result.jobId || "").startsWith(`${SERIAL_PREFIX}:`)) return;
      const resultKey = `${result.jobId}:${result.outcome}:${Number(result.finishedAt || 0)}`;
      if (handledResults.current.has(resultKey)) return;
      const job = result.job || manualJobs.current.get(result.jobId) || null;
      if (!job) {
        setNotice(`${result.jobId} 연속검증 작업정보를 찾지 못했습니다.`);
        return;
      }
      handledResults.current.add(resultKey);
      void (async () => {
        try {
          await record(
            job,
            result.outcome,
            result.message || "",
            result.evidence,
            result.finishedAt,
          );
          const barcode = normalizeBarcode(job.barcode);
          setSteps((current) => ({ ...current, [barcode]: result.outcome }));
          await refresh();

          if (result.outcome !== "SUCCEEDED") {
            pendingRows.current = [];
            setBatchRunning(false);
            setNotice(
              `${job.barcode}에서 연속검증 중단 · ${result.outcome}: ${result.message || "확인이 필요합니다."}`,
            );
            return;
          }

          const next = pendingRows.current.shift() ?? null;
          if (!next) {
            setBatchRunning(false);
            setNotice(
              "2건 직렬 검증 완료 · BCB2-1 판매중과 BZZ341-1 품절이 모두 SUCCEEDED이며 정확재고는 변경하지 않았습니다.",
            );
            return;
          }

          setNotice(`${job.barcode} 성공 · 작업창 정리 후 다음 ${next.barcode}로 자동 이동합니다.`);
          window.setTimeout(() => {
            void dispatchOne(next).catch((error) => {
              pendingRows.current = [];
              setBatchRunning(false);
              setRunningJobId(null);
              setNotice(error instanceof Error ? error.message : "다음 연속검증 시작 실패");
            });
          }, 2500);
        } catch (error) {
          handledResults.current.delete(resultKey);
          pendingRows.current = [];
          setBatchRunning(false);
          setNotice(error instanceof Error ? error.message : "연속검증 결과 저장 실패");
        } finally {
          manualJobs.current.delete(result.jobId);
          setRunningJobId((current) => (current === result.jobId ? null : current));
        }
      })();
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, [dispatchOne, record, refresh]);

  const startSerial = async () => {
    setNotice("");
    if (!extensionReady) {
      setNotice("HF27 재고상태 확장프로그램 연결 후 다시 실행하세요.");
      return;
    }
    if (batchRunning || runningJobId) {
      setNotice("이미 연속검증 작업이 실행 중입니다.");
      return;
    }
    if (!readiness.ok) {
      setNotice(`안전조건 불충족: ${readiness.errors.join(" · ")}`);
      return;
    }

    const rows = targetRows.map((entry) => entry.row).filter((row): row is StockRow => Boolean(row));
    if (rows.length !== SERIAL_TARGETS.length) {
      setNotice("연속검증 대상 2건을 모두 찾지 못했습니다.");
      return;
    }

    setSteps({ "BCB2-1": "WAITING", "BZZ341-1": "WAITING" });
    setBatchRunning(true);
    const [first, ...rest] = rows;
    pendingRows.current = rest;
    try {
      await dispatchOne(first);
    } catch (error) {
      pendingRows.current = [];
      setBatchRunning(false);
      setRunningJobId(null);
      setNotice(error instanceof Error ? error.message : "2건 직렬 검증 시작 실패");
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-cyan-800">
            SERIAL CHECKPOINT · 2 ITEMS · NO INVENTORY MUTATION
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">2건 연속 자동검증</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            BCB2-1 단품 판매중 → BZZ341-1 옵션상품 품절 순서로 한 건씩 직렬 실행합니다. 첫 건이 SUCCEEDED로 끝나고 결과창이 정리된 뒤 2.5초 후 다음 건을 자동 시작합니다. 어느 단계든 실패하거나 UNCERTAIN이면 즉시 중단하며 Commerce OS 정확재고·입고·판매수량·재고 0 기준점은 변경하지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startSerial()}
          disabled={!extensionReady || !readiness.ok || batchRunning || Boolean(runningJobId)}
          className="rounded-xl bg-cyan-950 px-4 py-3 text-sm font-black text-white hover:bg-cyan-900 disabled:bg-slate-400"
        >
          {batchRunning ? "2건 연속검증 실행 중" : "BCB2-1 → BZZ341-1 2건 연속검증"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
        <span className={`rounded-full border px-3 py-1.5 ${extensionReady ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {extensionReady ? "HF27 연결됨" : "HF27 연결 대기"}
        </span>
        <span className={`rounded-full border px-3 py-1.5 ${readiness.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
          {readiness.ok ? "안전조건 확인 완료" : `안전조건 불충족 ${readiness.errors.length}건`}
        </span>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm font-bold text-cyan-950">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {SERIAL_TARGETS.map((target, index) => {
          const row = targetRows[index]?.row ?? null;
          const stepStatus = steps[target.barcode] ?? "WAITING";
          return (
            <div key={target.barcode} className="rounded-xl border border-cyan-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black text-slate-500">STEP {index + 1}</div>
                  <div className="mt-1 font-mono text-sm font-black text-slate-950">{target.barcode}</div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${statusClass(stepStatus)}`}>
                  {stepStatus}
                </span>
              </div>
              <div className="mt-3 text-sm text-slate-700">
                {row ? (
                  <>
                    <div className="font-bold">{row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {kindLabel(row.productKind)} · 정확재고 {row.exactInventoryQuantity}개 · 목표 {statusLabel(row.desiredStatus)}
                    </div>
                  </>
                ) : (
                  <div className="font-bold text-rose-700">현재 재고원장에서 찾지 못했습니다.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
