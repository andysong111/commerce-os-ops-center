import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PurchaseCycleReentryShadowPanel } from "@/components/china-order-manager/PurchaseCycleReentryShadowPanel";
import { reentryShadowMonths } from "@/lib/purchaseCycleReentryShadowCore";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function PurchaseReentryShadowPage() {
  const { next } = reentryShadowMonths(new Date().toISOString());
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · PURCHASE REENTRY · READ ONLY" title="다음 발주 사전 점검"
      description="검증된 재고 변화와 미입고를 기존 V2 계산식에 반영하는 Shadow 화면입니다. 계산은 자동, 실제 발주 승인은 별도입니다."
      actions={<div className="flex flex-wrap gap-2"><Link href="/china-order-manager/cash-envelope" className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold">실제 발주일 V2 계산</Link><Link href="/china-order-manager/stock-control" className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold">재고·판매상태 확인</Link></div>} />
    <PurchaseCycleReentryShadowPanel targetMonth={next} />
  </div>;
}
