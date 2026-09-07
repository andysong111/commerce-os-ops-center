import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 v0.5.3이 실행 당일 A6 옵션대량수정에서 옵션자체관리코드(B코드)를 2013-09-12~오늘 최대기간으로 정확 검색해 현재 연결된 모든 Shopling 상품코드(goods key)를 확보하고 해당 B코드 옵션행 전체의 상태를 품절/판매중으로 변경합니다. 레거시 A6 결과에서 B코드가 글자가 아니라 입력칸 값으로 표시돼도 정확 행으로 인식합니다. 이후 확보한 모든 goods key를 A21에서 하나씩 직렬 옵션송신하며 전건 완료 전에는 B코드 전체를 성공으로 처리하지 않습니다. A21 팝업은 검증된 가격조정 확장 코어를 사용하고 Shopling 자체 수정전송 완료 뒤의 쇼핑몰별 개별 실패는 증거로만 기록합니다. 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.3 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
