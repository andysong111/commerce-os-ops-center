import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재 optQty를 그대로 보존한 채 상태만 변경·재검증합니다. v0.5.1은 A21 검색·최대 200행 선택 이후 수정전송 팝업이 열릴 때, 팝업의 assignment 요청이 A21 목록 단계 완료 신호보다 먼저 도착하는 짧은 경합을 안전한 제한 재시도로 흡수합니다. 실제 form 제어는 기존과 동일하게 검증된 가격조정 확장의 content-a21-v024.js와 main-a21-v024.js 코어를 사용하며, modify_tp=goods_stock 및 trsmt_env_mody_opt=1을 실제 form 값으로 선택한 뒤 Shopling 원본 goods_mallMdfy_submit_sp()를 호출합니다. 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.1 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
