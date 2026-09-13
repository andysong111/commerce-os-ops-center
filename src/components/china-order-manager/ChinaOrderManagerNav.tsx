"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/china-order-manager", label: "월별 발주·입고" },
  { href: "/china-order-manager/cash-envelope", label: "현금 제약 발주 V2" },
  { href: "/china-order-manager/stock-control", label: "재고·품절·재입고" },
  { href: "/china-order-manager/reentry-shadow", label: "다음 발주 사전 점검" },
] as const;

export function ChinaOrderManagerNav() {
  const pathname = usePathname();
  return (
    <nav
      className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
      aria-label="중국 발주 관리 화면"
    >
      {items.map((item) => {
        const active =
          item.href === "/china-order-manager"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition-colors ${
              active
                ? "bg-slate-950 text-white"
                : "bg-slate-50 text-slate-700 hover:bg-blue-50 hover:text-blue-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
