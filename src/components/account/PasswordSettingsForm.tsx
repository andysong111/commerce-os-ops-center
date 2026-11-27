"use client";

import { useState } from "react";
import Link from "next/link";
import type { FormEvent } from "react";
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  validateAccountPassword,
} from "@/lib/accountPassword";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type FormStatus =
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }
  | null;

export function PasswordSettingsForm({ accountId, recovering }: { accountId: string; recovering: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<FormStatus>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    const validation = validateAccountPassword(password, confirmation);
    if (!validation.ok) {
      setStatus({ kind: "error", message: validation.message });
      return;
    }

    setSaving(true);
    try {
      const supabase = await createSupabaseBrowserClient();
      if (!supabase) {
        setStatus({
          kind: "error",
          message: "Supabase 로그인 설정을 불러오지 못했습니다.",
        });
        return;
      }

      const current = await supabase.auth.getUser();
      if (current.error || current.data.user?.id !== accountId) {
        setStatus({ kind: "error", message: "로그인 계정이 바뀌었거나 인증이 만료됐습니다. 이메일 인증을 다시 진행하세요." });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }

      setPassword("");
      setConfirmation("");
      setStatus({
        kind: "success",
        message:
          "비밀번호가 설정되었습니다. 이제 다른 브라우저에서도 이메일과 새 비밀번호로 로그인할 수 있습니다.",
      });
    } catch {
      setStatus({
        kind: "error",
        message: "비밀번호를 저장하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도하세요.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <label className="block text-sm font-semibold text-slate-800">
        새 비밀번호
        <input
          name="new-password"
          type="password"
          autoComplete="new-password"
          minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
          maxLength={128}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <label className="block text-sm font-semibold text-slate-800">
        새 비밀번호 확인
        <input
          name="new-password-confirmation"
          type="password"
          autoComplete="new-password"
          minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
          maxLength={128}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        비밀번호 관리기에서 생성한 16자 이상의 값을 사용하세요. 비밀번호는
        이 화면 외의 채팅이나 문서에 공유하지 마세요.
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {saving ? "저장 중..." : "내 비밀번호 설정·변경"}
      </button>

      {recovering && status?.kind === "success" && (
        <Link href="/mobile-work-center" className="block py-2 text-center font-semibold text-blue-700 underline">모바일 업무센터 열기</Link>
      )}
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`rounded-xl p-4 text-sm font-semibold leading-6 ${
            status.kind === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
