import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { StockSyncHF15Bridge } from "@/components/china-order-manager/StockSyncHF15Bridge";
import { StockSyncSerialVerificationPanel } from "@/components/china-order-manager/StockSyncSerialVerificationPanel";
import { StockSyncVerificationReplayPanel } from "@/components/china-order-manager/StockSyncVerificationReplayPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <StockSyncHF15Bridge />
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="HF28은 HF27의 검증된 단품·옵션 송신 코어를 유지하면서 2-Lane 겹침 실행을 추가합니다. Lane 1은 Shopling 송신 접수가 객관적으로 확인되어 WAIT_A21_RESULT에 들어가면 정확한 결과탭만 별도 watcher로 분리합니다. 그 즉시 기존 단일 active 슬롯을 해제하고 새 Shopling 창/새 작업 workspace를 열어 Lane 2를 시작하므로 Lane 1의 결과처리 대기와 Lane 2의 A6/A21 작업이 동시에 진행됩니다. 결과창 자동닫기는 더 이상 다음 작업 진행이나 성공판정의 조건이 아니며, 닫히지 않아도 최종 footer와 결과 원장만 확인되면 계속 진행합니다. HF27 SUCCESS→SUCCEEDED 정규화, A6 최대 화면출력·다중페이지 수집, A21 200개 단위 송신, HF10 옵션상품 경로는 그대로 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf28" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF28</Link>} />
    <StockSyncSerialVerificationPanel />
    <StockSyncVerificationReplayPanel />
    <InventoryStockControlPanel />
  </div>;
}
