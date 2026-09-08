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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10과 단품 A6→A21 기존행-only 정책은 그대로 유지합니다. HF17은 실제 상품수정 송신 팝업에서 단품 전용 worker가 가변 stage 문자열에 의존하지 않고 팝업 URL과 RUNNING SINGLE 작업을 기준으로 연결되며, 화면의 정확한 텍스트 셀/행을 사용해 '상품판매상태송신' 라디오와 목표상태 '품절/판매중' 라디오를 각각 선택한 뒤 상품수정 송신을 실행합니다. 따라서 넓은 상위 DOM 텍스트 때문에 일반내용수정이나 판매중 같은 다른 라디오를 잘못 잡는 문제를 차단합니다. HF17 전용 통신채널로 이전 버전과의 교차실행도 차단하며 A4는 사용하지 않습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf17" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF17</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
