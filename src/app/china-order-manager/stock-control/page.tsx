import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 A6 웹조작 없이 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재수량을 그대로 보존한 채 판매중/품절 상태만 변경·재검증합니다. v0.4.4는 A21에서 API 확정 goods key의 쇼핑몰 결과행을 최대 200건까지 선택한 뒤 수정전송 팝업이 재고동기화 작업을 스스로 claim합니다. 이후 화면문구 추측 대신 Shopling 실제 form 값 modify_tp=goods_stock, trsmt_env_mody_opt=1을 직접 선택·재검증하고 MAIN world에서 Shopling 원본 goods_mallMdfy_submit_sp() 함수를 호출해 옵션만 송신합니다. 단품은 기존 A4→A21 경로를 유지하며 검색기간은 2024-01-01부터 실행 당일까지입니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.4.4 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
