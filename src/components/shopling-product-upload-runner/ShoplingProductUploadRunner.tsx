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
  rawDumpEnabled?: boolean;
  rawDumpReason?: string;
  githubActionsUrl?: string;
  requestId?: string;
};

type ActionsResult = {
  status?: string;
  message?: string;
  runId?: number;
  runUrl?: string;
  runConclusion?: string | null;
  runStatus?: string;
  artifactName?: string;
  requestId?: string;
  summary?: {
    row_expression?: string;
    selected_channel?: string;
    estimated_target_count?: number;
    status?: string;
    exit_code?: number;
    ok_count?: number;
    skip_count?: number;
    fail_count?: number;
    goods_keys?: GoodsKeyRow[];
    request_id?: string | null;
  };
};

type GoodsKeyRow = {
  row?: number | string;
  channel?: string;
  code?: string;
  success?: boolean | string;
  goods_key?: string;
  ptn_goods_cd?: string;
};

const CURRENT_REQUEST_ID_STORAGE_KEY = "shoplingProductUpload.currentRequestId";

const channels = [
  { value: "", label: "전체 6채널" },
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
  const [fetchingResult, setFetchingResult] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [actionsResult, setActionsResult] = useState<ActionsResult | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(CURRENT_REQUEST_ID_STORAGE_KEY) ?? "";
  });

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
    setActionsResult(null);
    try {
      const response = await fetch("/api/shopling-product-upload/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowExpression: formData.get("rowExpression")?.toString() ?? "",
          channel: formData.get("channel")?.toString() ?? "",
          skip_if_goods_key: formData.get("skip_if_goods_key") === "on",
          dump: false,
          sleep: "1.2",
        }),
      });
      const data = await response.json();
      setResult(data);
      if (typeof data.requestId === "string" && data.requestId.length > 0) {
        setCurrentRequestId(data.requestId);
        window.localStorage.setItem(CURRENT_REQUEST_ID_STORAGE_KEY, data.requestId);
      }
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : "실행 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setRunning(false);
    }
  };

  const handleFetchActionsResult = async () => {
    if (fetchingResult) return;
    setFetchingResult(true);
    try {
      const url = currentRequestId
        ? `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(currentRequestId)}`
        : "/api/shopling-product-upload/actions-result";
      const response = await fetch(url);
      const data = await response.json();
      setActionsResult(data);
    } catch (error) {
      setActionsResult({
        status: "error",
        message: error instanceof Error ? error.message : "최근 실행 결과를 가져오는 중 오류가 발생했습니다.",
      });
    } finally {
      setFetchingResult(false);
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
            <span className="mt-2 block text-xs font-normal text-slate-500">기본값은 도매1~도매4, 소매1~소매2 전체 등록입니다.</span>
          </label>
        </div>

        <fieldset className="mt-6 grid gap-4 rounded-xl bg-slate-50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input name="skip_if_goods_key" type="checkbox" defaultChecked className="size-4 rounded border-slate-300" />
            이미 goods_key 있으면 스킵
          </label>
          <div className="text-xs leading-5 text-slate-500">
            <p>민감정보 보호를 위해 원문 XML 요청/응답은 기본 저장하지 않습니다.</p>
            <p>실행 결과에는 행 번호, 채널, 성공/실패/SKIP, goods_key 중심의 요약 정보만 표시됩니다.</p>
          </div>
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
            <ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} />
            <ResultRow label="시작 시간" value={result.startTime ?? "-"} />
            <ResultRow label="종료 시간" value={result.endTime ?? "-"} />
            <ResultRow label="실행 시간" value={formatDuration(result.durationMs)} />
            <ResultRow label="exitCode" value={result.exitCode ?? "-"} />
            <ResultRow label="commandPreview" value={result.commandPreview ?? "-"} mono />
            <ResultRow label="요청 추적 ID" value={result.requestId ?? currentRequestId ?? "-"} mono />
            {result.message ? <ResultRow label="message" value={result.message} /> : null}
            {result.rawDumpReason ? <ResultRow label="rawDumpReason" value={result.rawDumpReason} /> : null}
            {result.githubActionsUrl ? <ResultRow label="githubActionsUrl" value={result.githubActionsUrl} /> : null}
            {result.status === "queued" ? (
              <div className="rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-700">
                실제 완료 여부는 GitHub Actions 실행이 끝난 뒤 ‘최근 실행 결과 가져오기’로 확인하세요.<br />
                최근 실행 결과 가져오기는 이 요청 추적 ID와 일치하는 결과를 우선 조회합니다.
              </div>
            ) : null}
            <OutputBlock label="stdout" value={result.stdout ?? ""} truncated={result.stdoutTruncated} />
            <OutputBlock label="stderr" value={result.stderr ?? ""} truncated={result.stderrTruncated} />
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">아직 실행 결과가 없습니다.</p>
        )}
        <button
          type="button"
          onClick={handleFetchActionsResult}
          disabled={fetchingResult}
          className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {fetchingResult ? "결과 가져오는 중..." : "최근 실행 결과 가져오기"}
        </button>
        {actionsResult ? <ActionsResultPanel result={actionsResult} currentRequestId={currentRequestId} /> : null}
      </section>
    </div>
  );
}

function ActionsResultPanel({ result, currentRequestId }: { result: ActionsResult; currentRequestId: string }) {
  const summary = result.summary;
  const goodsKeys = Array.isArray(summary?.goods_keys) ? summary.goods_keys : [];
  const displayRequestId = summary?.request_id ?? result.requestId ?? currentRequestId ?? "-";

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-bold text-slate-950">최근 GitHub Actions 실행 결과</h3>
      {result.message ? <p className="mt-2 text-sm font-medium text-slate-700">{result.message}</p> : null}
      <dl className="mt-4 grid gap-3 text-sm">
        <ResultRow label="GitHub Actions 실행 상태" value={`${result.runStatus ?? result.status ?? "-"} / ${result.runConclusion ?? "-"}`} />
        <ResultRow label="요청 추적 ID" value={displayRequestId} mono />
        <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[160px_1fr]">
          <dt className="font-semibold text-slate-700">GitHub Actions 바로가기</dt>
          <dd className="text-slate-900">
            {result.runUrl ? <a className="text-blue-700 underline" href={result.runUrl} target="_blank" rel="noreferrer">GitHub Actions 바로가기</a> : "-"}
            <p className="mt-1 text-xs text-slate-500">문제가 있으면 실행 로그에서 실패 원인을 바로 확인할 수 있습니다.</p>
          </dd>
        </div>
        <ResultRow label="row_expression" value={summary?.row_expression ?? "-"} />
        <ResultRow label="selected_channel" value={summary?.selected_channel ?? "-"} />
        <ResultRow label="estimated_target_count" value={summary?.estimated_target_count ?? "-"} />
        <ResultRow label="status" value={summary?.status ?? "-"} />
        <ResultRow label="exit_code" value={summary?.exit_code ?? "-"} />
        <ResultRow label="OK" value={summary?.ok_count ?? "-"} />
        <ResultRow label="SKIP" value={summary?.skip_count ?? "-"} />
        <ResultRow label="FAIL" value={summary?.fail_count ?? "-"} />
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-white text-left text-slate-700">
              <th className="border border-slate-200 px-3 py-2">행</th>
              <th className="border border-slate-200 px-3 py-2">채널</th>
              <th className="border border-slate-200 px-3 py-2">코드</th>
              <th className="border border-slate-200 px-3 py-2">성공 여부</th>
              <th className="border border-slate-200 px-3 py-2">goods_key</th>
              <th className="border border-slate-200 px-3 py-2">ptn_goods_cd</th>
            </tr>
          </thead>
          <tbody>
            {goodsKeys.length > 0 ? goodsKeys.map((row, index) => (
              <tr key={`${row.row ?? index}-${row.channel ?? ""}-${row.code ?? ""}`} className="bg-white">
                <td className="border border-slate-200 px-3 py-2">{row.row ?? "-"}</td>
                <td className="border border-slate-200 px-3 py-2">{row.channel ?? "-"}</td>
                <td className="border border-slate-200 px-3 py-2">{row.code ?? "-"}</td>
                <td className="border border-slate-200 px-3 py-2">{String(row.success ?? "-")}</td>
                <td className="border border-slate-200 px-3 py-2 font-mono">{row.goods_key ?? "-"}</td>
                <td className="border border-slate-200 px-3 py-2 font-mono">{row.ptn_goods_cd ?? "-"}</td>
              </tr>
            )) : (
              <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={6}>goods_key 결과가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
