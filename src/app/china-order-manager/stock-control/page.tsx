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
      description="HF26은 HF25 실전 로그로 확인된 90초 오판을 수정합니다. 실제 aapi*.shopling.co.kr/prod_a/prod_status_trsmt.phtml 결과페이지 진입은 송신이 이미 접수됐다는 객관적 증거이므로, 이 URL이 나타나는 즉시 단품 작업을 A21_LIST/A21_POPUP에서 WAIT_A21_RESULT로 승격합니다. 따라서 A21_POPUP의 90초 고정탭 watchdog이 정상 장시간 송신을 FAILED로 끊지 않고, 결과대기의 30분 제한으로 전환됩니다. 이후 HF25 스캐너가 최종 '상품상태 변경 전송이 완료되었습니다.'를 확인하면 성공 ACK 후 가격조정 확장프로그램의 closeManaged 순서로 결과창/송신창을 닫습니다. A6 최대 화면출력·다중페이지 수집, A21 200개 단위 송신, HF10 옵션상품 경로는 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf26" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF26</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
