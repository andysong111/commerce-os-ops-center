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
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10과 단품 A6→A21 기존행-only 정책은 그대로 유지합니다. HF18은 단품 상품판매상태 송신 결과창에서 별도 완료 footer가 없어도 각 쇼핑몰 블록의 총건수=성공건수+실패건수가 모두 성립하고 처리중 표시가 사라진 상태를 최종 완료로 인정합니다. 이 상태가 2.5초 안정적으로 유지되면 Shopling 묶음 송신 완료로 처리하고 결과창을 자동으로 닫습니다. 개별 마켓 실패는 후속 대응용 evidence로 남기되 묶음 자체를 다시 실패 처리하지 않습니다. HF18 전용 통신채널로 이전 버전과의 교차실행도 차단하며 A4는 사용하지 않습니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf18" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF18</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
