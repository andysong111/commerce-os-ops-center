"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent, type ReactNode } from "react";

export function PurchasePreflightForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") params.append(key, value);
    }
    startTransition(() => {
      router.push(`/purchase-cycle-preflight?${params.toString()}`);
    });
  }

  return (
    <form
      method="get"
      action="/purchase-cycle-preflight"
      aria-busy={pending}
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-3"
    >
      {children}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-75"
      >
        {pending ? (
          <>
            <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            계산·점검 중...
          </>
        ) : (
          "읽기 전용 사전 점검"
        )}
      </button>
      {pending ? (
        <p role="status" className="text-xs font-medium leading-5 text-slate-600 sm:col-span-2">
          최신 판매·재고·미입고 자료를 확인하고 있습니다. 이 화면에서 잠시 기다려 주세요.
        </p>
      ) : null}
    </form>
  );
}
