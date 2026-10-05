import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";
import { ManualProductIntakeForm } from "@/components/sourcing-center/ManualProductIntakeForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCING_ENGINE_BASE = (
  process.env.SOURCING_ENGINE_PUBLIC_URL ??
  "https://commerce-os-sourcing-engine-indol.vercel.app"
).replace(/\/+$/, "");

type PipelineStatus = {
  totalCandidates: number;
  activeCandidates: number;
  terminalRejectedCandidates: number;
  nextAction: string;
  nextActionLabel: string;
  nextHref: string;
  reason: string;
  operatorMode?: string;
  operatorActionRequired?: boolean;
  operatorActionLabel?: string;
  afterAction?: string;
  automaticContinuation?: boolean;
  cyclePolicy?: string;
  cycleNote?: string;
  funnel?: {
    confirmedOpportunityCandidates: number;
    supplyAnchorResolvedCandidates: number;
    complexityRejectedCandidates: number;
    supplyPendingCandidates: number;
    decisionCandidates: number;
  } | null;
};

type SourcingStage = {
  step: number;
  group: "후보 찾기" | "한국 수요" | "중국 공급" | "돈 계산" | "최종 시험";
  title: string;
  description: string;
  path: string;
  action: string;
};

const stages: readonly SourcingStage[] = [
  {
    step: 1,
    group: "후보 찾기",
    title: "1688 수집 준비",
    description: "1688 화면에서 상품 후보를 가져올 수집 버튼·확장기능을 준비합니다.",
    path: "/collector-setup",
    action: "수집 준비 열기",
  },
  {
    step: 2,
    group: "후보 찾기",
    title: "후보 수집·저장",
    description: "1688에서 보이는 후보를 모으고 정상인지 확인한 뒤 저장합니다.",
    path: "/extension-preview",
    action: "후보 수집 화면 열기",
  },
  {
    step: 3,
    group: "후보 찾기",
    title: "AI가 상품 뜻 정리",
    description: "중국 상품명을 읽고 한국에서 이해할 수 있는 상품 개념으로 정리합니다.",
    path: "/candidate-processing",
    action: "AI 분석 상태 보기",
  },
  {
    step: 4,
    group: "한국 수요",
    title: "한국 검색수요 확인",
    description: "네이버에서 실제로 사람들이 검색하는 상품인지 확인합니다.",
    path: "/naver-validation",
    action: "검색수요 보기",
  },
  {
    step: 5,
    group: "한국 수요",
    title: "쇼핑 클릭수요 확인",
    description: "검색만 하는지, 실제 쇼핑 상품을 눌러보는 관심도 있는지 확인합니다.",
    path: "/shopping-insight",
    action: "쇼핑수요 보기",
  },
  {
    step: 6,
    group: "한국 수요",
    title: "시장성 점수 보기",
    description: "검색량과 성장세를 합쳐 한국 시장에서 해볼 만한 후보인지 점수화합니다.",
    path: "/market-demand-score",
    action: "시장성 점수 보기",
  },
  {
    step: 7,
    group: "중국 공급",
    title: "1688 공급상태 확인",
    description: "가격·최소수량·공급자 정보가 실제 공급 판단에 쓸 수 있는 수준인지 봅니다.",
    path: "/supply-evidence-1688",
    action: "공급상태 보기",
  },
  {
    step: 8,
    group: "중국 공급",
    title: "실제 공급상품 고르기",
    description: "비슷한 상품 중 실제로 수입할 1688 상품을 고릅니다. 옵션이 지나치게 복잡하면 여기서 제외합니다.",
    path: "/direct-offer-resolver",
    action: "공급상품 고르기",
  },
  {
    step: 9,
    group: "중국 공급",
    title: "정확한 옵션·단가 확인",
    description: "선택한 상품 안에서 실제로 살 옵션 한 개의 가격·MOQ·공급자를 확정합니다.",
    path: "/supply-fact-resolver",
    action: "정확한 옵션 확인",
  },
  {
    step: 10,
    group: "돈 계산",
    title: "수익이 남는지 계산",
    description: "중국 단가와 환율·부대비용을 넣어 한국에서 팔았을 때 목표 마진이 나오는지 봅니다.",
    path: "/profitability-plan",
    action: "수익성 계산 보기",
  },
  {
    step: 11,
    group: "돈 계산",
    title: "한국 판매가격과 비교",
    description: "우리가 팔아야 할 가격이 네이버 시장가격과 비교해 경쟁력이 있는지 확인합니다.",
    path: "/market-price-check",
    action: "시장가격 비교하기",
  },
  {
    step: 12,
    group: "최종 시험",
    title: "전체 통과상태 확인",
    description: "수요·공급·수익성·시장가격 중 어디에서 막혔는지 한 번에 확인합니다.",
    path: "/decision-readiness",
    action: "전체 통과상태 보기",
  },
  {
    step: 13,
    group: "최종 시험",
    title: "AI 상세페이지 2장 시험",
    description: "전체 상세페이지를 만들기 전에 대표 1장과 어려운 상세 1장만 만들어 상품 왜곡 위험을 검사합니다.",
    path: "/ai-detail-preflight",
    action: "AI 상세 시험 열기",
  },
  {
    step: 14,
    group: "최종 시험",
    title: "소액 테스트 발주 계획",
    description: "모든 관문을 통과한 상품만 최대 5만원·20개 범위의 테스트 수량을 계산합니다.",
    path: "/test-order-plan",
    action: "테스트 발주 계획 보기",
  },
] as const;

const quickFlow = [
  "많이 모으기",
  "한국에서 찾는지",
  "중국에서 제대로 살 수 있는지",
  "돈이 남는지",
  "상세페이지가 안전한지",
  "조금만 테스트",
] as const;

const helperPages = [
  {
    title: "AI 분석 결과 품질검수",
    description: "AI가 상품을 잘못 이해했는지 샘플을 직접 확인합니다.",
    path: "/semantic-canary-review",
  },
  {
    title: "후보 직접확인 준비도",
    description: "저장 후보가 실제 상품 확인 단계까지 갈 수 있는지 점검합니다.",
    path: "/candidate-direct-check",
  },
  {
    title: "전체 후보 최종 상태",
    description: "각 후보가 통과·대기·탈락 중 어디에 있는지 자세히 봅니다.",
    path: "/decision-readiness",
  },
] as const;

function engineUrl(path: string) {
  return `${SOURCING_ENGINE_BASE}${path}`;
}

function easyNextAction(action: string, fallback: string) {
  if (action === "COLLECT_NEW_CANDIDATES") return "새 1688 후보를 모을 차례";
  if (action === "SUPPLY_VALIDATION") return "1688 실제 공급상품을 확인할 차례";
  if (action === "PROFITABILITY_CHECK") return "수익이 남는지 계산할 차례";
  if (action === "MARKET_VALIDATION") return "한국 판매가격을 비교할 차례";
  if (action === "AI_DETAIL_PREFLIGHT") return "AI 상세페이지 2장 시험을 할 차례";
  if (action === "AI_DETAIL_REVIEW") return "AI 상세페이지 시험 결과를 검토할 차례";
  if (action === "TEST_ORDER") return "소액 테스트 발주 계획을 볼 차례";
  if (action === "BUILD_REPEAT_EVIDENCE") return "반복 판매·공급 근거를 더 쌓을 차례";
  return fallback || "전체 상태를 확인할 차례";
}

function operatorModeKo(status: PipelineStatus) {
  if (status.operatorActionRequired === false) return "사람 개입 없음";
  if (status.operatorMode === "BROWSER_CAPTURE") return "브라우저 확인 1회";
  if (status.operatorMode === "HUMAN_REVIEW") return "사람 판단 필요";
  if (status.operatorMode === "TEST_DECISION") return "테스트 결정 필요";
  if (status.operatorMode === "SYSTEM_STEP") return "실행 1회";
  return "현재 단계 확인";
}

async function readPipelineStatus(): Promise<PipelineStatus | null> {
  try {
    const response = await fetch(`${SOURCING_ENGINE_BASE}/api/pipeline-status`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      status?: PipelineStatus;
    };
    return body.ok === true && body.status ? body.status : null;
  } catch {
    return null;
  }
}

export default async function SourcingCenterPage() {
  const status = await readPipelineStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        title="소싱센터"
        description="1688 후보 수집부터 한국 수요 확인, 실제 공급상품 선택, 수익성, 시장가격, AI 상세페이지 시험, 소액 테스트 발주까지 한 화면에서 순서대로 엽니다. 어려운 개발용어보다 ‘지금 무엇을 확인하는 단계인지’가 먼저 보이게 구성했습니다."
        actions={
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            OPS 전체 대시보드
          </Link>
        }
      />

      <ManualProductIntakeForm />

      <section className="rounded-2xl bg-slate-950 p-5 text-white shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">한 줄로 이해하기</p>
        <h2 className="mt-1 text-xl font-black">좋아 보이는 상품을 많이 모은 뒤, 위험한 상품을 관문마다 떨어뜨립니다.</h2>
        <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {quickFlow.map((label, index) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
              <p className="text-[10px] font-bold text-blue-300">{index + 1}</p>
              <p className="mt-1 text-sm font-bold leading-5">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">지금 할 일</p>
            <h2 className="mt-1 text-xl font-black text-blue-950">
              {status ? easyNextAction(status.nextAction, status.nextActionLabel) : "실시간 상태를 읽지 못했습니다. 아래 전체 순서는 그대로 사용할 수 있습니다."}
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-blue-900">
              {status?.reason ?? "소싱엔진 상태 API 연결이 잠시 안 될 때도 각 단계 버튼은 정상적으로 열립니다."}
            </p>
          </div>
          {status ? (
            <a
              href={engineUrl(status.nextHref)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
            >
              지금 할 화면 열기 →
            </a>
          ) : null}
        </div>

        {status ? (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">운영 루프</p>
                <h3 className="mt-1 text-base font-black text-slate-950">새 후보는 매번 찾는 게 아니라, 현재 후보 풀이 소진됐을 때만 보충합니다.</h3>
              </div>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{operatorModeKo(status)}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">신규 후보 보충</p>
                <p className="mt-1 text-sm font-black text-slate-950">후보 풀 소진 때만</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">현재 사람 개입</p>
                <p className="mt-1 text-sm font-black text-slate-950">{operatorModeKo(status)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">이번 최소행동</p>
                <p className="mt-1 text-sm font-black leading-5 text-slate-950">{status.operatorActionLabel ?? status.nextActionLabel}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              {status.cycleNote ?? "신규 후보는 현재 검증 풀이 소진됐을 때만 다시 수집합니다."}
            </p>
            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900">
              <strong>그 다음:</strong> {status.afterAction ?? "현재 행동이 끝나면 소싱엔진이 다음 최소행동을 다시 계산합니다."}
              {status.automaticContinuation ? <span className="ml-1 font-bold">자동 후속처리 연결됨</span> : null}
            </div>
            {status.nextAction === "COLLECT_NEW_CANDIDATES" ? (
              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
                <strong>현재 MVP의 사람 역할:</strong> 1688 브라우저 화면에서 후보를 한 번 수집·저장하는 것만 남아 있습니다. 저장 뒤 AI 의미분석·NAVER·Shopping Insight는 기존 자동처리가 이어집니다. 이 수집은 건설할 때만 하는 일은 아니지만, 운영 중에도 후보 풀이 소진됐을 때만 다시 호출됩니다.
              </div>
            ) : null}
          </div>
        ) : null}

        {status?.funnel ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-bold text-blue-900">후보가 어디에서 줄었는지</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-xl border border-blue-100 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">처음 검증 후보</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{status.funnel.confirmedOpportunityCandidates}</p>
                <p className="mt-1 text-[11px] text-slate-400">한국 수요검증 통과</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">공급상품 확정</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{status.funnel.supplyAnchorResolvedCandidates}</p>
                <p className="mt-1 text-[11px] text-slate-400">실제 1688 offer 연결</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                <p className="text-xs font-semibold text-rose-700">운영복잡 제외</p>
                <p className="mt-1 text-2xl font-black text-rose-950">{status.funnel.complexityRejectedCandidates}</p>
                <p className="mt-1 text-[11px] text-rose-500">옵션·구성 복잡</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">공급 선택 대기</p>
                <p className="mt-1 text-2xl font-black text-amber-950">{status.funnel.supplyPendingCandidates}</p>
                <p className="mt-1 text-[11px] text-amber-600">아직 공급상품 미확정</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">최종 판단 대상</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{status.funnel.decisionCandidates}</p>
                <p className="mt-1 text-[11px] text-slate-400">수익성·시장가격·AI 단계</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">최종 탈락</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{status.terminalRejectedCandidates}</p>
                <p className="mt-1 text-[11px] text-slate-400">현재 최종 판단 풀 기준</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-blue-800">
              ‘공급상품 확정·운영복잡 제외·공급 선택 대기’는 같은 공급선택 단계의 분기입니다. ‘최종 판단 대상·최종 탈락’은 그 다음 단계 숫자라 단순 합계로 더하지 않습니다.
            </p>
          </div>
        ) : status ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-blue-100 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">최종 판단 대상</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{status.totalCandidates}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">아직 진행 중</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{status.activeCandidates}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">최종 탈락</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{status.terminalRejectedCandidates}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">전체 소싱 순서</h2>
          <p className="mt-1 text-sm text-slate-500">위에서 아래로 갈수록 실제 돈을 쓰는 결정에 가까워집니다. 앞 단계에서 떨어진 상품은 뒤 단계로 보내지 않습니다.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {stages.map((stage) => (
            <article key={stage.path} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">
                  {stage.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-slate-950">{stage.title}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{stage.group}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{stage.description}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <code className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{stage.path}</code>
                    <a
                      href={engineUrl(stage.path)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      {stage.action} →
                    </a>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">운영 원칙</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-sm font-black text-emerald-900">자동으로 넘기는 것</p>
              <p className="mt-1 text-sm leading-6 text-emerald-800">수요·공급·마진·가격·AI 품질 기준이 명확하게 통과한 후보.</p>
            </div>
            <div className="rounded-xl bg-rose-50 p-4">
              <p className="text-sm font-black text-rose-900">자동으로 떨어뜨리는 것</p>
              <p className="mt-1 text-sm leading-6 text-rose-800">수요가 약하거나, 공급이 불안하거나, 마진이 안 남거나, 옵션 구조가 너무 복잡한 후보.</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-sm font-black text-amber-900">사람이 보는 것</p>
              <p className="mt-1 text-sm leading-6 text-amber-800">실제 1688 상품·SKU 연결처럼 잘못 고르면 뒤 데이터가 모두 틀어지는 애매한 판단.</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-sm font-black text-blue-900">최종 목표</p>
              <p className="mt-1 text-sm leading-6 text-blue-800">승준님이 모든 후보를 보는 게 아니라, 마지막 TEST_READY 후보만 보는 구조.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">보조 점검 화면</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {helperPages.map((item) => (
              <div key={item.path} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                </div>
                <a
                  href={engineUrl(item.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700"
                >
                  열기
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
