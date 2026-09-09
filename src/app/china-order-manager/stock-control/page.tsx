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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. HF19은 A6 조회 화면출력을 사용 가능한 최대값으로 고정하고 조회결과가 여러 페이지면 동일 로그인 세션에서 모든 페이지를 읽기전용으로 수집합니다. 페이지를 안전하게 특정할 수 없으면 일부 결과만으로 진행하지 않고 중단합니다. A21은 품절·판매중 모두 화면출력 200개로 고정하고 200건 한도에서 묶음 송신합니다. 단품 결과는 완료 ACK를 먼저 확정한 뒤 결과창을 닫아 실제 송신 성공이 결과창 닫기 문제 때문에 90초 실패로 바뀌지 않게 합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf19" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF19</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
