"use client";

import { FormEvent, useState } from "react";

type RunResult = {
  status?: string;
  message?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  exitCode?: number | null;
  commandPreview?: string;
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

const channels = [
  { value: "", label: "전체" },
  { value: "도매1", label: "도매1" },
  { value: "도매2", label: "도매2" },
  { value: "도매3", label: "도매3" },
  { value: "도매4", label: "도매4" },
  { value: "소매1", label: "소매1" },
  { value: "소매2", label: "소매2" },
];

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "-";
  return `${(durationMs / 1000).toFixed(1)}초`;
}

export function ShoplingProductUploadRunner() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;
    const confirmed = window.confirm(
      "실제 샵플링 상품등록 엔진을 실행합니다.\n입력한 행과 채널이 샵플링에 등록될 수 있습니다.\n계속하시겠습니까?",
    );
    if (!confirmed) return;

    const formData = new FormData(event.currentTarget);
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/shopling-product-upload/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowExpression: formData.get("rowExpression")?.toString() ?? "",
          channel: formData.get("channel")?.toString() ?? "",
          skip_if_goods_key: formData.get("skip_if_goods_key") === "on",
          dump: formData.get("dump") === "on",
          sleep: "1.2",
        }),
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : "실행 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-800">
            실재고 시트 행 번호
            <input
              name="rowExpression"
              placeholder="예: 967 또는 698,714-730,801"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
            <span className="mt-2 block text-xs font-normal text-slate-500">지원 예: 967, 698,714, 714-730, 698,714-730,801</span>
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            채널
            <select name="channel" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
              {channels.map((channel) => (
                <option key={channel.label} value={channel.value}>{channel.label}</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mt-6 grid gap-4 rounded-xl bg-slate-50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input name="skip_if_goods_key" type="checkbox" defaultChecked className="size-4 rounded border-slate-300" />
            이미 goods_key 있으면 스킵
          </label>
          <label className="block text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2">
              <input name="dump" type="checkbox" defaultChecked className="size-4 rounded border-slate-300" />
              요청/응답 XML 덤프 저장
            </span>
            <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">
              오류 추적용입니다. 덤프 파일에는 민감정보가 포함될 수 있으므로 외부 공유 금지.
            </span>
          </label>
          <p className="text-xs leading-5 text-slate-500">
            실행 간격은 안정성을 위해 1.2초로 고정됩니다.
          </p>
        </fieldset>

        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700">
          이 기능은 실제 샵플링 상품등록 API를 실행할 수 있습니다.<br />
          행 번호와 채널을 확인한 뒤 실행하세요.
        </div>

        <button type="submit" disabled={running} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400">
          {running ? "실행 중..." : "상품등록 실행"}
        </button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">실행 결과</h2>
        {result ? (
          <dl className="mt-4 grid gap-3 text-sm">
            <ResultRow label="실행 상태" value={result.status ?? "-"} />
            <ResultRow label="시작 시간" value={result.startTime ?? "-"} />
            <ResultRow label="종료 시간" value={result.endTime ?? "-"} />
            <ResultRow label="실행 시간" value={formatDuration(result.durationMs)} />
            <ResultRow label="exitCode" value={result.exitCode ?? "-"} />
            <ResultRow label="commandPreview" value={result.commandPreview ?? "-"} mono />
            {result.message ? <ResultRow label="message" value={result.message} /> : null}
            <OutputBlock label="stdout" value={result.stdout ?? ""} truncated={result.stdoutTruncated} />
            <OutputBlock label="stderr" value={result.stderr ?? ""} truncated={result.stderrTruncated} />
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">아직 실행 결과가 없습니다.</p>
        )}
      </section>
    </div>
  );
}

function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[160px_1fr]">
      <dt className="font-semibold text-slate-700">{label}</dt>
      <dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd>
    </div>
  );
}

function OutputBlock({ label, value, truncated }: { label: string; value: string; truncated?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3">
      <dt className="font-semibold text-slate-700">{label}{truncated ? " (truncated)" : ""}</dt>
      <dd><pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{value || "-"}</pre></dd>
    </div>
  );
}
