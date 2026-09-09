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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF21은 HF19의 A6 최대 화면출력·다중페이지 읽기전용 수집과 A21 200개 단위 송신, HF20의 CDP 보조감지를 그대로 유지합니다. 추가로 단품 판매상태 결과창의 모든 접근 가능한 프레임과 내부 스크롤 영역을 실제로 맨 아래까지 내린 뒤, 같은 프레임에서 '상품상태 변경 전송이 완료되었습니다.' 문구와 처리중 문구 소멸을 직접 확인합니다. 이 정확 완료문구가 1.8초 안정화되면 성공 ACK를 먼저 확정하고 해당 결과창을 자동으로 닫습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf21" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF21</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
