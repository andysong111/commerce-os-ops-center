"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { moduleRegistry } from "@/lib/moduleRegistry";

const moduleIcons = {
  "china-order-cost": CalculatorIcon,
  "product-master": ProductIcon,
  "freight-barcode-pdf": BarcodeIcon,
  "keyword-review-queue": KeywordIcon,
} as const;

const navigation = [
  { href: "/", label: "대시보드", icon: DashboardIcon },
  ...moduleRegistry.flatMap((module) => {
    if (module.status !== "available" || module.route === null) {
      return [];
    }

    const icon = moduleIcons[module.id as keyof typeof moduleIcons];
    if (!icon) {
      return [];
    }

    return [
      {
        href: module.route,
        label: module.navigationLabel ?? module.title,
        icon,
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
            const Icon = item.icon;

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
                <Icon />
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
            commerce-os
          </p>
          {!compact && (
            <p className="mt-0.5 text-xs text-slate-500">Seller operations</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}

function CalculatorIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M8 6h8v4H8zM8 14h2m4 0h2m-8 4h2m4 0h2" />
    </svg>
  );
}

function ProductIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14" />
      <path d="M3 3h4M17 3h4M3 21h4M17 21h4" />
    </svg>
  );
}

function KeywordIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5M8 8h5M8 11h4" />
    </svg>
  );
}
