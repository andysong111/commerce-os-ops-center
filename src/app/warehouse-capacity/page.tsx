import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { LifecycleReadinessPanel } from "./LifecycleReadinessPanel";
import { WarehouseCapacityClient } from "./WarehouseCapacityClient";
import { WarehouseIntakePreflightPanel } from "./WarehouseIntakePreflightPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function WarehouseCapacityPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · 창고 운영"
        title="창고 위치·수용능력"
        description="전체 물리 위치코드, 현재 점유, 빈 위치, 단종·정리 후보를 관리합니다. 실제 빈 공간과 정리 완료를 가정한 공간을 구분하며, 신규 상품·옵션의 위치 수를 실제 발주 없이 사전점검합니다. 전체 위치 목록 미확정 시 수용량 판단은 보류합니다."
        actions={
          <Link
            href="/china-order-manager/stock-control"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            재고·품절 운영
          </Link>
        }
      />
      <WarehouseIntakePreflightPanel />
      <LifecycleReadinessPanel />
      <WarehouseCapacityClient />
    </div>
  );
}
