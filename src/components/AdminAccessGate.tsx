"use client";

import { FormEvent, ReactNode, useState } from "react";

const SESSION_KEY = "ops-center-admin-access";
const SESSION_VALUE = "granted";

type AdminAccessGateProps = {
  children: ReactNode;
  isAdminPasswordConfigured: boolean;
};

export function AdminAccessGate({
  children,
  isAdminPasswordConfigured,
}: AdminAccessGateProps) {
  const [hasAccess, setHasAccess] = useState(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem(SESSION_KEY) === SESSION_VALUE,
  );
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setErrorMessage("비밀번호가 맞지 않습니다.");
        return;
      }

      sessionStorage.setItem(SESSION_KEY, SESSION_VALUE);
      setHasAccess(true);
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY);
    setHasAccess(false);
    setPassword("");
    setErrorMessage("");
  }

  if (!isAdminPasswordConfigured) {
    return <AccessCard message="관리자 비밀번호가 아직 설정되지 않았습니다." />;
  }

  if (!hasAccess) {
    return (
      <AccessCard>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-semibold text-slate-700"
              htmlFor="ops-admin-password"
            >
              관리자 비밀번호
            </label>
            <input
              autoComplete="current-password"
              autoFocus
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              id="ops-admin-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          {errorMessage ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {errorMessage}
            </p>
          ) : null}
          <button
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={isSubmitting}
            type="submit"
          >
            들어가기
          </button>
        </form>
      </AccessCard>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
          onClick={handleLogout}
          type="button"
        >
          로그아웃
        </button>
      </div>
      {children}
    </>
  );
}

function AccessCard({
  children,
  message,
}: {
  children?: ReactNode;
  message?: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">
          Commerce OS
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-950">OPS CENTER 접속</h1>
        {message ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {message}
          </p>
        ) : null}
        {children}
      </section>
    </main>
  );
}
