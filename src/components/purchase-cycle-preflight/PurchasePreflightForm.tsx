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
      className="border-y border-slate-200 bg-white px-4 py-5 sm:px-5"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium leading-5 text-slate-500">
          1단계에서는 예산과 자동 후보만 불러옵니다. 아래 직접 입력 후보는 마지막 발주안 계산 버튼에서 함께 반영됩니다.
          Draft 저장, 1688 주문, 결제는 실행하지 않습니다.
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="flex min-h-11 min-w-48 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-75"
        >
          {pending ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              예산·후보 확인 중...
            </>
          ) : (
            "1. 예산 · 자동후보 불러오기"
          )}
        </button>
      </div>
      {pending ? (
        <p role="status" className="mt-3 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-xs font-bold leading-5 text-sky-950">
          최신 판매·재고·미입고 자료와 신규상품 후보를 확인하고 있습니다. 완료되면 2단계에서 상품을 구성할 수 있습니다.
        </p>
      ) : null}
    </form>
  );
}
