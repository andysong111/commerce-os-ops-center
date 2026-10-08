"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

export function PurchaseDraftRecalculationLink({ href }: { href: string }) {
  const [pending, setPending] = useState(false);

  function startLoading(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    setPending(true);
  }

  return (
    <Link
      href={href}
      prefetch={false}
      aria-busy={pending}
      aria-disabled={pending}
      onClick={startLoading}
      className={`flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${
        pending
          ? "cursor-wait border-amber-300 bg-amber-100 text-amber-950"
          : "border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100"
      }`}
    >
      {pending ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-amber-950/25 border-t-amber-950"
          />
          최신 자료 계산 중...
        </>
      ) : (
        "최신 로직으로 재계산"
      )}
    </Link>
  );
}
