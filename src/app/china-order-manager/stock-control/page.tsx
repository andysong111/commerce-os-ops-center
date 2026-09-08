import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF3가 A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 검증·변경합니다. A21은 goods key 검색결과를 최대 200건씩 정확 선택한 뒤 가격조정 확장프로그램의 검증된 상품 수정전송 규칙을 재사용하며, 현재 frame에서 버튼이 안 보이면 접근 가능한 Shopling frame 전체를 확인합니다. 수정전송 팝업부터는 가격조정 확장프로그램의 검증된 PriceCore를 그대로 사용해 옵션송신만 선택하고 MAIN-world 원본 송신을 호출합니다. 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않으며 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 HF3 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
