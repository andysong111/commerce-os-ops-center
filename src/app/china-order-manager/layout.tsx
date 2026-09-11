import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { ChinaOrderManagerNav } from "@/components/china-order-manager/ChinaOrderManagerNav";
import { FinalizedPurchaseRecommendationBanner } from "@/components/china-order-manager/FinalizedPurchaseRecommendationBanner";
import { PurchaseCycleClosurePanel } from "@/components/china-order-manager/PurchaseCycleClosurePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ChinaOrderManagerLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const refreshKey = requestHeaders.get("x-vercel-id") || requestHeaders.get("x-request-id") || "initial";
  return (
    <>
      <ChinaOrderManagerNav />
      <Suspense fallback={null}><PurchaseCycleClosurePanel refreshKey={refreshKey} /></Suspense>
      <FinalizedPurchaseRecommendationBanner />
      <div id="purchase-cycle-workspace">{children}</div>
    </>
  );
}
