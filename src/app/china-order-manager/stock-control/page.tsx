import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재 optQty를 그대로 보존한 채 상태만 변경·재검증합니다. v0.5.0은 A21 검색·최대 200행 선택 이후의 수정전송 팝업 처리에서 별도 재고용 추측 로직을 제거하고, 현재 실전에서 동작하는 Shopling A21 가격·옵션 수정전송 확장의 content-a21-v024.js와 main-a21-v024.js를 그대로 복사해 namespace만 분리한 코어를 사용합니다. 즉 실제 form name/value와 Shopling 원본 goods_mallMdfy_submit_sp() 호출까지 같은 엔진을 사용합니다. 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.0 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
