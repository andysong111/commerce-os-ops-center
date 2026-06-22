import type { ReactNode } from "react";
import { AdminAccessGate } from "@/components/AdminAccessGate";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const isAdminPasswordConfigured = Boolean(process.env.OPS_ADMIN_PASSWORD);

  return (
    <AdminAccessGate isAdminPasswordConfigured={isAdminPasswordConfigured}>
      <div className="app-shell min-h-screen bg-slate-50">
        <Sidebar />
        <main className="app-main min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
          <div className="app-content mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </AdminAccessGate>
  );
}
