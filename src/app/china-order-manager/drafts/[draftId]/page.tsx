import Link from "next/link";
import { InternalChinaDraftStickySave } from "@/components/china-order-manager/InternalChinaDraftStickySave";
import { InternalChinaPurchaseBudgetAudit } from "@/components/china-order-manager/InternalChinaPurchaseBudgetAudit";
import { InternalChinaManualDraftLineAdder } from "@/components/china-order-manager/InternalChinaManualDraftLineAdder";
import { InternalChinaPurchaseDraftWorkspaceV2 } from "@/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2";
import { PurchaseDraftRecalculationLink } from "@/components/china-order-manager/PurchaseDraftRecalculationLink";
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
};

export default async function InternalChinaPurchaseDraftPage({
  params,
}: PageProps) {
  const { draftId: rawDraftId } = await params;
  const draftId = decodeURIComponent(rawDraftId);
  const todaySeoul = seoulCalendarDate();
  let draft;
  let budgetAudit;
  try {
    [draft, budgetAudit] = await Promise.all([
      loadInternalChinaPurchaseDraft(draftId),
      loadInternalChinaPurchaseBudgetAudit(draftId),
    ]);
    draft = await loadInternalChinaDraftWithQuantityOverrides(draft);
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
            {draft.status === "DRAFT" ? (
              <PurchaseDraftRecalculationLink
                href={`/purchase-cycle-preflight?check=1&date=${todaySeoul}&skus=100&units=9999&replace=${encodeURIComponent(draft.draftId)}`}
              />
            ) : null}
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
        <strong>현재 Draft</strong> · <span className="font-mono">{draft.draftId}</span> · {draft.lineCount.toLocaleString("ko-KR")} SKU · {draft.totalQuantity.toLocaleString("ko-KR")}개. 링크·중국옵션·위안단가는 아래 표에서 바로 입력하고, <strong>주문수량도 모든 B-code 행의 수량 칸에서 직접 변경</strong>합니다. 수량 입력·변경 버튼은 표 자체에 포함되어 새로고침이나 행 추가 후에도 누락되지 않으며 ORDERED·입고 기준 수량으로 저장됩니다. 새 B-code만 `주문품목 추가`에서 처리합니다.
      </section>

      <InternalChinaPurchaseBudgetAudit audit={budgetAudit} />

      <InternalChinaManualDraftLineAdder
        draftId={draft.draftId}
        status={draft.status}
      />

      <InternalChinaPurchaseDraftWorkspaceV2
        initialDraft={draft}
        budgetAudit={budgetAudit}
      />

      <InternalChinaDraftStickySave status={draft.status} />
    </div>
  );
}
