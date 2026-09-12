"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INVENTORY_QUEUE_PATH, INVENTORY_REFRESH_PATH, inventoryStockReadClient, startInventoryPolling } from "@/lib/inventoryStockConnection";

type StockRow = {
  barcode: string; productName: string; exactInventoryQuantity: number;
  desiredStatus: "SOLD_OUT" | "ON_SALE"; salesCoverageReady?: boolean;
  syncNeeded: boolean; syncBlocked: boolean; syncBlockReason: string | null;
};
type StockReport = {
  state: "READY" | "BLOCKED"; generatedAt?: string; soldOutCount: number;
  onSaleCount: number; pendingSyncCount: number; uncertainSyncCount: number; rows: StockRow[];
};
type QueuePayload = { report: StockReport; jobs?: Array<{ jobId: string }> };
const number = new Intl.NumberFormat("ko-KR");
export function InventoryStockOverviewPanel() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [lastSuccess, setLastSuccess] = useState("");
  const mounted = useRef(false);
  const manualBusy = useRef(false);

  const failure = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setStale(true);
    setLoading(false);
    setNotice(error instanceof Error ? error.message : "재고 조회에 실패했습니다. 기존 기준점은 유지됩니다.");
  }, []);
  const loadQueue = useCallback(async (fresh = false) => {
    const payload = await inventoryStockReadClient.read<QueuePayload>(INVENTORY_QUEUE_PATH, fresh);
    if (!mounted.current) return;
    setReport(payload.report);
    setJobCount(payload.jobs?.length ?? 0);
    setStale(false);
    setLastSuccess(new Date().toLocaleString("ko-KR"));
    setNotice("");
    setLoading(false);
  }, []);
  const refreshSalesAndStock = useCallback(async () => {
    if (manualBusy.current) return;
    manualBusy.current = true;
    setLoading(true);
    try {
      await inventoryStockReadClient.read(INVENTORY_REFRESH_PATH);
      await loadQueue(true);
      if (mounted.current) setNotice("판매와 재고를 다시 확인했습니다.");
    } catch (error) { failure(error); }
    finally { manualBusy.current = false; if (mounted.current) setLoading(false); }
  }, [failure, loadQueue]);

  useEffect(() => {
    mounted.current = true;
    // Initial/automatic reads are read-only. Tail refresh is the explicit button.
    const polling = startInventoryPolling({
      task: () => loadQueue(), onError: failure,
      active: () => document.visibilityState === "visible" && navigator.onLine !== false && !manualBusy.current,
    });
    const wake = () => { void polling.run(); };
    wake();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      mounted.current = false;
      polling.stop();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [failure, loadQueue]);
  const ready = report?.state === "READY" && !stale;
  const blockedCount = useMemo(() => (report?.rows ?? []).filter((row) => row.syncNeeded && row.syncBlocked).length, [report]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-slate-500">현재 재고 상태</span>
          <h2 className="mt-1 text-xl font-black text-slate-950">품절·판매재개 자동판단</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">확정한 기준재고에 이후 입고와 판매를 반영합니다. 조회가 지연되면 재고를 임의 확정하지 않고 자동 처리를 보류합니다.</p>
        </div>
        <button type="button" onClick={() => void refreshSalesAndStock()} disabled={loading} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:text-slate-400">{loading ? "확인 중..." : "판매·재고 다시 확인"}</button>
      </div>
      {notice ? <div role={stale ? "alert" : "status"} className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${stale ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{notice}</div> : null}
      {lastSuccess ? <p className="mt-2 text-xs text-slate-500">마지막 정상 조회: {lastSuccess}{stale ? " · 아래 목록은 이전 조회 기록이며 현재 상태가 아닙니다." : ""}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="품절" value={ready ? report.soldOutCount : "—"} />
        <Metric label="판매중" value={ready ? report.onSaleCount : "—"} />
        <Metric label="자동 처리 대기" value={ready ? jobCount ?? "—" : "—"} emphasized />
        <Metric label="확인 필요" value={ready ? blockedCount + report.uncertainSyncCount : "—"} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[760px] w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-3">B코드 / 상품</th><th className="px-3 py-3 text-right">현재 재고</th><th className="px-3 py-3">자동판단</th><th className="px-3 py-3">처리상태</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(report?.rows ?? []).map((row) => (
              <tr key={row.barcode}>
                <td className="px-3 py-3"><strong className="font-mono text-slate-950">{row.barcode}</strong><span className="ml-2 text-slate-500">{row.productName}</span></td>
                <td className="px-3 py-3 text-right text-base font-black text-slate-950">{ready && row.salesCoverageReady !== false ? `${number.format(row.exactInventoryQuantity)}개` : "확인 보류"}</td>
                <td className="px-3 py-3 font-black">{ready && row.salesCoverageReady !== false ? row.desiredStatus === "SOLD_OUT" ? "품절" : "판매중" : "판단 보류"}</td>
                <td className="px-3 py-3 text-slate-600">{!ready ? "조회 복구 대기 · 이전 기록" : row.syncBlocked ? row.syncBlockReason || "확인 필요" : row.syncNeeded ? "자동 처리 대기" : "반영 완료"}</td>
              </tr>
            ))}
            {!report?.rows?.length ? <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">{loading ? "재고 상태를 확인하고 있습니다." : ready ? "관리 중인 재고 기준점이 없습니다." : "조회 실패로 기준점을 확인할 수 없습니다. 재고가 없다는 뜻이 아닙니다."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Metric({ label, value, emphasized = false }: { label: string; value: number | string; emphasized?: boolean }) {
  return <article className={`rounded-xl border p-4 ${emphasized ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}><span className="text-xs font-bold text-slate-500">{label}</span><strong className="mt-1 block text-2xl font-black text-slate-950">{typeof value === "number" ? number.format(value) : value}</strong></article>;
}
