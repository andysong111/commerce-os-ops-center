import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { LifecycleReadinessPanel } from "./LifecycleReadinessPanel";
import { WarehouseCapacityClient } from "./WarehouseCapacityClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function WarehouseCapacityPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · 창고 운영"
        title="창고 위치·수용능력"
        description="전체 물리 위치코드, 현재 점유, 빈 위치, 단종·정리 후보를 하나의 원장으로 관리합니다. 전체 위치 목록과 생애주기 기준이 확정되기 전에는 수용률과 신규 소싱 가능 수량을 숫자로 확정하지 않습니다."
        actions={
          <Link
            href="/china-order-manager/stock-control"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            재고·품절 운영
          </Link>
        }
      />
      <LifecycleReadinessPanel />
      <WarehouseCapacityClient />
    </div>
  );
}
