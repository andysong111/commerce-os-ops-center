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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10 경로는 그대로 유지합니다. HF15는 HF14의 단품 A6→A21 기존행-only 품절/판매중 송신을 유지하면서, Commerce OS 페이지와 확장 사이 START/PING/READY/STATUS/PROGRESS/RESULT 통신을 HF15 전용 채널로 격리합니다. 따라서 예전 HF12/HF13/HF14 확장이 동시에 설치되어 있어도 새 실행 명령을 받지 못해 A4 상품조회수정으로 다시 들어가는 교차실행을 차단합니다. 단품은 A6에서 B코드로 goods key 후보만 읽고 A21에서 현재 실제로 존재하는 해당 goods key 결과행만 선택해 상품판매상태송신을 실행하며 A4는 사용하지 않습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf15" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF15</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
