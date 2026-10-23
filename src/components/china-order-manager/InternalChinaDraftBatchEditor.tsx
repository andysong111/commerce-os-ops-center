"use client";

import { useState } from "react";
import {
  InternalChinaManualDraftLineAdder,
  type StagedDraftAddition,
} from "@/components/china-order-manager/InternalChinaManualDraftLineAdder";
import { InternalChinaPurchaseDraftWorkspaceV2 } from "@/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2";
import type { InternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import type { InternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import type { PurchaseQuantityOverride } from "@/lib/purchaseCyclePreflightCore";
import type { InventoryStockBand } from "@/lib/inventoryStockBulkInput";

export function InternalChinaDraftBatchEditor({
  initialDraft,
  budgetAudit,
  regenerationHref,
  initialQuantityOverrides = [],
  initialStockBands = {},
  initialNotice = "",
}: {
  initialDraft: InternalChinaPurchaseDraft;
  budgetAudit: InternalChinaPurchaseBudgetAudit;
  regenerationHref: string;
  initialQuantityOverrides?: PurchaseQuantityOverride[];
  initialStockBands?: Record<string, InventoryStockBand>;
  initialNotice?: string;
}) {
  const [stagedAdditions, setStagedAdditions] = useState<StagedDraftAddition[]>([]);

  return (
    <>
      <InternalChinaManualDraftLineAdder
        draftId={initialDraft.draftId}
        status={initialDraft.status}
        stagedAdditions={stagedAdditions}
        onStagedAdditionsChange={setStagedAdditions}
      />

      <InternalChinaPurchaseDraftWorkspaceV2
        initialDraft={initialDraft}
        budgetAudit={budgetAudit}
        regenerationHref={regenerationHref}
        initialQuantityOverrides={initialQuantityOverrides}
        initialStockBands={initialStockBands}
        initialNotice={initialNotice}
        stagedAdditions={stagedAdditions}
        onStagedAdditionsChange={setStagedAdditions}
      />
    </>
  );
}
