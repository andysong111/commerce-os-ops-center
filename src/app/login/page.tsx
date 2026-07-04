"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = await createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Supabase 공개 설정이 없습니다. 관리자에게 문의하세요.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(`로그인 실패: ${error.message}`);
      setLoading(false);
      return;
    }
    setMessage("로그인되었습니다. 소싱 엔진으로 이동합니다.");
    router.push("/sourcing-engine");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">로그인</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">소싱 엔진 서버 저장 기능을 사용하려면 Supabase 계정으로 로그인하세요.</p>
        <form onSubmit={signIn} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">이메일</span>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">비밀번호</span>
            <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </label>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">{loading ? "로그인 중..." : "로그인"}</button>
        </form>
        {message ? <p className="mt-4 text-sm font-semibold text-slate-700">{message}</p> : null}
      </section>
    </main>
  );
}
