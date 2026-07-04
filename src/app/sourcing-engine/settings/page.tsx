"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type StatusPayload = {
  supabaseConfigured?: boolean;
  signedIn?: boolean;
  organizationId?: string | null;
  cardsUsable?: boolean;
  code?: string;
  message?: string;
};

export default function SourcingSettingsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload>({});

  useEffect(() => {
    async function load() {
      const supabase = await createSupabaseBrowserClient();
      const user = await supabase?.auth.getUser();
      setEmail(user?.data.user?.email ?? null);
      setAuthReady(true);

      const response = await fetch("/api/sourcing/status", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as StatusPayload;
      setStatus(payload);
    }
    load();
  }, []);

  return (
    <>
      <PageHeader
        title="Sourcing Engine Settings"
        description="Supabase 인증, 조직, 서버 저장 연결 상태를 확인합니다."
        actions={
          <Link href="/sourcing-engine" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Back
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="인증 상태">
          <StatusRow label="로그인 사용자" value={authReady ? email ?? "로그인 필요" : "확인 중..."} ok={Boolean(email)} />
          <div className="mt-4 flex flex-wrap gap-2">
            {email ? (
              <Link href="/logout" className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">로그아웃</Link>
            ) : (
              <Link href="/login" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">로그인</Link>
            )}
          </div>
        </Panel>

        <Panel title="서버 저장 상태">
          <StatusRow label="Supabase 설정" value={status.supabaseConfigured ? "configured" : "not configured"} ok={Boolean(status.supabaseConfigured)} />
          <StatusRow label="API 로그인 상태" value={status.signedIn ? "signed in" : status.code ?? "unknown"} ok={Boolean(status.signedIn)} />
          <StatusRow label="활성 조직 ID" value={status.organizationId ?? "없음"} ok={Boolean(status.organizationId)} />
          <StatusRow label="/api/sourcing/cards 사용 가능" value={status.cardsUsable ? "usable" : "not usable"} ok={Boolean(status.cardsUsable)} />
          {status.message ? <p className="mt-3 text-xs leading-5 text-slate-500">{status.message}</p> : null}
        </Panel>

        <Panel title="Available tools">
          <ul className="space-y-2 text-sm leading-6 text-slate-600">
            <li>1688 candidate parser</li>
            <li>Risk filter</li>
            <li>Test cost estimate</li>
            <li>Recommendation card</li>
            <li>Feedback memory</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-sm font-bold text-slate-950">{title}</h2>{children}</section>;
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-b-0">
      <span className="font-semibold text-slate-600">{label}</span>
      <span className={ok ? "font-bold text-emerald-700" : "font-bold text-amber-700"}>{value}</span>
    </div>
  );
}
