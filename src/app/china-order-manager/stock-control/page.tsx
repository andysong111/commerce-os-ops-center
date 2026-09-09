import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
import { StockSyncVerificationReplayPanel } from "@/components/china-order-manager/StockSyncVerificationReplayPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <StockSyncHF15Bridge />
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="HF27은 HF26에서 확인된 실제 Shopling 송신 성공과 자동 결과창 종료 흐름을 그대로 유지하면서, 마지막 Commerce OS 결과 저장 오류를 수정합니다. 기존 단품 묶음 코어가 성공 시 SUCCESS를 반환했지만 Commerce OS 원장은 canonical 값 SUCCEEDED만 허용해 SHOPLING_STOCK_SYNC_STATE_INVALID가 발생했습니다. HF27은 finish 단계에서 SUCCESS→SUCCEEDED로 정규화하여 실제 성공 결과가 원장에 정상 기록되고 동기화 대기건이 해소되게 합니다. HF26의 장시간 결과대기 전환, 자동 closeManaged, A6 최대 화면출력·다중페이지 수집, A21 200개 단위 송신, HF10 옵션상품 경로는 모두 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf27" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF27</Link>} />
    <StockSyncVerificationReplayPanel />
    <InventoryStockControlPanel />
  </div>;
}
