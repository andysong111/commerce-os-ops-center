import { Suspense, type ReactNode } from "react";
import { AppShellRouteFrame } from "@/components/AppShellRouteFrame";
import { FreightBarcodePrintEnhancer } from "@/components/FreightBarcodePrintEnhancer";
import { OpsAiHelpDesk } from "@/components/OpsAiHelpDesk";
import { OpsCategoryUpdateCancelControl } from "@/components/OpsCategoryUpdateCancelControl";
import { OpsLocalCategoryStatusBridge } from "@/components/OpsLocalCategoryStatusBridge";
import { OpsLocalLiveTaskMirror } from "@/components/OpsLocalLiveTaskMirror";
import { OpsRetryPrefill } from "@/components/OpsRetryPrefill";
import { OpsWorkAssistant } from "@/components/OpsWorkAssistant";
import { Sidebar } from "@/components/Sidebar";
import { isDetailPageCostAdmin } from "@/lib/detailPageCostAdmin";
import { isOpsLoginTemporarilyDisabled } from "@/lib/opsLoginBypass";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export async function AppShell({ children }: { children: ReactNode }) {
  const loginDisabled = isOpsLoginTemporarilyDisabled();
  const { user } = loginDisabled ? { user: null } : await getOpsCurrentUser();
  const email = user?.email ?? "";

  const tools = (
    <>
      <Suspense fallback={null}>
        <Sidebar
          showDetailPageCosts={isDetailPageCostAdmin(email)}
          signedIn={Boolean(user)}
          email={email}
          loginDisabled={loginDisabled}
        />
      </Suspense>
      <OpsRetryPrefill />
      <div className="print:hidden">
        <OpsAiHelpDesk />
      </div>
      <FreightBarcodePrintEnhancer />
      {loginDisabled || user ? (
        <>
          <OpsLocalCategoryStatusBridge />
          <OpsLocalLiveTaskMirror />
          <OpsWorkAssistant />
          <OpsCategoryUpdateCancelControl />
        </>
      ) : null}
    </>
  );
  return <AppShellRouteFrame tools={tools}>{children}</AppShellRouteFrame>;
}
