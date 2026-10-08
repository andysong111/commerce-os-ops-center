import Link from "next/link";
import { InventoryStockOperationalDetails } from "@/components/china-order-manager/InventoryStockOperationalDetails";
import { InventoryStockoutOperatorPanel } from "@/components/china-order-manager/InventoryStockoutOperatorPanel";
import { InventoryStockOverviewPanel } from "@/components/china-order-manager/InventoryStockOverviewPanel";
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
        description="품절·판매중·현재 재고수량을 한 화면에 모두 입력하고 버튼을 한 번만 누르면 전체 검증과 저장, Shopling 상태 전송을 순서대로 처리합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/warehouse-capacity"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              창고 위치·수용능력
            </Link>
            <Link
              href="/api/shopling-stock-state-sync/download-hf30"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
            >
              재고상태 자동화 확장 v0.5.8 다운로드
            </Link>
          </div>
        }
      />

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-6 text-slate-700">
        <strong className="text-slate-950">확장 설치:</strong> 위의
        <strong> v0.5.8 다운로드</strong> → ZIP 압축 해제 → Chrome 주소창에
        <code className="mx-1 rounded bg-white px-2 py-1 font-mono text-xs">chrome://extensions</code>
        입력 → 개발자 모드 → 압축해제된 확장 프로그램 로드 → 압축을 푼 폴더 선택
      </div>

      <InventoryStockOverviewPanel />

      <InventoryStockoutOperatorPanel />

      <InventoryStockOperationalDetails />
    </div>
  );
}
