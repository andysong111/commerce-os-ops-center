import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품은 Commerce OS 서버가 Shopling API에서 B코드 정확 옵션을 확인해 현재 optQty를 그대로 보존한 채 상태만 변경·재검증합니다. v0.5.1 HF1은 A21 팝업 assignment 경합을 제한 재시도로 흡수하고, Shopling 자체의 상품옵션/상품 수정전송 완료가 확인되면 쇼핑몰별 개별 실패는 증거로만 기록한 채 재고상태 동기화는 성공으로 이어갑니다. 실제 form 제어는 검증된 가격조정 확장의 content-a21-v024.js와 main-a21-v024.js 코어를 사용하며, 옵션상품은 modify_tp=goods_stock 및 trsmt_env_mody_opt=1 선택 후 Shopling 원본 goods_mallMdfy_submit_sp()를 호출합니다. 단품은 기존 A4→A21 경로를 유지합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.1 HF1 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
