import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF9가 HF8에서 실전 검증된 가격조정 확장프로그램의 A21 원본 엔진을 그대로 유지합니다. A6에서 B코드의 goods key를 읽기전용으로 확보하고 Commerce OS API로 해당 옵션 상태만 변경한 뒤, A21에서 가격조정 원본 content-a21.js가 실제 결과행을 checkbox.click() → checked=true → input/change 순서로 선택하고 빨간 상품 수정전송을 실행합니다. 실제 Shopling 수정전송 팝업이 생성된 뒤에는 기존 PriceCore로 옵션송신만 수행합니다. HF9는 여기에 가격조정 확장의 완료 후처리 구조를 추가해 '상품옵션 수정 전송이 완료되었습니다.' 완료문구를 모든 frame에서 감지하고 처리중 상태가 사라진 채 1.8초 안정적으로 유지되는지 검증한 뒤 기존 성공판정을 실행하고 결과창을 자동으로 닫습니다. 마켓별 실패는 기존 정책대로 기록만 남기고 Shopling 완료를 성공 기준으로 사용하며 수량은 보존합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf9" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF9</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
