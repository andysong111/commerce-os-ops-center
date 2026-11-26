"use client";

import { useCallback, useEffect, useState } from "react";
import {
  detailPageSourceLinkFailureDetail,
  isDetailPageSourceLinkUnavailable,
} from "@/lib/detailPageSourceLinkFailure";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

type UnknownRecord = Record<string, unknown>;

type ReviewJob = {
  jobId: string;
  itemId: string;
  status: string;
  stage: string;
  qaStatus: string;
  error: string;
  message: string;
  sourceUrl?: string;
  payload?: UnknownRecord;
  result?: UnknownRecord;
  updatedAt: string;
};

export function DetailPageSourceLinkFailurePanel() {
  const [jobs, setJobs] = useState<ReviewJob[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: ReviewJob[];
      };
      if (!response.ok || body.ok !== true || !Array.isArray(body.jobs)) return;
      setJobs(
        body.jobs
          .filter(isDetailPageSourceLinkUnavailable)
          .sort(
            (left, right) =>
              Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""),
          )
          .slice(0, 10),
      );
    } catch {
      // 기존 검수 워크스페이스의 오류 처리를 방해하지 않도록 보조 패널은 조용히 재시도한다.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!jobs.length) return null;

  return (
    <section className="mb-5 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.12em] text-rose-600">검수 필요</p>
          <h2 className="mt-1 text-lg font-black text-rose-950">링크불량 · 정상 상품 원본 확인 불가</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-rose-800">
            상세페이지 제작에 사용한 1688 링크에서 원본 자료를 확보하지 못했습니다. 상품 상세에서 같은 상품의 제작용 링크를 저장한 뒤 다시 생성하세요.
          </p>
        </div>
        <span className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white">
          {jobs.length.toLocaleString("ko-KR")}건
        </span>
      </div>

      <div className="mt-4 divide-y divide-rose-200 overflow-hidden rounded-xl border border-rose-200 bg-white">
        {jobs.map((job) => (
          <article key={job.jobId} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-700">
                  링크불량
                </span>
                <strong className="truncate text-sm text-slate-950">{jobName(job)}</strong>
              </div>
              <p className="mt-1 break-words text-xs font-bold leading-5 text-slate-600">
                {detailPageSourceLinkFailureDetail(job)}
              </p>
              <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">
                {job.itemId} · {job.jobId}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {job.sourceUrl ? (
                <a
                  href={job.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"
                >
                  1688 링크 확인
                </a>
              ) : null}
              <a
                href={`/product-launch-tracker?detailPageItem=${encodeURIComponent(job.itemId)}`}
                className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800"
              >
                상품 상세 열기
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function jobName(job: ReviewJob) {
  const payload = record(job.payload);
  return text(payload.product_name_hint || payload.product_name) || job.itemId;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}
