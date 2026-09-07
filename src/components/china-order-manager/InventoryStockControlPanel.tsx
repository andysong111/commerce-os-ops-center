"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
type ReportLoadState = "LOADING" | "READY" | "BLOCKED" | "ERROR";

type StockRow = {
  barcode: string;
  productName: string;
  optionName: string | null;
  modelNo: string | null;
  goodsKeys: string[];
  productKind: ProductKind;
  resetAt: string;
  receivedSinceReset: number;
  soldSinceReset: number;
  exactInventoryQuantity: number;
  recent30StockoutDays: number;
  desiredStatus: DesiredStatus;
  desiredSince: string;
  salesCoverageReady: boolean;
  latestSyncOutcome: SyncOutcome | null;
  latestSyncAt: string | null;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

type StockReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  resetCount: number;
  exactCount: number;
  soldOutCount: number;
  onSaleCount: number;
  pendingSyncCount: number;
  uncertainSyncCount: number;
  rows: StockRow[];
  blockers: string[];
};

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
};

type SyncResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: SyncJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

type SyncStatusMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  active?: {
    status?: string;
    stage?: string;
    message?: string;
    job?: SyncJob;
  } | null;
};

const number = new Intl.NumberFormat("ko-KR");

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function stableEventId(
  prefix: string,
  job: SyncJob,
  outcome?: SyncOutcome,
  finishedAt?: number,
) {
  return [
    prefix,
    job.jobId,
    outcome || "",
    Number(finishedAt || 0),
  ]
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

function statusLabel(value: DesiredStatus) {
  return value === "SOLD_OUT" ? "품절" : "판매중";
}

function kindLabel(value: ProductKind) {
  return value === "OPTION" ? "옵션상품" : "단품";
}

function routeLabel(job: SyncJob) {
  return job.productKind === "OPTION"
    ? `Shopling API ${statusLabel(job.desiredStatus)} 검증·변경 → A21 goods key 옵션송신`
    : `A4 ${statusLabel(job.desiredStatus)} → A21 상품판매상태 ${statusLabel(job.desiredStatus)} 송신`;
}

export function InventoryStockControlPanel() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [reportLoadState, setReportLoadState] =
    useState<ReportLoadState>("LOADING");
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [barcode, setBarcode] = useState("");
  const [productKind, setProductKind] = useState<ProductKind>("OPTION");
  const [modelNo, setModelNo] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const handledResults = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setReportLoadState((current) =>
      current === "READY" ? current : "LOADING",
    );
    try {
      const [stateResponse, jobsResponse] = await Promise.all([
        fetch("/api/inventory-stock-control", {
          cache: "no-store",
          headers: { accept: "application/json" },
        }),
        fetch("/api/inventory-stock-control/sync", {
          cache: "no-store",
          headers: { accept: "application/json" },
        }),
      ]);
      const statePayload = (await stateResponse.json().catch(() => ({}))) as {
        report?: StockReport;
        message?: string;
      };
      const jobsPayload = (await jobsResponse.json().catch(() => ({}))) as {
        jobs?: SyncJob[];
        message?: string;
      };

      if (!statePayload.report) {
        throw new Error(
          statePayload.message ||
            "재고·품절 원장 응답에 상태 보고서가 없습니다.",
        );
      }

      setReport(statePayload.report);
      if (!stateResponse.ok || statePayload.report.state !== "READY") {
        setReportLoadState("BLOCKED");
        const blockerMessage = statePayload.report.blockers.length
          ? statePayload.report.blockers.join(" · ")
          : statePayload.report.message;
        setNotice(
          `재고 원장 조회가 차단되었습니다: ${blockerMessage} 0건으로 간주하지 않습니다.`,
        );
      } else {
        setReportLoadState("READY");
      }

      if (!jobsResponse.ok) {
        throw new Error(
          jobsPayload.message || "Shopling 동기화 작업목록을 불러오지 못했습니다.",
        );
      }
      setJobs(Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : []);
    } catch (error) {
      setReportLoadState("ERROR");
      const message =
        error instanceof Error
          ? error.message
          : "재고·품절 원장을 불러오지 못했습니다.";
      setNotice(`${message} 조회 실패를 0건으로 처리하지 않습니다.`);
      throw error;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const recordSync = useCallback(
    async (
      job: SyncJob,
      outcome: SyncOutcome,
      message: string,
      evidence?: unknown,
      finishedAt?: number,
    ) => {
      const eventId =
        outcome === "STARTED"
          ? stableEventId("shopling-stock-started", job, outcome)
          : stableEventId(
              "shopling-stock-result",
              job,
              outcome,
              finishedAt || Date.now(),
            );
      const response = await fetch("/api/inventory-stock-control/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          eventId,
          jobId: job.jobId,
          barcode: job.barcode,
          productKind: job.productKind,
          modelNo: job.modelNo,
          desiredStatus: job.desiredStatus,
          outcome,
          message,
          evidence: evidence ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.message || "Shopling 실행결과를 저장하지 못했습니다.",
        );
      }
    },
    [],
  );

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
      if (data.type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS") {
        const status = data as unknown as SyncStatusMessage;
        if (status.active?.status === "RUNNING" && status.active.job?.jobId) {
          setRunningJobId(status.active.job.jobId);
          setNotice(
            `${status.active.job.barcode} · ${status.active.message || status.active.stage || "Shopling 작업 복구 중"}`,
          );
        }
        return;
      }
      if (data.type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS") {
        const jobId = String(data.jobId || "");
        if (jobId) setRunningJobId(jobId);
        if (data.message) setNotice(String(data.message));
        return;
      }
      if (data.type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;
      const result = data as unknown as SyncResultMessage;
      const resultKey = `${result.jobId}:${result.outcome}:${Number(result.finishedAt || 0)}`;
      if (!result.jobId || handledResults.current.has(resultKey)) return;
      const job =
        result.job ||
        jobs.find((row) => row.jobId === result.jobId) ||
        null;
      if (!job) {
        setNotice(
          `${result.jobId} 확장 결과를 받았지만 B코드 작업정보가 없어 수동 확인이 필요합니다.`,
        );
        return;
      }
      handledResults.current.add(resultKey);
      void (async () => {
        try {
          await recordSync(
            job,
            result.outcome,
            result.message || "",
            result.evidence,
            result.finishedAt,
          );
          setNotice(
            result.outcome === "SUCCEEDED"
              ? `${job.barcode} Shopling ${statusLabel(job.desiredStatus)} 반영 완료`
              : `${job.barcode} 실행 결과 ${result.outcome}: ${result.message || "수동 확인 필요"}`,
          );
          await refresh();
        } catch (error) {
          handledResults.current.delete(resultKey);
          setNotice(
            error instanceof Error
              ? error.message
              : "Shopling 결과 저장에 실패했습니다.",
          );
        } finally {
          setRunningJobId((current) =>
            current === result.jobId ? null : current,
          );
        }
      })();
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, [jobs, recordSync, refresh]);

  const pendingJobs = useMemo(
    () => jobs.filter((job) => job.jobId !== runningJobId),
    [jobs, runningJobId],
  );
  const reportReady = reportLoadState === "READY" && report?.state === "READY";
  const unresolvedMetric = reportLoadState === "LOADING" ? "조회 중" : "—";

  const saveReset = async () => {
    setNotice("");
    const normalizedBarcode = barcode
      .normalize("NFKC")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(normalizedBarcode)) {
      setNotice("B코드를 BZ7341-1 또는 BCC3-2 형식으로 입력하세요.");
      return;
    }
    if (productKind === "SINGLE" && !modelNo.trim()) {
      setNotice("단품은 기준정보 확인용 모델번호가 필요합니다.");
      return;
    }
    if (!report) {
      setNotice(
        "재고 원장 조회가 완료되기 전에는 새 기준점을 저장하지 않습니다.",
      );
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: "RESET_ZERO",
          eventId: randomId("stockout-reset"),
          barcode: normalizedBarcode,
          productKind,
          modelNo: modelNo.trim() || null,
          note: note.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "품절 기준점을 저장하지 못했습니다.");
      }
      setBarcode("");
      setModelNo("");
      setNote("");
      setNotice(payload.message || "재고 0 기준점을 저장했습니다.");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "품절 기준점 저장 실패",
      );
    } finally {
      setLoading(false);
    }
  };

  const startJob = async (job: SyncJob) => {
    setNotice("");
    if (!extensionReady) {
      setNotice(
        "Commerce OS Shopling 재고상태 확장프로그램이 감지되지 않았습니다. 설치·새로고침 후 다시 실행하세요.",
      );
      return;
    }
    if (runningJobId) {
      setNotice(
        "이미 실행 중인 B코드가 있습니다. 반대 상태를 동시에 실행하지 않습니다.",
      );
      return;
    }
    setRunningJobId(job.jobId);
    try {
      await recordSync(
        job,
        "STARTED",
        "사용자가 1건 안전실행을 시작했습니다.",
      );
      window.postMessage(
        {
          type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_START",
          job,
        },
        window.location.origin,
      );
      setNotice(`${job.barcode} · ${routeLabel(job)} 실행을 시작했습니다.`);
    } catch (error) {
      setRunningJobId(null);
      setNotice(
        error instanceof Error ? error.message : "Shopling 실행 시작 실패",
      );
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">
              ZERO RESET · EXACT INVENTORY
            </span>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              B코드 품절 확정 · 재고 0 기준점
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              물리적으로 품절을 확인한 시점만 입력합니다. 그 순간 재고를 0으로 고정하고 이후 확정입고는 더하고 Canonical 판매는 빼서 정확재고를 이어갑니다.
            </p>
          </div>
          <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700">
            Shopling 외부변경은 별도 1건 실행
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_1fr]">
          <label className="text-sm font-bold text-slate-700">
            B코드
            <input
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="예: BCC3-2"
              className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            상품형태
            <select
              value={productKind}
              onChange={(event) =>
                setProductKind(event.target.value as ProductKind)
              }
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="OPTION">옵션상품</option>
              <option value="SINGLE">옵션 없는 단품</option>
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            모델번호 {productKind === "SINGLE" ? "· 필수" : "· 자동보완 가능"}
            <input
              value={modelNo}
              onChange={(event) => setModelNo(event.target.value)}
              placeholder="예: AAA490"
              className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-500"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm font-bold text-slate-700">
          메모
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="예: 창고 실사 품절 확인"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-500"
          />
        </label>
        <button
          type="button"
          onClick={saveReset}
          disabled={loading || !report}
          className="mt-4 rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:bg-slate-400"
        >
          {loading
            ? "기준점 저장 중..."
            : !report
              ? "재고 원장 확인 중..."
              : "품절 확정 · 재고 0 초기화"}
        </button>
      </section>

      {reportLoadState === "LOADING" ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold leading-6 text-blue-950">
          재고 기준점과 정확재고 원장을 조회하고 있습니다. 조회가 끝나기 전에는 0건으로 표시하지 않습니다.
        </section>
      ) : null}

      {notice ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950">
          {notice}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="0 기준점"
          value={reportReady ? report.resetCount : unresolvedMetric}
        />
        <Metric
          label="정확재고 계산"
          value={reportReady ? report.exactCount : unresolvedMetric}
        />
        <Metric
          label="품절 상태"
          value={reportReady ? report.soldOutCount : unresolvedMetric}
        />
        <Metric
          label="판매중 상태"
          value={reportReady ? report.onSaleCount : unresolvedMetric}
        />
        <Metric
          label="Shopling 대기"
          value={reportReady ? report.pendingSyncCount : unresolvedMetric}
          emphasized
        />
        <Metric
          label="수동확인"
          value={reportReady ? report.uncertainSyncCount : unresolvedMetric}
        />
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              SERIAL CANARY · NO OPPOSITE CONCURRENCY
            </span>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              Shopling 품절·판매중 동기화 대기
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Shopling/마켓에는 재고수량을 맞추지 않고 품절·판매중 상태만 전송합니다. 옵션상품은 Shopling API에서 B코드 정확 옵션의 상태만 변경·재검증한 뒤 A21 goods key 옵션송신, 단품은 A4 상품상태 변경 후 A21 상품판매상태 송신을 사용합니다.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1.5 text-xs font-black ${
              extensionReady
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            {extensionReady ? "확장 연결됨" : "확장 미감지"}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-blue-200 bg-white">
          <table className="min-w-[1050px] text-left text-xs">
            <thead className="bg-blue-50 text-slate-600">
              <tr>
                <th className="px-3 py-3">B코드 / 상품</th>
                <th className="px-3 py-3">정확재고</th>
                <th className="px-3 py-3">목표상태</th>
                <th className="px-3 py-3">실행경로</th>
                <th className="px-3 py-3">실행</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reportReady
                ? pendingJobs.map((job) => (
                    <tr key={job.jobId}>
                      <td className="px-3 py-3">
                        <strong className="font-mono text-slate-950">
                          {job.barcode}
                        </strong>
                        <span className="ml-2 text-slate-500">
                          {job.modelNo ? `${job.modelNo} · ` : ""}
                          {job.productName}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-black text-slate-950">
                        {number.format(job.exactInventoryQuantity)}개
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 font-black ${
                            job.desiredStatus === "SOLD_OUT"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {statusLabel(job.desiredStatus)}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {kindLabel(job.productKind)}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-700">
                        {routeLabel(job)}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => startJob(job)}
                          disabled={Boolean(runningJobId) || !extensionReady}
                          className="rounded-lg bg-slate-950 px-3 py-2 font-black text-white disabled:bg-slate-400"
                        >
                          1건 안전 실행
                        </button>
                      </td>
                    </tr>
                  ))
                : null}
              {!reportReady ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center font-bold text-amber-800"
                  >
                    {reportLoadState === "LOADING"
                      ? "Shopling 작업목록을 조회 중입니다."
                      : "재고 원장 상태가 확정되지 않아 작업목록을 0건으로 간주하지 않습니다."}
                  </td>
                </tr>
              ) : !pendingJobs.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    현재 실행 가능한 Shopling 품절·판매중 작업이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[1200px] text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3">B코드 / 상품</th>
              <th className="px-3 py-3">형태</th>
              <th className="px-3 py-3 text-right">입고누계</th>
              <th className="px-3 py-3 text-right">판매누계</th>
              <th className="px-3 py-3 text-right">현재 정확재고</th>
              <th className="px-3 py-3">최근30일 품절</th>
              <th className="px-3 py-3">Shopling 목표</th>
              <th className="px-3 py-3">차단/상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reportReady
              ? report.rows.map((row) => (
                  <tr key={`${row.barcode}:${row.resetAt}`}>
                    <td className="px-3 py-3">
                      <strong className="font-mono text-slate-950">
                        {row.barcode}
                      </strong>
                      <span className="ml-2 text-slate-500">
                        {row.modelNo ? `${row.modelNo} · ` : ""}
                        {row.productName}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-bold">
                      {kindLabel(row.productKind)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {number.format(row.receivedSinceReset)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {number.format(row.soldSinceReset)}
                    </td>
                    <td className="px-3 py-3 text-right text-base font-black text-slate-950">
                      {number.format(row.exactInventoryQuantity)}
                    </td>
                    <td className="px-3 py-3">{row.recent30StockoutDays}일</td>
                    <td className="px-3 py-3 font-black">
                      {statusLabel(row.desiredStatus)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.syncBlocked
                        ? row.syncBlockReason
                        : row.syncNeeded
                          ? "동기화 대기"
                          : `완료 · ${row.latestSyncOutcome ?? "SUCCEEDED"}`}
                    </td>
                  </tr>
                ))
              : null}
            {!reportReady ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center font-bold text-amber-800"
                >
                  {reportLoadState === "LOADING"
                    ? "재고 기준점과 정확재고를 조회 중입니다."
                    : "재고 원장 조회가 완료되지 않았습니다. 실패 또는 차단 상태를 0건으로 표시하지 않습니다."}
                </td>
              </tr>
            ) : !report.rows.length ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  아직 품절 0 기준점을 만든 B코드가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: number | string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        emphasized
          ? "border-blue-300 bg-blue-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl font-black text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}
