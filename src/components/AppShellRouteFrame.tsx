"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppShellRouteFrame({ children, tools }: { children: ReactNode; tools: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/mobile-work-center" || pathname === "/mobile-work-center/") {
    return <main className="min-h-screen bg-slate-50">{children}</main>;
  }
  return (
    <div className="app-shell min-h-screen bg-slate-50">
      {tools}
      <main className="app-main min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="app-content mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
