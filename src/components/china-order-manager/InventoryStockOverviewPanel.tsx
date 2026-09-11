"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type DesiredStatus = "SOLD_OUT" | "ON_SALE";

type StockRow = {
  barcode: string;
  productName: string;
  exactInventoryQuantity: number;
  desiredStatus: DesiredStatus;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

type StockReport = {
  state: "READY" | "BLOCKED";
  soldOutCount: number;
  onSaleCount: number;
  pendingSyncCount: number;
  uncertainSyncCount: number;
  rows: StockRow[];
};

type QueuePayload = {
  report?: StockReport;
  jobs?: Array<{ jobId: string }>;
  message?: string;
};

const REFRESH_MS = 30_000;
const number = new Intl.NumberFormat("ko-KR");

function statusLabel(value: DesiredStatus) {
  return value === "SOLD_OUT" ? "품절" : "판매중";
}

export function InventoryStockOverviewPanel() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const loadQueue = useCallback(async () => {
    const response = await fetch("/api/inventory-stock-control/sync", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json().catch(() => ({}))) as QueuePayload;
    if (!response.ok || !payload.report) {
      throw new Error(payload.message || "재고 상태를 불러오지 못했습니다.");
    }
    setReport(payload.report);
    setJobCount(Array.isArray(payload.jobs) ? payload.jobs.length : 0);
  }, []);

  const refreshSalesAndStock = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const stateResponse = await fetch("/api/inventory-stock-control", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const statePayload = (await stateResponse.json().catch(() => ({}))) as {
        report?: StockReport;
        message?: string;
      };
      if (!stateResponse.ok || !statePayload.report) {
        throw new Error(statePayload.message || "판매·재고 확인에 실패했습니다.");
      }
      await loadQueue();
      setNotice("판매와 재고를 다시 확인했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "판매·재고 확인 실패");
    } finally {
      setLoading(false);
    }
  }, [loadQueue]);

  useEffect(() => {
    void refreshSalesAndStock();
    const timer = window.setInterval(() => {
      void loadQueue().catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue, refreshSalesAndStock]);

  const blockedCount = useMemo(
    () => (report?.rows ?? []).filter((row) => row.syncNeeded && row.syncBlocked).length,
    [report],
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-slate-500">
            현재 재고 상태
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">품절·판매재개 자동판단</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            확정한 기준재고에 이후 입고와 판매를 반영해 현재 수량을 계산합니다. 수량이 0이면 품절, 1개 이상이면 판매중으로 판단하고 필요한 변경만 대기열에 올립니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshSalesAndStock()}
          disabled={loading}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
        >
          {loading ? "확인 중..." : "판매·재고 다시 확인"}
        </button>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="품절" value={report ? report.soldOutCount : "—"} />
        <Metric label="판매중" value={report ? report.onSaleCount : "—"} />
        <Metric label="자동 처리 대기" value={jobCount ?? "—"} emphasized />
        <Metric label="확인 필요" value={report ? blockedCount + report.uncertainSyncCount : "—"} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[760px] w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3">B코드 / 상품</th>
              <th className="px-3 py-3 text-right">현재 재고</th>
              <th className="px-3 py-3">자동판단</th>
              <th className="px-3 py-3">처리상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(report?.rows ?? []).map((row) => (
              <tr key={row.barcode}>
                <td className="px-3 py-3">
                  <strong className="font-mono text-slate-950">{row.barcode}</strong>
                  <span className="ml-2 text-slate-500">{row.productName}</span>
                </td>
                <td className="px-3 py-3 text-right text-base font-black text-slate-950">
                  {number.format(row.exactInventoryQuantity)}개
                </td>
                <td className={`px-3 py-3 font-black ${row.desiredStatus === "SOLD_OUT" ? "text-rose-700" : "text-emerald-700"}`}>
                  {statusLabel(row.desiredStatus)}
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {row.syncBlocked
                    ? row.syncBlockReason || "확인 필요"
                    : row.syncNeeded
                      ? "자동 처리 대기"
                      : "반영 완료"}
                </td>
              </tr>
            ))}
            {!report?.rows?.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {loading ? "재고 상태를 확인하고 있습니다." : "관리 중인 재고 기준점이 없습니다."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
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
    <article className={`rounded-xl border p-4 ${emphasized ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-2xl font-black text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}
