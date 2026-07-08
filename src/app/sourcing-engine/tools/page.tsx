import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

const workflows = [
  {
    title: "1688 주문추천 카드",
    href: "/sourcing-engine/importer",
    badge: "핵심 MVP",
    description:
      "1688 후보 텍스트/CSV/JSON을 일괄 파싱하고 1순위와 백업 2개를 추천합니다.",
    steps: ["후보 붙여넣기", "리스크 필터", "테스트 비용", "주문 판단"],
  },
  {
    title: "저장형 빠른 카드 생성",
    href: "/sourcing-engine/quick-save",
    badge: "저장 흐름",
    description:
      "후보 파싱, 카드 생성, 카드 이력 저장을 한 화면에서 처리합니다.",
    steps: ["파싱", "생성", "저장", "이력"],
  },
  {
    title: "소싱 시장 스냅샷",
    href: "/sourcing-engine/market-snapshot",
    badge: "신규제품 보조",
    description:
      "네이버 쇼핑 경쟁 가격대, 상위 몰/브랜드/카테고리 쏠림과 1688 검색어 초안을 확인합니다.",
    steps: ["키워드 입력", "경쟁 스냅샷", "1688 검색어", "후보 탐색"],
  },
  {
    title: "소싱 추천 카드 이력",
    href: "/sourcing-engine/cards",
    badge: "후보 관리",
    description:
      "생성한 추천 카드를 모아 비교하고 다음 주문 후보 관리 화면으로 확장합니다.",
    steps: ["카드 목록", "후보 비교", "백업", "상태 관리"],
  },
  {
    title: "소싱 피드백 기억장치",
    href: "/sourcing-engine/feedback",
    badge: "타율 개선",
    description:
      "테스트 주문 후 성공·애매·실패·재주문 여부를 기록하고 패턴별 성공률 힌트를 누적합니다.",
    steps: ["결과 입력", "실패 사유", "재주문 여부", "패턴 통계"],
  },
];

export default function SourcingEngineHubPage() {
  return (
    <>
      <PageHeader
        title="1688 소싱엔진"
        description="주문 후보를 압축하고 테스트 결과를 기억하는 OPS CENTER 소싱 워크플로우입니다."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {workflows.map((workflow) => (
          <Link
            key={workflow.href}
            href={workflow.href}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                {workflow.badge}
              </span>
              <span className="text-sm font-semibold text-blue-600">열기 →</span>
            </div>
            <h2 className="text-lg font-bold text-slate-950">{workflow.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {workflow.description}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {workflow.steps.map((step) => (
                <span
                  key={step}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
                >
                  {step}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        <p className="font-bold">운영 원칙</p>
        <p className="mt-2">
          실제 수집된 1688 후보 안에서만 판단합니다. 정밀 손익보다 소량 테스트 전 빠른 비용 판단을 우선합니다.
        </p>
      </section>
    </>
  );
}
