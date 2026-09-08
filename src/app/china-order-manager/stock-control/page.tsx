import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 HF10에서 실전 검증된 A6 읽기전용 goods key 탐색 → API 옵션상태 변경 → 가격조정 원본 A21 행선택 → 옵션송신 → CDP/Accessibility 완료확인 → 송신창 자동닫기 코어를 그대로 잠가 유지합니다. 단품의 HF11 A21 상품판매상태송신 경로도 유지합니다. HF12는 이번 실전 Canary에서 확인된 A4 자동진입 반복 문제만 수정합니다. Shopling의 인증된 /prod/prodLst.phtml 프레임에 샵플링상품코드 검색항목이 실제로 로드되면 이를 A4 상품조회수정 화면으로 즉시 확정하고, 이후 메뉴를 반복 클릭하지 않고 현재 프레임을 그대로 사용해 goods key 정확검색 → 품절/판매중 상태변경을 한 번만 실행합니다. 이후 A21 상품판매상태송신과 완료창 자동닫기는 기존 HF11 경로를 사용합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf12" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF12</Link>} />
    <InventoryStockControlPanel />
  </div>;
}