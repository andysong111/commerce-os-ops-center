"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { OpsDashboard } from "@/components/dashboard/OpsDashboard";
import type { CommerceModule } from "@/lib/moduleRegistry";
import { getWorkspaceGroupById } from "@/lib/opsWorkspace";

const FAVORITES_KEY = "opsCenter.dashboard.favorites.v1";
const FAVORITES_EVENT = "ops-center-dashboard-favorites-updated";
const CONTENT_MODULE_IDS = [
  "keyword-research",
  "detail-page-studio",
  "detail-page-studio-saas-test",
  "detail-page-studio-saas-test-260807",
  "keyword-engine-elon-lab",
  "keyword-engine",
  "keyword-review-queue",
] as const;
const ENABLED = new Set(["available", "runner_scaffold", "check_mode"]);

function subscribeFavorites(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(FAVORITES_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(FAVORITES_EVENT, callback);
  };
}

function favoritesSnapshot() {
  return window.localStorage.getItem(FAVORITES_KEY) || "[]";
}

function parseFavorites(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function OpsDashboardWithSaasTestClone({
  modules,
  selectedGroupId,
}: {
  modules: readonly CommerceModule[];
  selectedGroupId?: string | null;
}) {
  if (selectedGroupId !== "content-keyword") {
    return <OpsDashboard modules={modules} selectedGroupId={selectedGroupId} />;
  }

  return <ContentKeywordGroup modules={modules} />;
}

function ContentKeywordGroup({ modules }: { modules: readonly CommerceModule[] }) {
  const group = getWorkspaceGroupById("content-keyword")!;
  const moduleById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules],
  );
  const groupModules = CONTENT_MODULE_IDS.map((id) => moduleById.get(id)).filter(
    (module): module is CommerceModule => Boolean(module),
  );
  const favoritesRaw = useSyncExternalStore(
    subscribeFavorites,
    favoritesSnapshot,
    () => "[]",
  );
  const favorites = useMemo(() => parseFavorites(favoritesRaw), [favoritesRaw]);

  function toggleFavorite(moduleId: string) {
    const next = favorites.includes(moduleId)
      ? favorites.filter((id) => id !== moduleId)
      : [moduleId, ...favorites];
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
            업무 영역
          </p>
          <h2 className="mt-1 text-2xl font-black">{group.label}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            {group.description}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-white/20 px-3.5 py-2 text-sm font-semibold hover:bg-white/10"
        >
          전체 대시보드
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {groupModules.map((module) => {
          const favorite = favorites.includes(module.id);
          const enabled = Boolean(module.route && ENABLED.has(module.status));
          const warning =
            module.status === "preparing"
              ? "준비 중"
              : module.status === "check_mode"
                ? "점검 모드"
                : module.safetyBadge ?? null;

          return (
            <article
              key={module.id}
              className="flex flex-col gap-4 border-b border-slate-100 bg-white px-5 py-4 last:border-b-0 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-black text-slate-700">
                  {group.iconLabel}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-950">{module.title}</h3>
                    {warning ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        {warning}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    {module.description}
                  </p>
                  <p className="mt-1.5 text-xs font-semibold text-slate-400">
                    {group.label}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                <button
                  type="button"
                  onClick={() => toggleFavorite(module.id)}
                  aria-label={
                    favorite
                      ? `${module.title} 즐겨찾기 해제`
                      : `${module.title} 즐겨찾기 추가`
                  }
                  className={`grid size-9 place-items-center rounded-lg border text-base ${
                    favorite
                      ? "border-amber-200 bg-amber-50 text-amber-600"
                      : "border-slate-200 text-slate-300 hover:text-amber-500"
                  }`}
                >
                  {favorite ? "★" : "☆"}
                </button>
                {enabled ? (
                  <Link
                    href={module.route!}
                    className="rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    열기
                  </Link>
                ) : (
                  <span className="rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-400">
                    준비 중
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
