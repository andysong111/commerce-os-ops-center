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

const number = new Intl.NumberFormat("ko-KR");
const VERIFY_PREFIX = "stock-sync-verify";
const PINNED_REPEAT_TEST_BARCODE = "BZZ341-1";
const LEGACY_MISTYPED_BARCODE = "BZ7341-1";

function normalizedBarcode(value: string) {
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

function verificationJob(row: StockRow): VerificationJob {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    jobId: `${VERIFY_PREFIX}:${row.barcode}:${row.desiredStatus}:${nonce}`,
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

function eventId(
  prefix: string,
  job: VerificationJob,
  outcome: SyncOutcome,
  finishedAt?: number,
) {
  return [prefix, job.jobId, outcome, Number(finishedAt || 0)]
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

export function StockSyncVerificationReplayPanel() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const manualJobs = useRef(new Map<string, VerificationJob>());
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
      throw new Error(payload.message || "검증 재실행용 재고 상태를 불러오지 못했습니다.");
    }
    setReport(payload.report);
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
              ? "shopling-stock-verification-started"
              : "shopling-stock-verification-result",
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
        throw new Error(payload.message || "검증 재실행 결과를 저장하지 못했습니다.");
      }
    },
    [],
  );

  useEffect(() => {
    void refresh().catch((error) => {
      setNotice(error instanceof Error ? error.message : "검증 재실행 상태 조회 실패");
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
      if (!String(result.jobId || "").startsWith(`${VERIFY_PREFIX}:`)) return;
      const resultKey = `${result.jobId}:${result.outcome}:${Number(result.finishedAt || 0)}`;
      if (handledResults.current.has(resultKey)) return;
      const job = result.job || manualJobs.current.get(result.jobId) || null;
      if (!job) {
        setNotice(`${result.jobId} 검증 결과의 작업정보를 찾지 못했습니다.`);
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
          setNotice(
            result.outcome === "SUCCEEDED"
              ? `${job.barcode} ${statusLabel(job.desiredStatus)} 동일상태 검증 재실행 완료 · 정확재고는 변경하지 않았습니다.`
              : `${job.barcode} 검증 재실행 ${result.outcome}: ${result.message || "확인이 필요합니다."}`,
          );
          await refresh();
        } catch (error) {
          handledResults.current.delete(resultKey);
          setNotice(error instanceof Error ? error.message : "검증 재실행 결과 저장 실패");
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
  }, [record, refresh]);

  const replayRows = useMemo(() => {
    const rows = report?.rows ?? [];
    const pinned = rows.find(
      (row) => normalizedBarcode(row.barcode) === PINNED_REPEAT_TEST_BARCODE,
    );
    const normalRows = rows.filter(
      (row) =>
        normalizedBarcode(row.barcode) !== PINNED_REPEAT_TEST_BARCODE &&
        !row.syncBlocked &&
        !row.syncNeeded &&
        row.latestSyncOutcome === "SUCCEEDED",
    );
    return pinned ? [pinned, ...normalRows] : normalRows;
  }, [report]);

  const startReplay = async (row: StockRow) => {
    setNotice("");
    if (!extensionReady) {
      setNotice("HF27 재고상태 확장프로그램 연결 후 다시 실행하세요.");
      return;
    }
    if (runningJobId) {
      setNotice("검증 재실행은 한 번에 1건만 가능합니다.");
      return;
    }
    const job = verificationJob(row);
    manualJobs.current.set(job.jobId, job);
    setRunningJobId(job.jobId);
    try {
      await record(
        job,
        "STARTED",
        "동일한 목표상태로 Shopling 검증 재실행을 시작했습니다. Commerce OS 정확재고와 재고 0 기준점은 변경하지 않습니다.",
        { verificationReplay: true, inventoryMutation: false },
      );
      window.postMessage(
        {
          type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_START",
          job,
        },
        window.location.origin,
      );
      setNotice(
        `${job.barcode} · 현재 목표 ${statusLabel(job.desiredStatus)} 상태를 그대로 다시 송신해 자동화 경로를 검증 중입니다.`,
      );
    } catch (error) {
      manualJobs.current.delete(job.jobId);
      setRunningJobId(null);
      setNotice(error instanceof Error ? error.message : "검증 재실행 시작 실패");
    }
  };

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-violet-700">
            VERIFICATION REPLAY · NO INVENTORY MUTATION
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            완료 건 동일상태 검증 재실행
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            이미 완료된 품절·판매중 상태를 동일한 값으로 한 번 더 송신해 확장프로그램 경로를 검증합니다. Commerce OS의 정확재고, 입고·판매 수량, 재고 0 기준점은 변경하지 않습니다. 검증된 canonical 옵션자체관리코드는 BZZ341-1이며, 이전에 입력된 BZ7341-1 기준점은 오기로 정정 원장에서 실행 대상에서 제외되어 있습니다. BZZ341-1은 직전 검증이 FAILED여도 반복 검증 목록 맨 위에 계속 고정합니다.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-black ${
            extensionReady
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {extensionReady ? "HF27 연결됨" : "HF27 연결 대기"}
        </span>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-violet-950">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-violet-200 bg-white">
        <table className="min-w-[980px] text-left text-xs">
          <thead className="bg-violet-100/60 text-slate-600">
            <tr>
              <th className="px-3 py-3">B코드 / 상품</th>
              <th className="px-3 py-3">형태</th>
              <th className="px-3 py-3 text-right">정확재고</th>
              <th className="px-3 py-3">현재 목표</th>
              <th className="px-3 py-3">검증</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {replayRows.map((row) => (
              <tr key={`${row.barcode}:${row.resetAt}`}>
                <td className="px-3 py-3">
                  <strong className="font-mono text-slate-950">{row.barcode}</strong>
                  <span className="ml-2 text-slate-500">
                    {row.modelNo ? `${row.modelNo} · ` : ""}
                    {row.productName}
                  </span>
                  {normalizedBarcode(row.barcode) === PINNED_REPEAT_TEST_BARCODE ? (
                    <>
                      <span className="ml-2 rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-800">
                        실패 후 재검증 가능
                      </span>
                      <span className="ml-2 text-[10px] font-bold text-slate-500">
                        이전 오기 {LEGACY_MISTYPED_BARCODE}
                      </span>
                    </>
                  ) : null}
                </td>
                <td className="px-3 py-3 font-bold">{kindLabel(row.productKind)}</td>
                <td className="px-3 py-3 text-right font-black text-slate-950">
                  {number.format(row.exactInventoryQuantity)}개
                </td>
                <td className="px-3 py-3 font-black">
                  {statusLabel(row.desiredStatus)}
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => startReplay(row)}
                    disabled={Boolean(runningJobId) || !extensionReady}
                    className="rounded-lg bg-violet-700 px-3 py-2 font-black text-white hover:bg-violet-800 disabled:bg-slate-400"
                  >
                    {runningJobId ? "검증 실행 중" : "동일상태 1건 검증"}
                  </button>
                </td>
              </tr>
            ))}
            {!replayRows.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-7 text-center text-slate-500">
                  현재 동일상태 재검증이 가능한 완료 건이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
