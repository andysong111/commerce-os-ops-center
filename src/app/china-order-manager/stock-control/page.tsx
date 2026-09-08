import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.5 HF10에서 실전 검증된 A6 읽기전용 goods key 탐색 → API 옵션상태 변경 → 가격조정 원본 A21 행선택 → 옵션송신 → CDP/Accessibility 완료확인 → 송신창 자동닫기 경로를 HF11에서도 그대로 잠가 유지합니다. HF11은 다음 단계인 옵션 없는 단품 경로를 강화합니다. 단품은 A4에서 정확 goods key 1건의 상품상태를 품절/판매중으로 변경한 뒤, A21 목록에서는 옵션상품에서 검증된 가격조정 원본 content-a21.js를 목록 선택에만 재사용해 동일 goods key의 쇼핑몰 행을 전부 체크하고 상품 수정전송을 엽니다. 실제 송신 팝업에서는 전용 worker가 상품판매상태송신만 선택하고 목표 상태(품절/판매중)만 송신하며, 완료문구가 2.5초 안정적으로 확인된 뒤 결과창을 자동으로 닫습니다. 옵션 HF10 코어는 변경하지 않았고 수량도 계속 보존합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf11" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF11</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
