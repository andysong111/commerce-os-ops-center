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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF23은 이번 실전 화면에서 확인된 실제 결과주소 aapi*.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml을 직접 처리합니다. http/https *.shopling.co.kr 결과페이지에 전용 감지기를 붙여 '상품상태 변경 전송이 완료되었습니다.'를 2.5초 안정화 확인한 뒤 Commerce OS 성공 ACK를 먼저 확정하고, 가격조정 확장프로그램의 completeJob→closeManaged 방식처럼 실제 결과창/기억된 송신창 window ID를 직접 제거합니다. SINGLE 결과처리는 이 직접 경로 하나만 권위로 사용해 이전 HF20~HF22 감시기와의 경합도 제거했습니다. A6 최대 화면출력·다중페이지 수집과 A21 200개 단위 송신은 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf23" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF23</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
