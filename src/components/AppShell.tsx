import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
