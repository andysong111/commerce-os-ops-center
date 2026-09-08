import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. 옵션상품 HF10 경로는 그대로 유지합니다. HF14의 옵션 없는 단품은 A4를 사용하지 않고 A6에서 B코드를 읽기전용으로 정확 검색해 현재 Shopling goods key 후보만 수집한 뒤 A21에서 최대 200개씩 샵플링상품코드 다중검색 → 실제로 남아 있는 결과행만 전건 선택 → 상품 수정전송 → 상품판매상태송신 품절/판매중으로 처리합니다. A6에서 발견됐지만 A21에서 이미 삭제되어 검색되지 않는 goods key는 누락으로 기록만 하고 무시합니다. 반대로 A21에 반환된 행 중 A6에서 얻은 goods key에 속하지 않는 행이 하나라도 섞이면 다른 상품 오송신 위험 때문에 즉시 차단합니다. 조회결과가 500행을 넘으면 묶음을 자동 축소하며, 완료문구 안정화와 송신창 자동닫기는 기존 검증 코어를 유지합니다. 대량 병렬창은 단품 Canary 완료 후 가격조정 방식으로 확장합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download-hf14" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.5.5 다운로드 · HF14</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
