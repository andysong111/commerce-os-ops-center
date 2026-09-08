import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF5가 A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 검증·변경합니다. A21은 goods key 검색결과를 최대 200건으로 제한·검증한 뒤 상품 수정전송 앞의 범위를 '전체정보'로 고정합니다. 헤더 전체선택 버튼에는 더 이상 의존하지 않고, 가격조정 확장프로그램에서 이미 검증된 각 결과행 checkbox.click() + checked/input/change 방식을 호환성 확인용으로 재사용한 뒤 빨간 상품 수정전송을 누릅니다. 수정전송 팝업부터는 검증된 PriceCore를 그대로 사용해 옵션송신만 선택하고 MAIN-world Shopling 원본 송신을 호출합니다. 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않으며 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf5" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF5</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
