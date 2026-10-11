"use client";

import type { ManualSourcingCandidatePreset } from "@/lib/manualSourcingCandidatePresets";
import { MANUAL_SOURCING_BULK_ADD_EVENT } from "@/lib/manualSourcingDraftStorage";

export function BulkSourcingCandidateButton({
  candidates,
  manualFormId,
}: {
  candidates: ManualSourcingCandidatePreset[];
  manualFormId: string;
}) {
  function addAll() {
    window.dispatchEvent(new CustomEvent(MANUAL_SOURCING_BULK_ADD_EVENT, {
      detail: { candidates },
    }));
    document.getElementById(manualFormId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const optionCount = candidates.reduce((sum, product) => sum + product.variants.length, 0);

  return (
    <button
      type="button"
      onClick={addAll}
      className="mt-4 min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-black text-white hover:bg-blue-800"
    >
      소싱 후보 {optionCount}개 모두 발주안 검토목록에 담기
    </button>
  );
}
