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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF22는 실제 가격조정 확장프로그램 v0.4.4의 결과 처리 방식을 그대로 단품 판매상태에 옮겼습니다. 결과창을 Shopling URL로만 찾지 않고 새로 열린 탭·opener 관계와 about:blank/javascript/blob 결과창까지 추적하며, 모든 실행 컨텍스트와 Accessibility에서 최종 완료 footer를 확인합니다. 완료가 2.5초 안정화되면 ACK를 먼저 확정하고 결과창을 window 단위로 닫습니다. 전체 단품 작업이 끝났다면 Commerce OS가 만든 A6/A21 작업창도 함께 정리합니다. A6 최대 화면출력·다중페이지 수집과 A21 200개 단위 송신은 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf22" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF22</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
