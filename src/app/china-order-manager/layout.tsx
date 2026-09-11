import { Suspense, type ReactNode } from "react";
import { ChinaOrderManagerNav } from "@/components/china-order-manager/ChinaOrderManagerNav";
import { FinalizedPurchaseRecommendationBanner } from "@/components/china-order-manager/FinalizedPurchaseRecommendationBanner";
import { PurchaseCycleClosurePanel } from "@/components/china-order-manager/PurchaseCycleClosurePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChinaOrderManagerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChinaOrderManagerNav />
      <Suspense fallback={null}><PurchaseCycleClosurePanel refreshKey={Date.now()} /></Suspense>
      <FinalizedPurchaseRecommendationBanner />
      <div id="purchase-cycle-workspace">{children}</div>
    </>
  );
}
