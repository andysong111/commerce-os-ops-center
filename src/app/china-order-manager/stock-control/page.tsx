import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <StockSyncHF15Bridge />
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF20은 HF19의 A6 최대 화면출력·다중페이지 읽기전용 수집과 A21 200개 단위 송신을 그대로 유지합니다. 단품 판매상태 결과창은 이제 일반 content-script 신호를 기다리지 않고, 이전에 옵션송신 결과창 자동닫기에 실제 성공했던 HF10 가격조정 방식과 동일하게 CDP Runtime + Accessibility로 직접 완료결과를 감지합니다. 총건수=성공건수+실패건수가 2.5초 안정화되면 Commerce OS 성공 ACK를 먼저 확정한 뒤 관리중인 결과창을 자동으로 닫습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf20" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF20</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
