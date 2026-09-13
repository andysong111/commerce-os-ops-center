"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INVENTORY_REFRESH_PATH, inventoryStockReadClient } from "@/lib/inventoryStockConnection";
import { StockSyncOperationalQueuePanel } from "@/components/china-order-manager/StockSyncOperationalQueuePanel";

type RefreshState = "IDLE" | "REFRESHING" | "READY" | "ERROR";

export function InventoryStockOperationalDetails() {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const refreshBusy = useRef(false);
  const [hasFreshEvidence, setHasFreshEvidence] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>("IDLE");
  const [refreshMessage, setRefreshMessage] = useState("");

  const refreshBeforeQueue = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    setHasFreshEvidence(false);
    setRefreshState("REFRESHING");
    setRefreshMessage("판매·재고 증거를 최신화한 뒤 운영 큐를 엽니다. 잠시만 기다려 주세요.");
    try {
      // Refresh evidence exactly once here. The queue panel performs the single
      // authoritative Q read after it mounts, so opening this section no longer
      // does R→Q and then immediately repeats Q a second time.
      await inventoryStockReadClient.read<Record<string, unknown>>(INVENTORY_REFRESH_PATH, false);
      setHasFreshEvidence(true);
      setRefreshState("READY");
      setRefreshMessage("판매·재고 증거 최신화 완료 · 최신 운영 큐를 한 번 조회합니다.");
      // Wake the overview. The newly mounted queue shares/coalesces the same
      // read-only queue request through inventoryStockReadClient.
      window.dispatchEvent(new Event("online"));
    } catch (error) {
      setRefreshState("ERROR");
      setRefreshMessage(error instanceof Error ? error.message : "판매·재고 증거 최신화에 실패했습니다.");
    } finally {
      refreshBusy.current = false;
    }
  }, []);

  useEffect(() => {
    if (detailsRef.current?.open) void refreshBeforeQueue();
  }, [refreshBeforeQueue]);

  const onToggle = () => {
    if (!detailsRef.current?.open) return;
    void refreshBeforeQueue();
  };

  return (
    <details ref={detailsRef} onToggle={onToggle} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <summary className="cursor-pointer select-none text-sm font-black text-slate-800">
        자동 처리 실행 · 현재는 승인 1회 필요
      </summary>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        평소에는 위 화면만 확인하면 됩니다. 실제 판매상태 변경을 실행하거나 예외 원인을 확인할 때만 이 영역을 엽니다.
      </p>
      {refreshMessage ? (
        <div
          role={refreshState === "ERROR" ? "alert" : "status"}
          className={`mt-3 rounded-xl border px-4 py-3 text-sm font-bold ${refreshState === "ERROR" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-sky-200 bg-sky-50 text-slate-800"}`}
        >
          {refreshMessage}
        </div>
      ) : null}
      <div className="mt-4">
        {hasFreshEvidence ? (
          <StockSyncOperationalQueuePanel />
        ) : refreshState === "ERROR" ? (
          <button
            type="button"
            onClick={() => void refreshBeforeQueue()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            판매·재고 증거 다시 확인
          </button>
        ) : (
          <div className="rounded-xl border border-sky-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-600">
            {refreshState === "REFRESHING" ? "최신 판매·재고 증거 확인 중..." : "영역을 열면 최신 판매·재고 증거를 먼저 확인합니다."}
          </div>
        )}
      </div>
    </details>
  );
}
