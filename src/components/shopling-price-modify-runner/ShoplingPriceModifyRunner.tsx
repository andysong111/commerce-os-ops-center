"use client";

import { FormEvent, useState } from "react";

const CURRENT_REQUEST_ID_STORAGE_KEY = "shoplingPriceModify.currentRequestId";

const PRICE_POLICY_MALLS = [
  ["SMALL_00001", "옥션", "기본 판매가 그대로"],
  ["SMALL_00002", "지마켓", "기본 판매가 그대로"],
  ["SMALL_00003", "11번가", "기본 판매가 그대로"],
  ["SMALL_00004", "스마트스토어", "기본 판매가 그대로"],
  ["SMALL_00005", "GS SHOP", "기본 판매가 그대로"],
  ["SMALL_00012", "쿠팡", "기본 판매가 그대로"],
  ["SMALL_00014", "카페24(1.9)", "판매가 × 0.97 후 10원 단위 올림"],
  ["SMALL_00019", "신세계몰", "기본 판매가 그대로"],
  ["SMALL_00069", "도매꾹", "기본 판매가 그대로"],
  ["SMALL_00071", "도매창고", "판매가 + 500원"],
  ["SMALL_00101", "카카오톡 스토어", "기본 판매가 그대로"],
  ["SMALL_00107", "오너클랜", "기본 판매가 그대로"],
  ["SMALL_00112", "에이블리", "판매가 + 3,000원"],
  ["SMALL_00116", "셀파", "기본 판매가 그대로"],
  ["SMALL_00130", "롯데ON", "기본 판매가 그대로"],
  ["SMALL_00165", "셀링콕", "기본 판매가 그대로"],
  ["SMALL_00168", "인큐텐", "기본 판매가 그대로"],
  ["SMALL_00179", "투비즈온", "기본 판매가 그대로"],
  ["SMALL_00180", "도매아토즈", "기본 판매가 그대로"],
  ["SMALL_00186", "AliExpress", "기본 판매가 그대로"],
  ["SMALL_00188", "셀리어스", "기본 판매가 그대로"],
  ["SMALL_00190", "도매의신", "기본 판매가 그대로"],
  ["SMALL_00191", "TEMU", "기본 판매가 그대로"],
  ["SMALL_00194", "토스쇼핑", "기본 판매가 그대로"],
] as const;

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; commandPreview?: string };
type ErrorRow = { idx?: string | number; mall?: string; goods_key?: string; code?: string | number; msg?: string };
type ActionsResult = {
  status?: string; message?: string; requestId?: string; runId?: number; runUrl?: string; runConclusion?: string | null; runStatus?: string; artifactName?: string;
  summary?: { schema_version?: unknown; source?: unknown; run_mode?: unknown; request_id?: string; goods_keys?: unknown; goods_key_count?: unknown; estimated_mall_update_count?: unknown; batch?: unknown; status?: unknown; exit_code?: unknown; ok_count?: unknown; fail_count?: unknown; errors?: ErrorRow[]; created_at?: unknown };
};

export function ShoplingPriceModifyRunner() {
  const [running, setRunning] = useState(false);
  const [fetchingResult, setFetchingResult] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [actionsResult, setActionsResult] = useState<ActionsResult | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(CURRENT_REQUEST_ID_STORAGE_KEY) ?? "");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;
    if (!window.confirm("실제 샵플링 쇼핑몰별 가격을 즉시 수정합니다. goods_key를 확인했습니까?")) return;
    const formData = new FormData(event.currentTarget);
    setRunning(true); setResult(null); setActionsResult(null);
    try {
      const response = await fetch("/api/shopling-price-modify/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goods_key: formData.get("goods_key")?.toString() ?? "" }) });
      const data = await response.json(); setResult(data);
      if (typeof data.requestId === "string" && data.requestId) { setCurrentRequestId(data.requestId); window.localStorage.setItem(CURRENT_REQUEST_ID_STORAGE_KEY, data.requestId); }
    } catch (error) { setResult({ status: "error", message: error instanceof Error ? error.message : "실행 요청 중 오류가 발생했습니다." }); }
    finally { setRunning(false); }
  };

  const handleFetchActionsResult = async () => {
    if (fetchingResult) return;
    setFetchingResult(true);
    try {
      const url = currentRequestId ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(currentRequestId)}` : "/api/shopling-price-modify/actions-result";
      setActionsResult(await (await fetch(url)).json());
    } catch (error) { setActionsResult({ status: "error", message: error instanceof Error ? error.message : "최근 실행 결과를 가져오는 중 오류가 발생했습니다." }); }
    finally { setFetchingResult(false); }
  };

  return <div className="space-y-6">
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <label className="block text-sm font-semibold text-slate-800">샵플링 goods_key
        <textarea name="goods_key" placeholder="예: 121031 또는 121031,121044,121045" required className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <span className="mt-2 block text-xs font-normal text-slate-500">쉼표, 공백, 줄바꿈으로 여러 goods_key를 입력할 수 있습니다.</span>
      </label>
      <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">goods_key 기준으로 24개 쇼핑몰의 판매가/소비자가/매입가를 설정합니다.</p>
      <PricePolicyGuide />
      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700">이 기능은 실제 샵플링 쇼핑몰별 가격을 즉시 수정합니다. goods_key를 확인한 뒤 실행하세요.</div>
      <button type="submit" disabled={running} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400">{running ? "실행 요청 중..." : "가격설정 실행"}</button>
    </form>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">실행 결과</h2>
      {result ? <dl className="mt-4 grid gap-3 text-sm">
        <ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} />
        <ResultRow label="요청 추적 ID" value={result.requestId ?? currentRequestId ?? "-"} mono />
        {result.githubActionsUrl ? <LinkRow label="githubActionsUrl" href={result.githubActionsUrl} /> : null}
        <ResultRow label="commandPreview" value={result.commandPreview ?? "-"} mono />
        {result.message ? <ResultRow label="message" value={result.message} /> : null}
        {result.status === "queued" ? <p className="rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-700">실제 완료 여부는 GitHub Actions 실행이 끝난 뒤 ‘최근 실행 결과 가져오기’로 확인하세요.</p> : null}
      </dl> : <p className="mt-3 text-sm text-slate-500">아직 실행 결과가 없습니다.</p>}
      <button type="button" onClick={handleFetchActionsResult} disabled={fetchingResult} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400">{fetchingResult ? "결과 가져오는 중..." : "최근 실행 결과 가져오기"}</button>
      {actionsResult ? <ActionsResultPanel result={actionsResult} currentRequestId={currentRequestId} /> : null}
    </section>
  </div>;
}

function PricePolicyGuide() {
  return <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
    <h2 className="text-base font-bold text-slate-950">적용 쇼핑몰 및 가격 정책</h2>
    <p className="mt-2 text-slate-600">아래 24개 쇼핑몰에 대해 쇼핑몰별 판매가/소비자가/매입가가 설정됩니다.</p>
    <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-700">
      <li>카페24(1.9): 기본 판매가 × 0.97 후 10원 단위 올림</li>
      <li>도매창고: 기본 판매가 + 500원</li>
      <li>에이블리: 기본 판매가 + 3,000원</li>
      <li>그 외 쇼핑몰: 기본 판매가 그대로 적용</li>
      <li>소비자가/매입가는 기본 상품 정보 값을 쇼핑몰별 필드에 복사</li>
    </ul>
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs sm:text-sm">
        <thead>
          <tr className="bg-white text-left text-slate-700">
            <th className="whitespace-nowrap border border-slate-200 px-3 py-2 font-semibold">mall_key</th>
            <th className="whitespace-nowrap border border-slate-200 px-3 py-2 font-semibold">쇼핑몰명</th>
            <th className="whitespace-nowrap border border-slate-200 px-3 py-2 font-semibold">가격 정책</th>
          </tr>
        </thead>
        <tbody>
          {PRICE_POLICY_MALLS.map(([mallKey, mallName, policy]) => <tr key={mallKey} className="bg-white odd:bg-slate-50/60">
            <td className="whitespace-nowrap border border-slate-200 px-3 py-2 font-mono text-slate-900">{mallKey}</td>
            <td className="whitespace-nowrap border border-slate-200 px-3 py-2 font-medium text-slate-900">{mallName}</td>
            <td className="whitespace-nowrap border border-slate-200 px-3 py-2 text-slate-700">{policy}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-800">이 표는 현재 price modify 엔진의 적용 대상 기준입니다. 샵플링 전체 쇼핑몰 목록이 아니라 실제 가격설정 스크립트가 수정하는 24개 쇼핑몰만 표시합니다.</p>
  </section>;
}

function ActionsResultPanel({ result, currentRequestId }: { result: ActionsResult; currentRequestId: string }) {
  const summary = result.summary; const errors = Array.isArray(summary?.errors) ? summary.errors : []; const displayRequestId = summary?.request_id ?? result.requestId ?? currentRequestId ?? "-";
  return <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-base font-bold text-slate-950">최근 GitHub Actions 실행 결과</h3>{result.message ? <p className="mt-2 text-sm font-medium text-slate-700">{result.message}</p> : null}
    <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="GitHub Actions 실행 상태" value={`${result.runStatus ?? result.status ?? "-"} / ${result.runConclusion ?? "-"}`} /><LinkRow label="GitHub Actions 실행 링크" href={result.runUrl} /><ResultRow label="요청 추적 ID" value={displayRequestId} mono /><ResultRow label="goods_key_count" value={String(summary?.goods_key_count ?? "-")} /><ResultRow label="estimated_mall_update_count" value={String(summary?.estimated_mall_update_count ?? "-")} /><ResultRow label="batch" value={String(summary?.batch ?? "-")} /><ResultRow label="status" value={String(summary?.status ?? "-")} /><ResultRow label="exit_code" value={String(summary?.exit_code ?? "-")} /><ResultRow label="성공 수" value={String(summary?.ok_count ?? "-")} /><ResultRow label="실패 수" value={String(summary?.fail_count ?? "-")} /></dl>
    <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-white text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">idx</th><th className="border border-slate-200 px-3 py-2">mall</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">msg</th></tr></thead><tbody>{errors.length > 0 ? errors.map((row, index) => <tr key={`${row.idx ?? index}-${row.mall ?? ""}-${row.goods_key ?? ""}`} className="bg-white"><td className="border border-slate-200 px-3 py-2">{row.idx ?? index + 1}</td><td className="border border-slate-200 px-3 py-2">{row.mall ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{row.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{row.msg ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={5}>실패 항목이 없습니다.</td></tr>}</tbody></table></div>
  </div>;
}
function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[200px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd></div>; }
function LinkRow({ label, href }: { label: string; href?: string }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[200px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd>{href ? <a className="text-blue-700 underline" href={href} target="_blank" rel="noreferrer">{href}</a> : "-"}</dd></div>; }
