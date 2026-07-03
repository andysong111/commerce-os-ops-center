"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { moduleRegistry } from "@/lib/moduleRegistry";

const moduleIconLabels: Record<string, string> = {
  "china-order-cost": "₩",
  "product-master": "P",
  "sourcing-engine": "S",
  "freight-barcode-pdf": "B",
  "keyword-review-queue": "K",
  "warehouse-label-generator": "L",
  "warehouse-location-sync": "W",
};

const navigation = [
  { href: "/", label: "대시보드", iconLabel: "D" },
  ...moduleRegistry.flatMap((module) => {
    if (
      !["available", "check_mode"].includes(module.status) ||
      module.route === null
    ) {
      return [];
    }

    const iconLabel = moduleIconLabels[module.id];
    if (!iconLabel) {
      return [];
    }

    return [
      {
        href: module.route,
        label: module.navigationLabel ?? module.title,
        iconLabel,
      },
    ];
  }),
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      <aside className="app-navigation fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-slate-200 bg-slate-950 text-slate-100 lg:flex lg:flex-col">
        <Brand />
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="주요 메뉴">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span className="grid size-4 place-items-center rounded bg-white/10 text-[10px] font-bold">
                  {item.iconLabel}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-500">
          운영 자동화 워크스페이스
        </div>
      </aside>

      <header className="app-navigation border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand compact />
        <nav
          className="mt-3 flex gap-2 overflow-x-auto"
          aria-label="모바일 메뉴"
        >
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-2" : "px-5 py-6"}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          C
        </span>
        <div>
          <p
            className={`font-bold tracking-tight ${compact ? "text-slate-900" : "text-white"}`}
          >
            Commerce OS OPS
          </p>
          {!compact && (
            <p className="mt-0.5 text-xs text-slate-500">OPS CENTER</p>
          )}
        </div>
      </div>
    </div>
  );
}
