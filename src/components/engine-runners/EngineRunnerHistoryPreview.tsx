"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearEngineRunnerHistory,
  readEngineRunnerHistory,
  type EngineRunnerHistoryItem,
} from "@/lib/engineRunnerHistory";
import { formatBrowserLocalDateTime } from "@/lib/browserTime";
import type { EngineRunnerKind } from "@/lib/engineRunnerTypes";

const statusLabels = {
  requested: "요청됨",
  imported: "가져오기 완료",
  failed: "실패",
} as const;

export function EngineRunnerHistoryPreview({
  kind,
}: {
  kind: EngineRunnerKind;
}) {
  const [items, setItems] = useState<EngineRunnerHistoryItem[]>([]);

  useEffect(() => {
    const load = () =>
      setItems(
        readEngineRunnerHistory()
          .filter((item) => item.kind === kind)
          .slice(0, 3),
      );
    load();
    window.addEventListener("engine-runner-history-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("engine-runner-history-updated", load);
      window.removeEventListener("storage", load);
    };
  }, [kind]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            최근 작업 이력
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            현재 이력은 이 브라우저에 저장됩니다. 표시 시간은 현재 브라우저
            시간대 기준입니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "이 브라우저에 저장된 키워드 엔진 작업 이력을 비우시겠습니까? GitHub 실행 기록은 삭제되지 않습니다.",
                )
              ) {
                clearEngineRunnerHistory(kind);
              }
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
            disabled={items.length === 0}
          >
            작업 이력 비우기
          </button>
          <Link
            href="/engine-runner-history"
            className="text-sm font-semibold text-blue-700 underline"
          >
            전체 이력 보기
          </Link>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          아직 이 브라우저에 저장된 작업 이력이 없습니다.
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-950">{item.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                {item.status ? statusLabels[item.status] : "기록됨"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formatBrowserLocalDateTime(item.createdAt)}
            </p>
            {item.reviewRoute ? (
              <Link
                href={item.reviewRoute}
                className="mt-2 inline-block text-xs font-semibold text-blue-700 underline"
              >
                검토 화면 열기
              </Link>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
