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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF24는 결과페이지가 확장으로 메시지를 보내는 구조 자체를 제거했습니다. background service worker가 실제 aapi*.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml 탭을 직접 찾고 chrome.scripting.executeScript로 화면 내용을 읽습니다. '상품상태 변경 전송이 완료되었습니다.'가 2.5초 안정화되면 Commerce OS 성공 ACK를 먼저 확정하고 가격조정 확장프로그램의 completeJob→closeManaged 순서처럼 실제 결과창과 기억된 송신창 window ID를 직접 제거합니다. 이전 HF20~HF23 SINGLE 결과 감시기는 가져오지 않습니다. A6 최대 화면출력·다중페이지 수집과 A21 200개 단위 송신, HF10 옵션상품 경로는 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf24" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF24</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
