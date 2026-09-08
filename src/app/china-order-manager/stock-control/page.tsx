import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10 경로는 그대로 유지합니다. HF13부터 옵션 없는 단품은 A4를 완전히 사용하지 않습니다. 단품도 먼저 A6 옵션대량수정 화면에서 B코드를 읽기전용으로 정확 검색해 체크·상태변경 없이 현재 Shopling goods key만 전부 수집합니다. 이후 A21 쇼핑몰상품수정에서 가격조정 확장의 검증된 다중 goods key 엔진을 그대로 재사용해 최대 200개씩 샵플링상품코드 다중검색 → 정확 결과행 전건 선택 → 상품 수정전송을 열고, 전용 팝업 worker가 상품판매상태송신만 선택해 품절/판매중을 송신합니다. 한 묶음의 조회결과가 500행을 넘으면 묶음을 자동 축소하고, 완료문구가 안정적으로 확인된 뒤 다음 묶음으로 진행합니다. 현재 HF13은 BCB2-1 같은 200개 이하 Canary를 안전하게 검증하기 위해 묶음을 직렬 실행하며 대량 병렬창은 Canary 확인 후 가격조정 방식으로 확장합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf13" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF13</Link>} />
    <InventoryStockControlPanel />
  </div>;
}