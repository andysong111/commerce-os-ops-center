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
      description="HF25는 HF19/HF10의 안정 코어를 유지하면서 단품 판매상태 결과를 더 단순하게 처리합니다. SINGLE 작업이 실행 중이면 opener/최근생성 조건에 의존하지 않고 모든 정확한 aapi*.shopling.co.kr/prod_a/prod_status_trsmt.phtml 결과탭을 후보로 직접 검사합니다. 서비스워커가 늦게 깨어나도 부팅 즉시 이미 열린 결과탭을 다시 스캔하며, 서비스워커 콘솔에는 BOOT·후보탭·DOM 검사·완료판정·ACK·windows.remove 결과를 모두 남깁니다. 완료 footer가 2.5초 안정화되면 Commerce OS 성공 ACK를 먼저 확정하고 가격조정 확장프로그램의 closeManaged 순서로 실제 결과창/송신창을 제거합니다. A6 최대 화면출력·다중페이지 수집과 A21 200개 단위 송신, HF10 옵션상품 경로는 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf25" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF25</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
