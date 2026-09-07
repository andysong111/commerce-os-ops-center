import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.4가 실행 당일 A6 옵션대량수정에서 옵션자체관리코드(B코드)를 2013-09-12~오늘 최대기간으로 검색한 뒤 결과행의 Shopling 상품코드(goods key)만 읽습니다. A6 체크박스나 상태 일괄변경은 건드리지 않습니다. 확보한 모든 goods key를 대상으로 Commerce OS가 Shopling API에서 해당 B코드 옵션의 현재 수량은 그대로 보존하고 상태만 품절/판매중으로 검증·변경한 뒤, A21에서 goods key를 하나씩 직렬 옵션송신합니다. 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않습니다. A21 팝업은 검증된 가격조정 확장 코어를 사용하고 Shopling 자체 수정전송 완료 뒤의 쇼핑몰별 개별 실패는 증거로만 기록합니다. 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.4 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
