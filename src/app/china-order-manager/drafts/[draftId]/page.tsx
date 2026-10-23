import Link from "next/link";
import { InternalChinaDraftStickySave } from "@/components/china-order-manager/InternalChinaDraftStickySave";
import { InternalChinaPurchaseBudgetAudit } from "@/components/china-order-manager/InternalChinaPurchaseBudgetAudit";
import { InternalChinaDraftBatchEditor } from "@/components/china-order-manager/InternalChinaDraftBatchEditor";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { loadInternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";
import { loadPurchaseDraftOperatorAdjustments } from "@/lib/purchaseCycleDraftRegeneration";
import { mergePurchaseDraftOperatorAdjustments } from "@/lib/purchaseCycleDraftRegenerationCore";
import { loadLatestInventoryStockEstimates } from "@/lib/inventoryStockEstimateBaselines";
import type { InventoryStockBand } from "@/lib/inventoryStockBulkInput";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type PageProps = {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ recalculationNotice?: string | string[] }>;
};

export default async function InternalChinaPurchaseDraftPage({
  params,
  searchParams,
}: PageProps) {
  const { draftId: rawDraftId } = await params;
  const rawNotice = (await searchParams).recalculationNotice;
  const initialNotice = (Array.isArray(rawNotice) ? rawNotice[0] : rawNotice || "").slice(0, 500);
  const draftId = decodeURIComponent(rawDraftId);
  let draft;
  let budgetAudit;
  let initialQuantityOverrides: Array<{ barcode: string; targetQuantity: number }> = [];
  let initialStockBands: Record<string, InventoryStockBand> = {};
  try {
    const [baseDraft, loadedBudgetAudit, persistedAdjustments, latestStockEstimates] = await Promise.all([
      loadInternalChinaPurchaseDraft(draftId),
      loadInternalChinaPurchaseBudgetAudit(draftId),
      loadPurchaseDraftOperatorAdjustments(draftId),
      loadLatestInventoryStockEstimates(),
    ]);
    draft = await loadInternalChinaDraftWithQuantityOverrides(baseDraft);
    budgetAudit = loadedBudgetAudit;
    const baseQuantityByBarcode = new Map(
      baseDraft.lines.map((line) => [line.barcode, line.quantity] as const),
    );
    const displayedQuantityOverrides = draft.lines.flatMap((line) =>
      baseQuantityByBarcode.get(line.barcode) === line.quantity
        ? []
        : [{ barcode: line.barcode, targetQuantity: line.quantity }],
    );
    initialQuantityOverrides = mergePurchaseDraftOperatorAdjustments(
      persistedAdjustments,
      { excludedBarcodes: [], quantityOverrides: displayedQuantityOverrides },
    ).quantityOverrides;
    initialStockBands = Object.fromEntries(
      draft.lines.flatMap((line) => {
        const stockBand = latestStockEstimates.get(line.barcode)?.stockBand;
        return stockBand ? [[line.barcode, stockBand] as const] : [];
      }),
    );
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="COMMERCE OS · 중국 발주·입고 내부 이전"
          title="중국 주문초안을 열지 못했습니다"
          description="Ops Center 내부 RESERVED Draft를 다시 확인한 뒤 열어주세요. GPT Site로 우회하지 않습니다."
          actions={
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안으로 돌아가기
            </Link>
          }
        />
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          {error instanceof Error ? error.message : "INTERNAL_CHINA_DRAFT_FAILED"}
        </section>
      </div>
    );
  }

  const regenerationParams = new URLSearchParams({
    check: "1",
    date: draft.cycleStartDate || seoulCalendarDate(),
    sourcing: "15",
    early: "1",
    selection: "automatic",
    replace: draft.draftId,
  });
  if (budgetAudit.grossCogsBudgetKrw > 0) {
    regenerationParams.set("cash", String(budgetAudit.grossCogsBudgetKrw));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · OPS CENTER NATIVE CHINA ORDER MVP"
        title="중국 발주초안"
        description="발주차시별 주문 준비 화면입니다. 모델명·모델번호·옵션과 대략 재고상태를 확인한 뒤 한 번의 재계산으로 최신 수량과 예산 잔액을 반영합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안
            </Link>
            <Link
              href="/china-order-manager"
              className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
            >
              발주·입고 원장
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
        <strong>현재 발주차시</strong> · {draft.previousCycleStartDate || "최초 30일 기준"} → {draft.cycleStartDate} · <span className="font-mono">{draft.draftId}</span> · {draft.lineCount.toLocaleString("ko-KR")} SKU · {draft.totalQuantity.toLocaleString("ko-KR")}개. 각 상품의 대략 재고를 버튼으로 고르고 <strong>`재고상태 저장 후 발주안 재계산`</strong>을 누르면, 수량·제외·추가 변경과 함께 같은 차시의 새 Draft로 교체합니다. 발주 가능액은 월별로 적립되며 실제 주문완료 금액만 차감됩니다.
      </section>

      <InternalChinaPurchaseBudgetAudit audit={budgetAudit} />

      <InternalChinaDraftBatchEditor
        initialDraft={draft}
        budgetAudit={budgetAudit}
        regenerationHref={`/purchase-cycle-preflight?${regenerationParams.toString()}`}
        initialQuantityOverrides={initialQuantityOverrides}
        initialStockBands={initialStockBands}
        initialNotice={initialNotice}
      />

      <InternalChinaDraftStickySave status={draft.status} />
    </div>
  );
}
