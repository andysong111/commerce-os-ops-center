import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 A6 웹조작 없이 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재수량을 그대로 보존한 채 판매중/품절 상태만 변경·재검증합니다. v0.4.2는 이후 A21의 실제 '검색항목' 행에 API 확정 goods key를 정확 입력하고, 화면출력을 200개로 맞춘 뒤 같은 goods key의 쇼핑몰 결과행 전체를 최대 200건까지 검증·선택해 옵션송신합니다. 조회건수와 정확 goods key 행 수가 다르거나 200건을 초과하면 부분 전송하지 않고 중단합니다. 단품은 기존 A4→A21 경로를 유지하며 검색기간은 2024-01-01부터 실행 당일까지입니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.4.2 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}