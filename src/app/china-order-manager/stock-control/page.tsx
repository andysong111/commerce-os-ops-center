import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF8가 A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 검증·변경합니다. A21 목록 처리는 더 이상 재고확장용으로 재구현하지 않고 가격조정 확장프로그램의 content-a21.js 원본을 바이트 그대로 복사해 사용합니다. 따라서 검색결과 각 행 checkbox.click() → checked=true → input/change → 전건 체크 검증 → 빨간 상품 수정전송 순서가 가격조정 확장과 동일하게 실행됩니다. Commerce OS는 실제 Shopling 수정전송 팝업의 정확 URL에서 PriceCore claim이 들어온 뒤에만 A21_POPUP 상태로 전환하며, 팝업부터는 기존 검증된 PriceCore를 그대로 사용해 옵션송신만 실행합니다. 수량은 보존하고 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않으며 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf8" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF8</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
