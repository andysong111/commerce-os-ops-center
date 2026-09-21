import Link from "next/link";
import { InventoryStockOperationalDetails } from "@/components/china-order-manager/InventoryStockOperationalDetails";
import { InventoryStockoutOperatorPanel } from "@/components/china-order-manager/InventoryStockoutOperatorPanel";
import { InventoryStockOverviewPanel } from "@/components/china-order-manager/InventoryStockOverviewPanel";
import { InventoryManualOnSaleOperatorPanel } from "@/components/china-order-manager/InventoryManualOnSaleOperatorPanel";
import { InventoryStocktakeOperatorPanel } from "@/components/china-order-manager/InventoryStocktakeOperatorPanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
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
              href="/api/shopling-stock-state-sync/download-hf29"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
            >
              재고상태 자동화 확장 v0.5.7 다운로드
            </Link>
          </div>
        }
      />

      <InventoryStockOverviewPanel />

      <div className="grid gap-5 xl:grid-cols-3">
        <InventoryStockoutOperatorPanel />
        <InventoryManualOnSaleOperatorPanel />
        <InventoryStocktakeOperatorPanel />
      </div>

      <InventoryStockOperationalDetails />
    </div>
  );
}
