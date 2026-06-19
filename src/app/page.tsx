import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { moduleRegistry, type CommerceModule } from "@/lib/moduleRegistry";

const statusPresentation = {
  available: {
    badge: "사용 가능",
    badgeClassName: "bg-emerald-50 text-emerald-700",
    cardClassName:
      "border-blue-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md",
    iconClassName: "bg-blue-50 text-blue-700",
    action: "모듈 열기 →",
    actionClassName: "text-blue-600",
  },
  runner_scaffold: {
    badge: "실행 가능",
    badgeClassName: "bg-blue-50 text-blue-700",
    cardClassName:
      "border-blue-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md",
    iconClassName: "bg-blue-50 text-blue-700",
    action: "실행기 열기 →",
    actionClassName: "text-blue-600",
  },
  preparing: {
    badge: "준비 중",
    badgeClassName: "bg-amber-50 text-amber-700",
    cardClassName: "border-slate-200",
    iconClassName: "bg-slate-100 text-slate-500",
    action: "추후 제공",
    actionClassName: "text-slate-400",
  },
  disabled: {
    badge: "비활성",
    badgeClassName: "bg-slate-200 text-slate-500",
    cardClassName: "border-slate-200 bg-slate-50 opacity-60",
    iconClassName: "bg-slate-200 text-slate-400",
    action: "사용 불가",
    actionClassName: "text-slate-400",
  },
} as const;

export default function DashboardPage() {
  const availableCount = moduleRegistry.filter(
    (module) => module.status === "available",
  ).length;

  return (
    <>
      <PageHeader
        title="대시보드"
        description="온라인 판매 운영에 필요한 자동화 모듈을 한곳에서 관리하세요. 사용 가능한 모듈은 바로 열 수 있고, 준비 중인 모듈은 이후 연결됩니다."
      />

      <section aria-labelledby="modules-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="modules-heading"
            className="text-sm font-semibold text-slate-900"
          >
            운영 모듈
          </h2>
          <span className="text-xs text-slate-500">
            {availableCount} / {moduleRegistry.length} 사용 가능
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {moduleRegistry.map((module, index) => (
            <ModuleCard key={module.id} module={module} index={index} />
          ))}
        </div>
      </section>
    </>
  );
}

function ModuleCard({
  module,
  index,
}: {
  module: CommerceModule;
  index: number;
}) {
  const presentation = statusPresentation[module.status];
  const href =
    (module.status === "available" || module.status === "runner_scaffold") && module.route
      ? module.route
      : null;
  const card = (
    <article
      className={`group h-full rounded-xl border bg-white p-5 shadow-sm transition ${presentation.cardClassName}`}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <span
          className={`grid size-10 place-items-center rounded-lg text-sm font-bold ${presentation.iconClassName}`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.badgeClassName}`}
        >
          {presentation.badge}
        </span>
      </div>
      <h3 className="font-semibold text-slate-950">{module.title}</h3>
      {module.helperNote ? (
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-blue-600">
          {module.helperNote}
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {module.description}
      </p>
      <p
        className={`mt-5 text-sm font-semibold ${presentation.actionClassName}`}
      >
        {presentation.action}
      </p>
    </article>
  );

  return href !== null ? (
    <Link
      href={href}
      className="rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      {card}
    </Link>
  ) : (
    <div>{card}</div>
  );
}
