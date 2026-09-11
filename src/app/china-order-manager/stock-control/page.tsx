import Link from "next/link";
import { InventoryStockoutOperatorPanel } from "@/components/china-order-manager/InventoryStockoutOperatorPanel";
import { InventoryStockOverviewPanel } from "@/components/china-order-manager/InventoryStockOverviewPanel";
import { InventoryStocktakeOperatorPanel } from "@/components/china-order-manager/InventoryStocktakeOperatorPanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
import { StockSyncOperationalQueuePanel } from "@/components/china-order-manager/StockSyncOperationalQueuePanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InventoryStockControlPage() {
  return (
    <div className="space-y-5">
      <StockSyncHF15Bridge />
      <PageHeader
        eyebrow="COMMERCE OS · 재고 운영"
        title="재고·품절·판매재개"
        description="창고에서 확인한 사실만 입력하면 됩니다. 품절은 B코드로 확정하고, 재입고·실사 후에는 현재 수량을 확정합니다. 이후 입고와 판매를 반영해 현재 재고와 판매상태를 자동 판단합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/warehouse-capacity"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              창고 위치·수용능력
            </Link>
            <Link
              href="/api/shopling-stock-state-sync/download-hf28"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
            >
              재고상태 자동화 확장 v0.5.5 다운로드
            </Link>
          </div>
        }
      />

      <InventoryStockOverviewPanel />

      <div className="grid gap-5 xl:grid-cols-2">
        <InventoryStockoutOperatorPanel />
        <InventoryStocktakeOperatorPanel />
      </div>

      <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <summary className="cursor-pointer select-none text-sm font-black text-slate-800">
          자동 처리 실행 · 현재는 승인 1회 필요
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          평소에는 위 화면만 확인하면 됩니다. 실제 판매상태 변경을 실행하거나 예외 원인을 확인할 때만 이 영역을 엽니다.
        </p>
        <div className="mt-4">
          <StockSyncOperationalQueuePanel />
        </div>
      </details>
    </div>
  );
}
