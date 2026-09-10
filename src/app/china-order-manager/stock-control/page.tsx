import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { InventoryStocktakeBaselinePanel } from "@/components/china-order-manager/InventoryStocktakeBaselinePanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
import { StockSyncOperationalQueuePanel } from "@/components/china-order-manager/StockSyncOperationalQueuePanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <StockSyncHF15Bridge />
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="HF28의 단품·옵션 2-Lane 병렬 검증을 통과했으므로 반복 검증 패널은 운영 화면에서 제거했습니다. 실제 운영 큐는 Commerce OS 정확재고의 syncNeeded만 사용하고 품절을 우선하여 최대 2건씩 처리합니다. Lane 1 결과대기는 송신 접수 후 별도 watcher로 분리하고 Lane 2는 새 Shopling 창에서 진행하며 결과창 닫힘 여부는 성공판정이나 다음 작업의 조건이 아닙니다. FAILED/UNCERTAIN은 같은 실행에서 자동 재시도하지 않고 예외 큐로 격리합니다. 현재 단계는 30초 자동감지 + 버튼 1회 승인 방식이며 실전 대기건 검증 후 완전자동으로 전환합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf28" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF28</Link>} />
    <StockSyncOperationalQueuePanel />
    <InventoryStocktakeBaselinePanel />
    <InventoryStockControlPanel />
  </div>;
}
