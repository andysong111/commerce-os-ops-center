import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PurchaseCycleDraftActions } from "@/components/purchase-cycle-preflight/PurchaseCycleDraftActions";
import { NewProductConfigurationCalculateButton } from "@/components/purchase-cycle-preflight/NewProductConfigurationCalculateButton";
import { PurchasePreflightForm } from "@/components/purchase-cycle-preflight/PurchasePreflightForm";
import { SourcingCandidateSelectionForm } from "@/components/purchase-cycle-preflight/SourcingCandidateSelectionForm";
import { ManualProductIntakeForm } from "@/components/sourcing-center/ManualProductIntakeForm";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import { validatePurchasePreflightOptions, type PurchaseCyclePreflightReport } from "@/lib/purchaseCyclePreflightCore";
import { purchaseCycleDraftConfirmation } from "@/lib/purchaseCyclePreflightDraftCore";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";
import { loadSourcingBudgetPlan, type SourcingBudgetPlan } from "@/lib/sourcingBudgetPlan";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 600;
const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const ENGINE_MAX_SKUS = 100;
const ENGINE_MAX_UNITS_PER_SKU = 9_999;
const NEW_PRODUCT_CONFIGURATION_FORM_ID = "new-product-configuration-form";
const MANUAL_PRODUCT_FORM_ID = "manual-product-intake-form";
const statusLabels = { VERIFIED: "근거 확인", PARTIAL: "일부 확인", WAITING: "확인 대기", BLOCKED: "차단", LOCKED: "실행 잠금" };
const reasonLabels: Record<string, string> = {
  INVENTORY_EVIDENCE_STALE_OR_UNPINNED: "재고·원가 원본이 15분 신선도 기준을 넘었거나 원본 지문을 확인하지 못했습니다.",
  CYCLE_SPEND_CHANGED_OR_UNVERIFIED: "이번 달 기존 발주 지출액을 확인하지 못했거나 점검 중 바뀌었습니다.",
  CYCLE_SPEND_READ_FAILED: "기존 발주 지출액 조회 실패",
  CYCLE_SPEND_RECHECK_FAILED: "기존 발주 지출액 재확인 실패",
  GROSS_FUNDING_BASIS_UNVERIFIED: "배송비 여유분을 포함한 월간 지출 한도를 확인하지 못했습니다.",
  SOURCE_CHANGED_OR_MISSING: "조회 중 판매자료가 바뀌었거나 원본을 확인하지 못했습니다.",
  SALES_SOURCE_STALE_OR_FUTURE: "판매자료가 12시간 신선도 기준을 넘었거나 분석시점이 잘못됐습니다.",
  SALES_PROMOTION_NOT_VERIFIED: "공식 판매자료 승인 검증이 끝나지 않았습니다.",
  PRODUCT_MASTER_FULL_READBACK_REQUIRED: "상품마스터 반영 후 동일 원본 재조회 검증이 필요합니다.",
  PURCHASE_SOURCE_CONTEXT_MISMATCH: "발주안·판매·상품정보·공식원장의 원본 지문이 일치하지 않습니다.",
  PURCHASE_SHADOW_NOT_READY: "발주 모의 계산의 준비 상태를 확인하지 못했습니다.",
  TARGET_CYCLE_RECALCULATION_REQUIRED: "발주 예정 월을 기준으로 다시 계산해야 합니다. 다른 달의 추천을 재사용하지 않습니다.",
  BUDGET_MONTH_NOT_CLOSED: "예산 기준 월이 아직 끝나지 않아 그 달의 최종 매출예산을 확정할 수 없습니다.",
  OPEN_BUDGET_EARLY_PREVIEW_RECHECK_REQUIRED: "월 마감 전 조기 미리보기입니다. 실제 주문 전에 마감 자료로 다시 계산해야 합니다.",
  MONTHLY_BUDGET_NOT_VERIFIED: "발주안의 월간 예산을 확인하지 못했습니다.",
  SAME_TIME_LEGACY_COMPARISON_REQUIRED: "기존 방식과 동일 분석시점으로 비교한 결과가 필요합니다.",
  OWNER_REVIEW_ON_TARGET_DATE: "예정일에 최신 자료와 금액을 다시 확인하고 최종 승인해야 합니다.",
  TARGET_DATE_RECONFIRM_REQUIRED: "발주 예정일이 지났습니다. 새 일정을 확인해야 합니다.",
  DUPLICATE_BARCODE: "중복 B코드가 있어 품목 식별을 확인해야 합니다.",
  NO_VERIFIED_CANDIDATE_WITHIN_LIMITS: "원가·재고·현금·수량 제한을 모두 충족하는 품목이 없습니다.",
  IDENTITY_REVIEW: "B코드 확인 필요", CONFIRMED_COST_REQUIRED: "확정원가 필요",
  NO_ACTIVE_WHOLESALE_LISTING: "판매 중인 도매1~도매4 상품 연결이 없어 원가를 추정할 수 없습니다.",
  WHOLESALE_LISTING_PRICE_UNRESOLVED: "도매 상품 가격이 서로 충돌해 원가 추정을 중단했습니다.",
  ACTIVE_WHOLESALE_PRICE_UNAVAILABLE: "판매 중인 도매 상품의 현재 가격을 확인하지 못했습니다.",
  WHOLESALE_COST_ESTIMATE_UNAVAILABLE: "도매 판매가 원가 추정 자료를 사용할 수 없습니다.",
  WHOLESALE_COST_ESTIMATE_READ_FAILED: "샵플링 도매 판매가 조회에 실패했습니다. 확정원가가 없는 품목은 제외됩니다.",
  WHOLESALE_COST_ESTIMATE_STALE_OR_UNPINNED: "도매 판매가 추정 자료가 오래됐거나 Product Master 원본과 일치하지 않습니다.",
  WHOLESALE_COST_ESTIMATE_OWNER_REVIEW_REQUIRED: "도매 판매가를 역산한 추정 원가가 포함되어 있습니다. 실제 주문 전 1688 단가를 입력하고 다시 확인해야 합니다.",
  OWNER_COST_ESTIMATE_INVALID: "사용자 제공 추정 원가의 품목·금액·추적 지문이 올바르지 않아 사용하지 않았습니다.",
  OWNER_COST_ESTIMATE_READ_FAILED: "사용자 제공 추정 원가를 읽지 못해 해당 품목을 제외했습니다.",
  OWNER_COST_ESTIMATE_REVIEW_REQUIRED: "사용자 제공 대략 원가 또는 유사상품 참고 원가가 포함되어 있습니다. 실제 주문 전 현재 1688 단가를 입력하고 다시 확인해야 합니다.",
  VERIFIED_INVENTORY_REQUIRED: "재고 근거 필요", INVALID_RECOMMENDATION: "추천수량·점수 확인 필요",
  PROVISIONAL_INVENTORY_OWNER_REVIEW_REQUIRED: "추정재고를 사용한 미리보기입니다. 실제 주문 전에 최신 품절·입고·판매 상태를 확인해야 합니다.",
  CANARY_QUANTITY_LIMIT: "품목별 수량 상한 초과", ROW_EXECUTION_BLOCKED: "품목별 조건 미충족",
  CANARY_SKU_LIMIT: "발주안 SKU 수 제한", CASH_BUDGET_LIMIT: "현금 상한 초과",
  CANDIDATE_READ_FAILED: "판매 후보 조회 실패", CANDIDATE_RECHECK_FAILED: "판매 후보 재확인 실패",
  PROMOTION_GATE_READ_FAILED: "판매원장 게이트 조회 실패", MASTER_READBACK_READ_FAILED: "상품마스터 대사 조회 실패",
  INVENTORY_PRIORITY_READ_FAILED: "재고·발주 우선순위 조회 실패",
  REPLACEMENT_DRAFT_READ_FAILED: "기존 Draft를 읽지 못했습니다.",
  REPLACEMENT_DRAFT_RECHECK_FAILED: "계산 뒤 기존 Draft를 다시 확인하지 못했습니다.",
  REPLACEMENT_DRAFT_CHANGED_OR_UNVERIFIED: "계산 중 기존 Draft가 바뀌었거나 전체 품목을 고정하지 못해 재생성을 차단했습니다.",
  REPLACEMENT_DRAFT_COVERAGE_MISMATCH: "기존 Draft와 새 계산의 품목 대조 합계가 맞지 않아 재생성을 차단했습니다.",
  CANDIDATE_COVERAGE_MISMATCH: "전체 발주 후보 중 선정 또는 제외 사유로 설명되지 않은 품목이 있어 Draft 저장을 차단했습니다.",
  CURRENT_ENGINE_NOT_RECOMMENDED: "현재 판매·재고·미입고 계산에서는 발주 추천 대상이 아닙니다.",
  "UPSTREAM:claim-auxiliary": "클레임·배송 보조신호 연결이 남아 있어 실제 실행 판단으로 승격하지 않습니다.",
};
const sourcingReasonLabels: Record<string, string> = {
  SOURCING_CONTEXT_UNAVAILABLE: "소싱 월 예산·창고 원장을 읽지 못했습니다.",
  WAREHOUSE_GATE_NOT_READY: "실사 완료된 빈 창고 자리와 창고 정책 확인이 필요합니다.",
  MONTHLY_SPENDING_BASIS_REQUIRED: "이번 달 신규소싱에 사용할 총현금 기준이 아직 확정되지 않았습니다.",
  STALE_MONTHLY_SPENDING_BASIS: "소싱 예산 기준월이 이번 발주월과 다릅니다.",
  SOURCING_PERCENT_ABOVE_POLICY_MAX: "입력한 소싱 비율이 현재 소싱 안전상한보다 큽니다.",
  SOURCING_PERCENT_POLICY_MISMATCH: "화면의 소싱 비율과 창고 소싱 정책 비율이 다릅니다.",
  SOURCING_BUDGET_MISMATCH: "계산한 20% 금액과 창고 소싱 월 한도가 일치하지 않습니다.",
  SOURCING_BUDGET_ALREADY_EXCEEDED: "이미 예약된 신규상품 금액이 이번 소싱 예산보다 큽니다.",
  SOURCING_STORAGE_SIZE_REQUIRED: "선정된 신규상품이 소형 수납인지 대형 수납인지 선택해야 합니다.",
  NO_TEST_READY_CANDIDATE: "모든 품질·원가·공급 근거를 통과한 TEST_READY 후보가 없습니다.",
};
const sourcingExclusionLabels: Record<string, string> = {
  ALREADY_CONFIRMED: "이미 소싱 생명주기에 등록됨",
  TEST_PLAN_NOT_READY: "TEST_READY 조건 미충족",
  COST_OR_MOQ_INVALID: "원가·MOQ·테스트수량 근거 부족",
  MONTHLY_ITEM_CAP_REACHED: "월 신규품목 상한 도달",
  BUDGET_BELOW_MOQ: "남은 예산으로 MOQ 충족 불가",
};
const sourcingPolicyPreparationCodes = new Set([
  "MONTHLY_SPENDING_BASIS_REQUIRED",
  "STALE_MONTHLY_SPENDING_BASIS",
  "SOURCING_PERCENT_POLICY_MISMATCH",
  "SOURCING_BUDGET_MISMATCH",
]);
const explain = (code: string) => reasonLabels[code] ?? `상위 검증에서 남은 조건: ${code}`;
const costBasisLabel = (row: PurchaseCyclePreflightReport["selected"][number]) => {
  if (row.costBasis === "VERIFIED_PURCHASE_COST") return "확정원가";
  if (row.costBasis === "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE") return `도매 판매가 추정 ${money(row.estimatedUnitCostKrw)}/개`;
  if (row.costBasis === "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE") {
    return `유사상품 ${row.costReferenceModelNo ?? "미확인"} 참고 추정 ${money(row.estimatedUnitCostKrw)}/개`;
  }
  return `사용자 제공 추정 ${money(row.estimatedUnitCostKrw)}/개`;
};

export default async function PurchaseCyclePreflightPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const single = (key: string, fallback: string) => typeof query[key] === "string" ? query[key] : fallback;
  const todaySeoul = seoulCalendarDate();
  const targetDate = single("date", todaySeoul);
  const cash = single("cash", "");
  const cashLimitKrw = cash === "" ? null : Number(cash);
  const sourcing = single("sourcing", "0");
  const sourcingBudgetPercent = sourcing === "" ? 0 : Number(sourcing);
  const preferredSourcingConceptIds = (Array.isArray(query.source)
    ? query.source
    : typeof query.source === "string"
      ? [query.source]
      : [])
    .map((value) => value.trim())
    .filter(Boolean);
  const sourcingStorageSizeByConceptId: Record<string, "S" | "L"> = {};
  let sourcingStorageInputInvalid = false;
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("storage.")) continue;
    const conceptId = key.slice("storage.".length).trim();
    const size = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!conceptId || conceptId.length > 120 || (size !== "S" && size !== "L")) {
      sourcingStorageInputInvalid = true;
      continue;
    }
    sourcingStorageSizeByConceptId[conceptId] = size;
  }
  if (Object.keys(sourcingStorageSizeByConceptId).length > 20) sourcingStorageInputInvalid = true;
  const early = single("early", "") === "1";
  const replaceDraftId = single("replace", "") || null;
  let report: PurchaseCyclePreflightReport | null = null;
  let sourcingPlan: SourcingBudgetPlan | null = null;
  let sourcingPlanError = "";
  let inputError = "";
  // Opening a card or link never starts the expensive data reads. Only an
  // explicit read-only form submission does. No polling, cron or write action.
  if (query.check === "1") {
    try {
      if (["date", "cash", "sourcing", "early", "check", "replace"].some(key => Array.isArray(query[key]))) throw new Error("DUPLICATE_INPUT");
      if ((cash !== "" && !/^\d+$/.test(cash)) || (sourcing !== "" && !/^\d+$/.test(sourcing))) throw new Error("NUMERIC_INPUT_INVALID");
      if (preferredSourcingConceptIds.length > 20 || new Set(preferredSourcingConceptIds).size !== preferredSourcingConceptIds.length) throw new Error("SOURCING_SELECTION_INVALID");
      if (sourcingStorageInputInvalid) throw new Error("SOURCING_STORAGE_SELECTION_INVALID");
      const options = { targetDate, cashLimitKrw, sourcingBudgetPercent, maxSkus: ENGINE_MAX_SKUS, maxUnitsPerSku: ENGINE_MAX_UNITS_PER_SKU, allowOpenBudgetPreview: early, replaceDraftId };
      validatePurchasePreflightOptions(options);
      report = await loadPurchaseCyclePreflight(options);
      if (report.sourcingBudgetPercent > 0) {
        try {
          sourcingPlan = await loadSourcingBudgetPlan({
            targetCycleMonth: report.targetCycleMonth,
            totalCashKrw: report.effectiveCashKrw,
            sourcingBudgetPercent: report.sourcingBudgetPercent,
            sourcingBudgetKrw: report.sourcingBudgetKrw,
            preferredConceptIds: preferredSourcingConceptIds,
            storageSizeByConceptId: sourcingStorageSizeByConceptId,
          });
        } catch (error) {
          const raw = error instanceof Error ? error.message : "SOURCING_BUDGET_PLAN_FAILED";
          sourcingPlanError = `신규상품 소싱 후보 계산을 읽지 못했습니다: ${raw.split(":", 1)[0]}`;
        }
      }
    } catch {
      inputError = "점검을 완료하지 못했습니다. 날짜·정수 금액·0~100% 소싱 비율을 확인하세요. 입력이 맞다면 자료를 다시 조회하세요.";
    }
  }
  const sourcingEnabled = Boolean(report && report.sourcingBudgetPercent > 0);
  const sourcingReady = !sourcingEnabled || sourcingPlan?.readyForConfirmation === true;
  const draftReady = Boolean(report && report.previewReady && report.blockers.length === 0 && sourcingReady);
  const sourcingPreparationCodes = sourcingPlan?.policy.operatorAllocationSupported && sourcingPlan.policy.version !== null
    ? sourcingPlan.blockers.filter(code => sourcingPolicyPreparationCodes.has(code))
    : [];
  const sourcingBlockingCodes = sourcingPlan?.blockers.filter(code => !sourcingPreparationCodes.includes(code)) ?? [];
  const actionItems: Array<{ title: string; message: string; href?: string; hrefLabel?: string }> = [];
  if (report?.blockers.length) {
    actionItems.push({
      title: "최신 판매·재고 자료 준비",
      message: `시스템 원본 검증 ${report.blockers.length}건이 만료됐거나 아직 준비되지 않았습니다. 실제 주문은 진행되지 않았으며 최신자료가 준비된 뒤 다시 계산하면 됩니다.`,
      href: "/stage8-sales-events",
      hrefLabel: "최신자료 상태 보기",
    });
  }
  if (sourcingPlanError) {
    actionItems.push({
      title: "소싱엔진 연결 다시 확인",
      message: "소싱엔진 연동 설정을 확인하지 못했습니다. 연결 상태를 점검한 뒤 다시 계산하세요.",
      href: "/sourcing-center",
      hrefLabel: "소싱센터 상태 보기",
    });
  }
  if (sourcingBlockingCodes.includes("WAREHOUSE_GATE_NOT_READY")) {
    actionItems.push({
      title: "창고 빈자리 확인",
      message: "신규상품을 둘 소형·대형 빈자리가 실사 완료 상태인지 확인해야 합니다.",
      href: "/sourcing-center",
      hrefLabel: "창고·소싱 상태 보기",
    });
  }
  if (sourcingBlockingCodes.includes("SOURCING_PERCENT_ABOVE_POLICY_MAX")) {
    const maximum = sourcingPlan?.policy.maximumPercent;
    actionItems.push({
      title: "신규소싱 비율 안전상한 확인",
      message: maximum === null || maximum === undefined
        ? "입력한 신규소싱 비율이 현재 안전상한을 넘었습니다. 상한을 확인한 뒤 다시 계산하세요."
        : `입력한 ${report?.sourcingBudgetPercent ?? sourcingBudgetPercent}%를 현재 안전상한 ${maximum}% 이하로 조정해 다시 계산하세요.`,
    });
  }
  if (sourcingBlockingCodes.includes("SOURCING_STORAGE_SIZE_REQUIRED")) {
    actionItems.push({
      title: "신규상품 수납 위치 선택",
      message: "신규상품 구성 단계에서 모든 후보의 소형 또는 대형 수납을 고른 뒤 하단의 ‘신규상품 구성 완료 · 발주안 한 번 계산’을 누르세요.",
      href: "#sourcing-selection",
      hrefLabel: "수납 선택으로 이동",
    });
  }
  if (sourcingBlockingCodes.includes("NO_TEST_READY_CANDIDATE")) {
    actionItems.push({
      title: "발주 가능한 신규상품 추가",
      message: "현재 품질·원가·공급 검증을 모두 통과한 후보가 없습니다. 신규상품 구성 단계에서 1688 링크를 직접 등록할 수 있습니다.",
      href: "#manual-sourcing-intake",
      hrefLabel: "신규상품 직접 추가",
    });
  }
  const handledSourcingCodes = new Set([
    "WAREHOUSE_GATE_NOT_READY",
    "SOURCING_PERCENT_ABOVE_POLICY_MAX",
    "SOURCING_STORAGE_SIZE_REQUIRED",
    "NO_TEST_READY_CANDIDATE",
  ]);
  const remainingSourcingCodes = sourcingBlockingCodes.filter(code => !handledSourcingCodes.has(code));
  if (remainingSourcingCodes.length) {
    actionItems.push({
      title: "소싱 안전조건 확인",
      message: remainingSourcingCodes.map(code => sourcingReasonLabels[code] ?? code).join(" "),
      href: "/sourcing-center",
      hrefLabel: "소싱센터에서 확인",
    });
  }
  const technicalIssues = report
    ? [
        ...report.blockers.map(explain),
        ...(sourcingPlanError ? [sourcingPlanError] : []),
        ...sourcingBlockingCodes.map(code => sourcingReasonLabels[code] ?? code),
      ]
    : [];
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="COMMERCE OS · PURCHASE PREFLIGHT" title="다음 발주 준비"
        description="사용할 현금과 신규상품 비율을 정하면 기존상품 재발주와 신규소싱 예산을 한 번에 계산합니다."
        actions={<Link prefetch={false} href="/fast-purchase-mvp" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">기존 빠른 발주안</Link>} />
      <section className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        <strong>이 화면은 계산과 내부 Draft 준비까지만 합니다.</strong>
        <span className="ml-2">자동 주문·결제는 없으며, 실제 발주는 별도 확인 뒤 진행합니다.</span>
      </section>
      <section aria-labelledby="preflight-input-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black text-blue-700">1단계</p>
            <h2 id="preflight-input-title" className="mt-1 text-xl font-black text-slate-950">예산 기준 입력</h2>
          </div>
          <p className="text-xs font-medium text-slate-500">필수 입력은 발주일뿐입니다. 현금을 비우면 전월 매출원가 예산을 사용합니다.</p>
        </div>
        <PurchasePreflightForm>
          <input type="hidden" name="check" value="1" />
          {replaceDraftId ? <input type="hidden" name="replace" value={replaceDraftId} /> : null}
          <label className="text-sm font-bold text-slate-900">발주 예정일<input className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" name="date" type="date" defaultValue={targetDate} required /><span className="mt-1 block text-xs font-normal text-slate-500">판매·재고를 계산할 기준일</span></label>
          <label className="text-sm font-bold text-slate-900">이번 발주에 쓸 총 현금<input className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" name="cash" type="number" min="1" step="1" inputMode="numeric" defaultValue={cash} placeholder="비우면 자동 예산" /><span className="mt-1 block text-xs font-normal text-slate-500">상품대금과 배송비·수수료까지 포함</span></label>
          <label className="text-sm font-bold text-slate-900">신규상품 소싱 예산 비율<input className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" name="sourcing" type="number" min="0" max="100" step="1" inputMode="numeric" defaultValue={sourcing} /><span className="mt-1 block text-xs font-normal text-slate-500">총현금에서 먼저 분리 · 0~100%</span></label>
          <div className="border-t border-slate-100 pt-3 md:col-span-2 xl:col-span-3">
            <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
              <input className="size-4" name="early" type="checkbox" value="1" defaultChecked={early} />
              전월 마감 전 임시 계산
            </label>
            <p className="ml-7 text-xs leading-5 text-slate-500">
              다음 달 발주를 전월이 끝나기 전에 미리 검토할 때만 사용합니다. 임시 매출로 계산되므로 Draft를 확정할 수 없고, 월 마감 후 반드시 다시 계산해야 합니다. 평소에는 체크하지 마세요.
            </p>
          </div>
          <p className="text-xs leading-5 text-slate-600 md:col-span-2 xl:col-span-3">입력한 현금이 있으면 그 금액을 우선 사용합니다. 신규상품 소싱 예산을 먼저 분리하고, 나머지로 기존상품 수량을 우선순위에 따라 계산합니다. 현금이 충분해도 엔진 권장수량을 초과하지 않습니다.</p>
        </PurchasePreflightForm>
      </section>
      <section id="new-product-configuration" className="scroll-mt-5 border-y border-slate-200 bg-white py-5" aria-labelledby="new-product-configuration-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black text-emerald-700">2단계</p>
            <h2 id="new-product-configuration-title" className="mt-1 text-xl font-black text-slate-950">신규상품 구성</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">소싱엔진 후보를 고르거나 1688 링크를 직접 등록하세요. 두 경로 모두 같은 검증을 거쳐 월간 Draft에 합류합니다.</p>
          </div>
          <p className="text-xs font-bold text-slate-500">신규상품 비율이 0%면 이 단계는 건너뜁니다.</p>
        </div>

        <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-2">
          <article id="sourcing-selection" className="min-w-0 scroll-mt-5 py-5">
            <p className="text-xs font-black text-blue-700">소싱엔진에서 선택</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">검증된 후보를 이번 발주에 추가</h3>
            {!report ? (
              <p className="mt-3 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-950">위에서 예산을 계산하면 현재 비율과 금액에 맞는 소싱 후보가 여기에 표시됩니다.</p>
            ) : report.sourcingBudgetPercent === 0 ? (
              <p className="mt-3 border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">신규상품 소싱 비율이 0%입니다. 후보를 추가하려면 비율을 입력하고 다시 계산하세요.</p>
            ) : (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">분리 예산 {money(report.sourcingBudgetKrw)}{sourcingPlan ? ` · 현재 ${sourcingPlan.allocation.selected.length}종 · 예상 상품대금 ${money(sourcingPlan.allocation.estimatedSpendKrw)}` : ""}</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">후보를 체크하고 수납 위치를 정하세요. 수동 후보까지 모두 추가한 뒤 두 영역 아래의 계산 버튼을 한 번만 누릅니다.</p>
                {sourcingPlanError ? <p role="alert" className="mt-3 break-all border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-950">{sourcingPlanError}</p> : null}
                {sourcingPreparationCodes.length ? <p className="mt-3 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-950">예산 정책 {sourcingPreparationCodes.length}건은 저장 시 자동 준비됩니다.</p> : null}
                {sourcingBlockingCodes.length ? <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">최종 저장 전 소싱 안전조건 {sourcingBlockingCodes.length}개가 남았습니다.</p> : null}
                {sourcingPlan?.readyForConfirmation ? <p className="mt-3 text-sm font-bold text-emerald-800">신규상품 코드 배정과 월간 Draft 추가 준비가 끝났습니다.</p> : null}
                {sourcingPlan ? <>
                  <details className="mt-4 text-sm"><summary className="cursor-pointer font-bold text-emerald-800">선정 후보 {sourcingPlan.allocation.selected.length}종 상세 보기</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-2">후보 상품</th><th className="p-2">품질</th><th className="p-2">배정</th><th className="p-2">MOQ / 최대 / 수량</th><th className="p-2">예상금액</th></tr></thead><tbody>{sourcingPlan.allocation.selected.map(row => <tr key={row.conceptId} className="border-t"><td className="p-2">{row.canonicalNameKo}</td><td className="p-2">{row.finalQualityScore ?? "미확인"}</td><td className="p-2">{row.tier === "CORE" ? "핵심" : row.tier === "SUPPORT" ? "안정" : "최소 테스트"}</td><td className="p-2">{row.moq} / {row.recommendedUnits} / <strong>{row.quantity}</strong></td><td className="p-2">{money(row.estimatedCostKrw)}</td></tr>)}</tbody></table></div>{!sourcingPlan.allocation.selected.length ? <p className="mt-3">현재 예산과 안전조건 안에서 선택할 TEST_READY 신규상품이 없습니다.</p> : null}</details>
                  <details className="mt-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">제외 후보 {sourcingPlan.allocation.excluded.length}종 확인</summary>{sourcingPlan.allocation.excluded.slice(0, 100).map(row => <p key={`${row.conceptId}:${row.reason}`} className="mt-2">{row.canonicalNameKo} · {sourcingExclusionLabels[row.reason] ?? row.reason}</p>)}</details>
                  <SourcingCandidateSelectionForm
                    formId={NEW_PRODUCT_CONFIGURATION_FORM_ID}
                    targetDate={report.targetDate}
                    cash={cash}
                    sourcingBudgetPercent={report.sourcingBudgetPercent}
                    early={early}
                    replaceDraftId={replaceDraftId}
                    selectedCandidates={sourcingPlan.allocation.selected}
                    availableCandidates={sourcingPlan.allocation.availableCandidates}
                    preferredConceptIds={preferredSourcingConceptIds}
                    initialStorageSizeByConceptId={sourcingStorageSizeByConceptId}
                  />
                </> : null}
              </>
            )}
          </article>

          <section id="manual-sourcing-intake" className="min-w-0 scroll-mt-5" aria-label="신규상품 직접 추가">
            <ManualProductIntakeForm
              embedded
              formId={MANUAL_PRODUCT_FORM_ID}
              calculationFormId={sourcingPlan ? NEW_PRODUCT_CONFIGURATION_FORM_ID : undefined}
              knownCandidateIds={sourcingPlan ? [
                ...sourcingPlan.allocation.selected.map((candidate) => candidate.conceptId),
                ...sourcingPlan.allocation.availableCandidates.map((candidate) => candidate.conceptId),
              ] : []}
            />
          </section>
        </div>
        {report && sourcingPlan ? <NewProductConfigurationCalculateButton formId={NEW_PRODUCT_CONFIGURATION_FORM_ID} manualFormId={MANUAL_PRODUCT_FORM_ID} /> : null}
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">어느 경로를 사용하든 Draft 저장과 B코드 배정이 끝나면 상품출시 진행관리에는 ‘입고 대기’로 생성됩니다. 실제 입고 전에는 입고완료로 표시하지 않습니다.</p>
      </section>
      {inputError ? <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm">{inputError}</p> : null}
      {!report ? <section className="border-y border-slate-200 py-8 text-center"><p className="text-sm font-bold text-slate-700">아직 준비 전입니다.</p><p className="mt-1 text-xs text-slate-500">위 기준을 확인한 뒤 예산과 후보를 불러오세요.</p></section> : <>
        <section aria-labelledby="preflight-result-title" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <section className={`border-l-4 px-5 py-4 ${draftReady ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>
                <p className={`text-xs font-black ${draftReady ? "text-emerald-800" : "text-amber-800"}`}>3단계 · 계산 결과</p>
                <h2 id="preflight-result-title" className="mt-1 text-xl font-black text-slate-950">
                  {draftReady ? "발주안 계산이 끝났습니다" : "계산은 끝났지만 확인할 내용이 있습니다"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {draftReady
                    ? "기존상품과 신규상품 후보를 검토한 뒤 내부 월간 Draft로 저장할 수 있습니다."
                    : "사용자가 할 일과 시스템이 준비할 일을 아래에서 나눠 보여드립니다. 안전조건이 끝날 때까지 Draft 저장만 잠깁니다."}
                </p>
                <p className="mt-2 text-xs text-slate-500">조회 {new Date(report.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 목표 {report.targetCycleMonth} · 판매 분석 {report.sourceAnalysisAsOf ?? "미확인"}</p>
              </section>

              <section className="border-y border-slate-200 bg-white py-5">
                <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                  <div><p className="text-xs font-black text-blue-700">예산 배분</p><h3 className="mt-1 text-lg font-black text-slate-950">총현금이 이렇게 나뉩니다</h3></div>
                  <p className="text-xs text-slate-500">{report.cashLimitKrw === null ? "전월 매출원가 자동 예산" : "입력한 현금 우선 적용"}</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryMetric label="이번 발주 총현금" value={money(report.effectiveCashKrw)} tone="blue" />
                  <SummaryMetric label={`신규상품 소싱 ${report.sourcingBudgetPercent}%`} value={money(report.sourcingBudgetKrw)} tone="emerald" />
                  <SummaryMetric label="기존상품 가용 현금" value={money(report.reorderCashKrw)} tone="slate" />
                  <SummaryMetric label="기존상품 상품대금 상한" value={money(report.effectiveBudgetKrw)} tone="amber" />
                </div>
                <div className="mt-4 flex h-3 overflow-hidden rounded-sm bg-slate-200" aria-label={`신규상품 ${report.sourcingBudgetPercent}%, 기존상품 ${100 - report.sourcingBudgetPercent}%`}>
                  {report.sourcingBudgetPercent > 0 ? <span className="bg-emerald-500" style={{ width: `${report.sourcingBudgetPercent}%` }} /> : null}
                  <span className="bg-blue-600" style={{ width: `${100 - report.sourcingBudgetPercent}%` }} />
                </div>
                <div className="mt-2 flex justify-between gap-4 text-xs font-bold text-slate-600"><span>신규소싱 {report.sourcingBudgetPercent}%</span><span>기존상품 {100 - report.sourcingBudgetPercent}%</span></div>
              </section>

              <section className="border-y border-slate-200 bg-white py-5">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-xs font-black text-amber-700">지금 확인할 내용</p><h3 className="mt-1 text-lg font-black text-slate-950">{actionItems.length ? `${actionItems.length}단계만 확인하면 됩니다` : "저장 전 필수 조건을 모두 확인했습니다"}</h3></div>
                  <span className={`size-3 shrink-0 rounded-full ${actionItems.length ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden="true" />
                </div>
                {sourcingPreparationCodes.length ? <p className="mt-4 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sm font-bold leading-6 text-sky-950">월·비율·예산 기준 {sourcingPreparationCodes.length}건은 Draft 저장 과정에서 시스템이 자동 확정합니다. 오류나 사용자 할 일로 세지 않습니다.</p> : null}
                {actionItems.length ? (
                  <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                    {actionItems.map((item, index) => <li key={`${item.title}:${index}`} className="min-w-0 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm leading-6">
                      <div className="flex min-w-0 gap-3"><span className="font-black text-amber-700">{index + 1}</span><div className="min-w-0"><strong className="text-slate-950">{item.title}</strong><p className="mt-1 break-words text-slate-700">{item.message}</p>{item.href ? <Link prefetch={false} href={item.href} className="mt-2 inline-block font-black text-blue-700 underline">{item.hrefLabel}</Link> : null}</div></div>
                    </li>)}
                  </ol>
                ) : <p className="mt-4 text-sm leading-6 text-emerald-800">품목과 금액을 검토한 뒤 아래에서 월간 Draft를 저장하세요.</p>}
                {technicalIssues.length ? <details className="mt-4 min-w-0 border-t border-slate-100 pt-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">기술 검증 내역 {technicalIssues.length}건 보기</summary>{technicalIssues.map((message, index) => <p key={`${index}:${message}`} className="mt-2 break-all pl-4 text-slate-600">{message}</p>)}</details> : null}
              </section>
            </div>

            <aside className="self-start rounded-lg border border-slate-800 bg-slate-950 p-5 text-white shadow-sm xl:sticky xl:top-5">
              <p className="text-xs font-black text-cyan-300">PURCHASE FLOW</p>
              <h2 className="mt-1 text-xl font-black">발주 준비 단계</h2>
              <div className="mt-5 space-y-3">
                <PreflightFlowStep number="1" title="예산 기준 입력" state="done" detail={`${report.targetDate} · 신규소싱 ${report.sourcingBudgetPercent}%`} />
                <PreflightFlowStep number="2" title="신규상품 구성" state={!sourcingEnabled || sourcingReady ? "done" : "active"} detail={sourcingEnabled ? `엔진 후보 ${sourcingPlan?.allocation.selected.length ?? 0}종 · 직접입력 가능` : "신규소싱 0% · 건너뜀"} />
                <PreflightFlowStep number="3" title="발주안·안전조건 검토" state={draftReady ? "done" : actionItems.length ? "blocked" : "active"} detail={`기존상품 ${report.selected.length}종 · 확인 ${actionItems.length}단계`} />
                <PreflightFlowStep number="4" title="내부 Draft 저장" state={draftReady ? "active" : "wait"} detail={draftReady ? "검토 후 저장 가능" : "남은 조건 해결 후 가능"} />
              </div>
              <p className="mt-5 border-t border-slate-800 pt-4 text-xs leading-5 text-slate-400">Draft 저장은 미입고 약정과 코드만 기록합니다. 실제 1688 주문·결제는 별도입니다.</p>
            </aside>
          </div>

          {report.replacementDraftId ? (
            <section className="border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
              <strong>기존 Draft 재생성 점검</strong> · <span className="font-mono">{report.replacementDraftId}</span>의 RESERVED 수량을 제외하고 처음부터 다시 계산했습니다. 주문·입고가 시작됐으면 저장 단계에서 자동 중단합니다.
            </section>
          ) : null}

          {report.replacementAudit ? (
            <section className="border-y border-slate-200 bg-white py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-black text-sky-700">기존 Draft와 새 계산 전체 대조</p><h3 className="mt-1 text-lg font-black">추가 {report.replacementAudit.added.length}종 · 제거 {report.replacementAudit.removed.length}종 · 수량변경 {report.replacementAudit.quantityChanged.length}종</h3></div>
                <p className={`text-sm font-bold ${report.replacementAudit.complete ? "text-emerald-800" : "text-rose-700"}`}>{report.replacementAudit.complete ? "전체 대조 완료" : "대조 불일치 · 저장 차단"}</p>
              </div>
              <details className="mt-4 border-t border-slate-100 pt-3 text-sm">
                <summary className="cursor-pointer font-bold">변경되는 품목 자세히 보기</summary>
                <div className="mt-3 grid gap-5 lg:grid-cols-3">
                  <div><strong>새로 포함 {report.replacementAudit.added.length}종</strong>{report.replacementAudit.added.map(row => <p key={row.barcode} className="mt-2">{row.barcode} · {row.name || "상품명 미확인"} · {row.quantity}개</p>)}{!report.replacementAudit.added.length ? <p className="mt-2 text-slate-500">없음</p> : null}</div>
                  <div><strong>제거 {report.replacementAudit.removed.length}종</strong>{report.replacementAudit.removed.map(row => <p key={row.barcode} className="mt-2">{row.barcode} · {row.name || "상품명 미확인"} · 기존 {row.quantity}개 · {row.reasons.map(explain).join(" / ")}</p>)}{!report.replacementAudit.removed.length ? <p className="mt-2 text-slate-500">없음</p> : null}</div>
                  <div><strong>수량변경 {report.replacementAudit.quantityChanged.length}종</strong>{report.replacementAudit.quantityChanged.map(row => <p key={row.barcode} className="mt-2">{row.barcode} · {row.name || "상품명 미확인"} · {row.previousQuantity}개 → {row.selectedQuantity}개</p>)}{!report.replacementAudit.quantityChanged.length ? <p className="mt-2 text-slate-500">없음</p> : null}</div>
                </div>
              </details>
            </section>
          ) : null}

          <section className="min-w-0 border-y border-slate-200 bg-white">
            <article className="min-w-0 py-5">
              <p className="text-xs font-black text-blue-700">기존상품 재발주</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">{report.selected.length}종 · 총 {report.selected.reduce((sum, row) => sum + row.quantity, 0).toLocaleString("ko-KR")}개</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">상품대금 {money(report.estimatedSpendKrw)} · 배송비 여유분 포함 {money(report.estimatedAllInSpendKrw)}</p>
              <p className="mt-2 text-sm font-bold text-slate-800">현금 감축 {report.cashAdjustedCount}종 · 현금 한도 제외 {report.cashExcludedCount}종 · 원가 미확인 {report.missingCostCount}종</p>
              {!report.selected.length ? <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm">현재 확정 가능한 품목이 없습니다. 재고를 0으로 가정하거나 차단을 우회하지 않습니다.</p> : null}
              <details className="mt-4 min-w-0 text-sm">
                <summary className="cursor-pointer font-bold text-blue-800">선정 품목 {report.selected.length}종 보기</summary>
                <div className="mt-3 max-w-full overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-2">B코드·모델·상품</th><th className="p-2">우선순위</th><th className="p-2">권장 → 현금반영</th><th className="p-2">예상금액</th><th className="p-2">원가 근거</th><th className="p-2">계획재고</th><th className="p-2">미입고</th></tr></thead><tbody>{report.selected.map(row => <tr key={row.barcode} className="border-t"><td className="p-2">{row.barcode}{row.costModelNo ? ` · ${row.costModelNo}` : ""} · {row.name}</td><td className="p-2">{row.cashflowTier === "CORE" ? "핵심" : row.cashflowTier === "SUPPORT" ? "안정" : row.cashflowTier === "CANARY" ? "최소" : "자동"} · {row.priorityScore}점</td><td className="p-2 font-bold">{row.originalRecommendedQuantity} → {row.quantity}{row.cashAdjusted ? " (감축)" : ""}</td><td className="p-2">{money(row.estimatedCostKrw)}</td><td className="p-2">{costBasisLabel(row)}</td><td className="p-2">{row.inventoryQuantity} · {row.inventoryMode === "VERIFIED" ? "확인" : "추정"}</td><td className="p-2">{row.openCommitment}</td></tr>)}</tbody></table></div>
              </details>
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">제외 품목 {report.excluded.length}개 확인</summary>{report.excluded.slice(0, 100).map(row => <p key={row.barcode} className="mt-2">{row.barcode} · {row.reasons.map(explain).join(" / ")}</p>)}{report.excluded.length > 100 ? <p className="mt-2">앞의 100개를 표시했습니다. 상세 검증 화면에서 전체 자료를 확인하세요.</p> : null}</details>
            </article>
          </section>

          <PurchaseCycleDraftActions
            targetDate={report.targetDate}
            targetCycleMonth={report.targetCycleMonth}
            cashLimitKrw={report.cashLimitKrw}
            sourcingBudgetPercent={report.sourcingBudgetPercent}
            sourcingBudgetKrw={report.sourcingBudgetKrw}
            preferredSourcingConceptIds={preferredSourcingConceptIds}
            sourcingStorageSizeByConceptId={sourcingStorageSizeByConceptId}
            allowOpenBudgetPreview={early}
            expectedSourceFingerprint={report.sourceFingerprint}
            expectedPlanFingerprint={report.planFingerprint}
            expectedSourcingSourceFingerprint={sourcingPlan?.sourceFingerprint ?? null}
            expectedSourcingPlanFingerprint={sourcingPlan?.planFingerprint ?? null}
            sourcingSelectedCount={sourcingPlan?.allocation.selected.length ?? 0}
            sourcingEstimatedSpendKrw={sourcingPlan?.allocation.estimatedSpendKrw ?? 0}
            confirmation={draftReady ? purchaseCycleDraftConfirmation(report, sourcingPlan) : ""}
            selectedCount={report.selected.length}
            totalQuantity={report.selected.reduce((sum, row) => sum + row.quantity, 0)}
            estimatedSpendKrw={report.estimatedSpendKrw}
            ready={draftReady}
            replaceDraftId={report.replacementDraftId}
            replacementAddedCount={report.replacementAudit?.added.length ?? 0}
            replacementRemovedCount={report.replacementAudit?.removed.length ?? 0}
            replacementChangedCount={report.replacementAudit?.quantityChanged.length ?? 0}
          />

          <details className="border-y border-slate-200 bg-white py-4 text-sm">
            <summary className="cursor-pointer font-black text-slate-900">상세 검증 내역 보기</summary>
            <div className="mt-4 space-y-6 border-t border-slate-100 pt-4">
              <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><caption className="mb-3 text-left font-black">구간별 실제 근거 상태</caption><thead className="bg-slate-50"><tr><th className="p-2">구간</th><th className="p-2">상태</th><th className="p-2">확인 내용</th></tr></thead><tbody>{report.stages.map(row => <tr key={row.number} className="border-t"><td className="p-2 font-bold"><Link prefetch={false} href={row.href} className="underline">{row.number}. {row.label}</Link></td><td className="whitespace-nowrap p-2">{statusLabels[row.state]}</td><td className="p-2 leading-6">{row.message}</td></tr>)}</tbody></table></div>
              <div className="grid gap-6 md:grid-cols-2">
                <div><h3 className="font-black">자료·예산 차단 사유</h3>{report.blockers.length ? report.blockers.map(code => <p key={code} className="mt-2 leading-6">{explain(code)}</p>) : <p className="mt-2 text-emerald-800">미리보기 계산 조건을 확인했습니다.</p>}</div>
                <div><h3 className="font-black">실제 승인 전 남은 조건</h3>{report.reviewBlockers.map(code => <p key={code} className="mt-2 leading-6">{explain(code)}</p>)}<p className="mt-2 leading-6">{report.comparisonMessage}</p></div>
              </div>
              <div><h3 className="font-black">전체 발주 미리보기 · 주문서 아님</h3><p className="mt-2 leading-6">전월 판매원가 자동 총한도 {report.automaticGrossBudgetKrw === null ? "미확인" : money(report.automaticGrossBudgetKrw)} · 운영자 입력 총현금 {report.cashLimitKrw === null ? "입력 없음" : money(report.cashLimitKrw)} · 이번 달 기록된 발주 지출 {report.recordedCycleSpendKrw === null ? "미확인" : money(report.recordedCycleSpendKrw)}</p><p className="mt-2 leading-6">전체 후보 {report.candidateCount}종 · 선정·제외로 설명된 후보 {report.accountedCandidateCount}종 · {report.candidateCoverageComplete ? "누락 없음" : "설명되지 않은 누락 있음"} · 도매 판매가 추정 {report.wholesaleEstimatedSelectedCount}종 · 사용자 제공 추정 {report.ownerEstimatedSelectedCount}종</p></div>
              {sourcingPlan ? <div><h3 className="font-black">소싱 정책 근거</h3><p className="mt-2 leading-6">현재 창고 정책 {sourcingPlan.policy.configuredPercent ?? "미확인"}% · 안전상한 {sourcingPlan.policy.maximumPercent ?? "미확인"}% · 월 기준 {sourcingPlan.policy.confirmed ? "확정" : "미확정"} · {sourcingPlan.warehouse.message}</p></div> : null}
            </div>
          </details>

          <details className="border-y border-slate-200 bg-white py-4 text-xs"><summary className="cursor-pointer font-bold">채팅 인계·원본 추적 지문</summary><p className="mt-3 break-all">후보 요청 {report.candidateRequestId ?? "없음"}</p><p className="mt-2 break-all">원본 {report.sourceFingerprint}</p><p className="mt-2 break-all">발주 미리보기 {report.planFingerprint}</p><p className="mt-3">같은 화면·지문이라도 승인 토큰이 아닙니다. 데이터·예산·수량 제한이 바뀌면 다시 점검합니다.</p></details>
        </section>
      </>}
    </div>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone: "blue" | "emerald" | "amber" | "slate" }) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    slate: "border-slate-200 bg-slate-50",
  }[tone];
  return (
    <article className={`min-w-0 rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <strong className="mt-1 block break-words text-lg font-black text-slate-950">{value}</strong>
    </article>
  );
}

function PreflightFlowStep({ number, title, state, detail }: {
  number: string;
  title: string;
  state: "done" | "active" | "wait" | "blocked";
  detail: string;
}) {
  const marker = state === "done"
    ? "bg-emerald-400 text-emerald-950"
    : state === "active"
      ? "bg-cyan-300 text-cyan-950"
      : state === "blocked"
        ? "bg-amber-300 text-amber-950"
        : "bg-slate-700 text-slate-300";
  const border = state === "done"
    ? "border-emerald-900/60"
    : state === "active"
      ? "border-cyan-800/70"
      : state === "blocked"
        ? "border-amber-800/70"
        : "border-slate-800";
  const stateLabel = state === "done" ? "완료" : state === "active" ? "현재" : state === "blocked" ? "확인 필요" : "대기";
  return (
    <div className={`flex gap-3 rounded-lg border bg-slate-900 p-3 ${border}`}>
      <span className={`grid size-8 shrink-0 place-items-center rounded-md text-sm font-black ${marker}`}>{number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{title}</strong><span className="text-[11px] font-bold text-slate-400">{stateLabel}</span></div>
        <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
      </div>
    </div>
  );
}
