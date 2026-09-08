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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10 경로는 그대로 유지합니다. HF16은 Commerce OS 페이지와 확장의 통신을 HF16 전용 채널로 격리해 HF15 이하 확장이 동시에 설치되어 있어도 새 실행을 받지 못하게 하고, 단품 A6→A21 묶음임을 가변 stage 문자열이 아니라 불변 stockSingleBatch 마커로 전달합니다. 따라서 SEARCH_SUBMITTED 같은 중간 stage 이후 재시도되어도 A6에서 발견됐지만 A21에서 이미 삭제된 goods key는 기록만 남기고 무시하며 같은 누락 오류로 다시 실패하지 않습니다. 대신 A21에서 실제 반환된 모든 행은 반드시 A6에서 해당 B코드로 얻은 goods key에 속해야 하며 그렇지 않으면 오송신 방지를 위해 즉시 차단합니다. A4는 사용하지 않습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf16" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF16</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
