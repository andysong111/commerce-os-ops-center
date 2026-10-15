import Link from "next/link";
import { InternalChinaDraftStickySave } from "@/components/china-order-manager/InternalChinaDraftStickySave";
import { InternalChinaPurchaseBudgetAudit } from "@/components/china-order-manager/InternalChinaPurchaseBudgetAudit";
import { InternalChinaDraftBatchEditor } from "@/components/china-order-manager/InternalChinaDraftBatchEditor";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { loadInternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";

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
  const todaySeoul = seoulCalendarDate();
  let draft;
  let budgetAudit;
  let initialQuantityOverrides: Array<{ barcode: string; targetQuantity: number }> = [];
  try {
    const [baseDraft, loadedBudgetAudit] = await Promise.all([
      loadInternalChinaPurchaseDraft(draftId),
      loadInternalChinaPurchaseBudgetAudit(draftId),
    ]);
    draft = await loadInternalChinaDraftWithQuantityOverrides(baseDraft);
    budgetAudit = loadedBudgetAudit;
    const baseQuantityByBarcode = new Map(
      baseDraft.lines.map((line) => [line.barcode, line.quantity] as const),
    );
    initialQuantityOverrides = draft.lines.flatMap((line) =>
      baseQuantityByBarcode.get(line.barcode) === line.quantity
        ? []
        : [{ barcode: line.barcode, targetQuantity: line.quantity }],
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
    date: todaySeoul,
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
        description="기존 GPT Site의 주문 준비 단계를 대체하는 Ops Center 내부 화면입니다. 빠른 발주안의 RESERVED 수량을 기준으로 실제 주문 직전 검증을 끝내고, 예산 잔액이나 같은 모델의 추가 옵션은 현재 월간 Draft 한 건에 수동으로 더할 수 있습니다."
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
        <strong>현재 Draft</strong> · <span className="font-mono">{draft.draftId}</span> · {draft.lineCount.toLocaleString("ko-KR")} SKU · {draft.totalQuantity.toLocaleString("ko-KR")}개. 수량 변경·상품 제외·상품 추가는 먼저 계산 대기로 모은 뒤, <strong>`변경사항 모아 발주안 바로 재계산` 버튼 한 번</strong>으로 이 화면에서 즉시 교체합니다. 수량은 5개 단위로 정리하고 남은 예산은 다음 우선순위에 배정합니다.
      </section>

      <InternalChinaPurchaseBudgetAudit audit={budgetAudit} />

      <InternalChinaDraftBatchEditor
        initialDraft={draft}
        budgetAudit={budgetAudit}
        regenerationHref={`/purchase-cycle-preflight?${regenerationParams.toString()}`}
        initialQuantityOverrides={initialQuantityOverrides}
        initialNotice={initialNotice}
      />

      <InternalChinaDraftStickySave status={draft.status} />
    </div>
  );
}
