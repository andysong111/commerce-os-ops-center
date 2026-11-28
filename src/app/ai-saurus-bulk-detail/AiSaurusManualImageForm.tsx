"use client";

import type { FormEvent } from "react";

export type ManualImages = { detailImageUrl: string; mainImageUrl: string; additionalImageUrls: string[] };

export default function AiSaurusManualImageForm({ busy, saved, error, onSave }: {
  busy: boolean; saved: boolean; error: string; onSave: (input: ManualImages) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    onSave({
      detailImageUrl: String(fields.get("detailImageUrl") ?? "").trim(),
      mainImageUrl: String(fields.get("mainImageUrl") ?? "").trim(),
      additionalImageUrls: String(fields.get("additionalImageUrls") ?? "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    });
  }

  const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-bold text-slate-900">{saved ? "직접 제작 URL 저장 완료 · 다시 입력" : "직접 제작 URL 입력"}</summary>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <label className="block space-y-1 text-sm font-semibold">
          <span>상세페이지 이미지 URL</span>
          <input className={inputClass} name="detailImageUrl" type="url" required disabled={busy} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          <span>대표 이미지 URL</span>
          <input className={inputClass} name="mainImageUrl" type="url" required disabled={busy} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          <span>부가 이미지 URL · 한 줄에 하나, 최대 10개</span>
          <textarea className={inputClass} name="additionalImageUrls" rows={4} disabled={busy} />
        </label>
        {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">직접 제작 URL 저장</button>
      </form>
    </details>
  );
}
