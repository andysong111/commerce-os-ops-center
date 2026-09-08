import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF7가 A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 검증·변경합니다. A21에서는 검색결과의 실제 각 행 체크박스를 가격조정 확장프로그램과 동일하게 checkbox.click() → checked=true → input/change 이벤트 순서로 직접 처리하고 전건 체크를 검증한 뒤에만 빨간 상품 수정전송을 누릅니다. 실제 수정전송 팝업이 없는데 A21 팝업 대기상태만 남은 경우에는 5초 뒤 A21_LIST로 자동복구하여 개별행 체크부터 다시 실행합니다. 팝업부터는 검증된 PriceCore를 그대로 사용해 옵션송신만 선택하고 MAIN-world Shopling 원본 송신을 호출합니다. 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않으며 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf7" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF7</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
