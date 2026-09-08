import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF10이 HF8에서 실전 검증된 가격조정 확장프로그램의 A21 원본 엔진과 기존 PriceCore 옵션송신을 그대로 유지합니다. A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 변경한 뒤 A21에서 가격조정 원본 content-a21.js가 실제 결과행을 checkbox.click() → checked=true → input/change 순서로 선택하고 빨간 상품 수정전송을 실행합니다. HF10은 완료 후처리를 가격조정 확장 v0.4.4 방식으로 강화해 실제 A21 송신창의 추적 tab을 Chrome CDP Runtime + Accessibility로 직접 검사하고 '상품옵션 수정 전송이 완료되었습니다.' footer가 처리중 상태 없이 2.5초 안정적으로 유지된 경우에만 성공판정합니다. 성공 확정 후 해당 송신창이 독립 popup window면 창 전체를 자동으로 닫고, 다른 작업탭과 창을 공유하는 경우에는 결과 tab만 닫습니다. A6/A21 고정 작업탭은 보호하며 마켓별 실패는 기존 정책대로 기록만 남기고 Shopling 완료를 성공 기준으로 사용합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf10" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF10</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
