import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

const modules = [
  {
    title: "중국주문 원가계산",
    description: "운임 그룹별 중국 내륙운송비를 수량 기준으로 배부합니다.",
    href: "/china-orders",
    active: true,
  },
  { title: "상품 마스터", description: "상품과 옵션 정보를 한곳에서 관리합니다." },
  { title: "키워드 엔진", description: "판매 채널별 검색 키워드를 발굴하고 정리합니다." },
  { title: "상세페이지 엔진", description: "상품 정보 기반의 판매 문구를 생성합니다." },
  { title: "재고/가격 관리", description: "재고 수량과 채널별 가격을 추적합니다." },
  { title: "샵플링 API 자동화", description: "반복적인 채널 운영 업무를 자동화합니다." },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="대시보드"
        description="온라인 판매 운영에 필요한 자동화 모듈을 한곳에서 관리하세요. 현재는 중국주문 원가계산 모듈을 사용할 수 있습니다."
      />

      <section aria-labelledby="modules-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="modules-heading" className="text-sm font-semibold text-slate-900">
            운영 모듈
          </h2>
          <span className="text-xs text-slate-500">1 / 6 사용 가능</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module, index) => {
            const card = (
              <div
                className={`group h-full rounded-xl border bg-white p-5 shadow-sm transition ${
                  module.active
                    ? "border-blue-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md"
                    : "border-slate-200"
                }`}
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <span
                    className={`grid size-10 place-items-center rounded-lg text-sm font-bold ${
                      module.active
                        ? "bg-blue-50 text-blue-700"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      module.active
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {module.active ? "사용 가능" : "준비중"}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-950">{module.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
                <p className={`mt-5 text-sm font-semibold ${module.active ? "text-blue-600" : "text-slate-400"}`}>
                  {module.active ? "모듈 열기 →" : "추후 제공 예정"}
                </p>
              </div>
            );

            return module.href ? (
              <Link key={module.title} href={module.href} className="rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                {card}
              </Link>
            ) : (
              <div key={module.title}>{card}</div>
            );
          })}
        </div>
      </section>
    </>
  );
}
