import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. v0.4.0부터 옵션상품은 A6 웹조작을 제거하고 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재수량을 그대로 보존한 채 판매중/품절 상태만 변경·재검증합니다. 이후 로그인된 Shopling 관리자 메인 탭 하나를 기준으로 A21 작업창만 자동 생성해 옵션상태를 마켓으로 송신합니다. 단품은 기존 A4→A21 경로를 유지하며 검색기간은 2024-01-01부터 실행 당일까지입니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.4.0 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
