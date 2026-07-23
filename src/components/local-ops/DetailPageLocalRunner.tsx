"use client";

import { FormEvent, useCallback, useState } from "react";
import { LocalBridgeStatus } from "./LocalBridgeStatus";
import { defaultBaseUrl, normalizeLocalBridgeBaseUrl } from "@/lib/localOpsBridgeConfig";

type RunResult = {
  run_id?: string;
  status?: string;
  progress?: number;
  production_ready?: boolean;
  full_image_ready?: boolean;
  full_image_width?: number;
  full_image_format?: string;
  copy_quality_score?: number;
  source_image_count?: number;
  blocker_reasons?: string[];
  warnings?: string[];
  shopling_html?: string;
  full_image_url?: string;
  full_image_path?: string;
  preview_url?: string;
  report_json_url?: string;
};

async function pollRun(baseUrl: string, runId: string, onResult: (result: RunResult) => void) {
  for (let i = 0; i < 120; i += 1) {
    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`);
    const json = (await response.json()) as RunResult;
    onResult(json);
    if (["completed", "failed", "blocked", "cancelled"].includes(String(json.status))) return json;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function bridgeFileUrl(baseUrl: string, path?: string) {
  if (!path) return "";
  return `${baseUrl}/files?path=${encodeURIComponent(path)}`;
}

export function DetailPageLocalRunner({ mode }: { mode: "source-link" | "upload-images" }) {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("아직 실행 전입니다.");
  const [result, setResult] = useState<RunResult | null>(null);

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("로컬 브릿지에 실행 요청 중...");
    setResult(null);
    const form = new FormData(event.currentTarget);
    const url = normalizeLocalBridgeBaseUrl(baseUrl);
    try {
      const response = await fetch(`${url}${mode === "source-link" ? "/runs/source-link" : "/runs/upload-images"}`, {
        method: "POST",
        body: mode === "source-link" ? JSON.stringify(Object.fromEntries(form.entries())) : form,
        headers: mode === "source-link" ? { "Content-Type": "application/json" } : undefined,
      });
      const json = (await response.json()) as RunResult;
      const runId = json.run_id;
      setResult(json);
      if (!response.ok || !runId) throw new Error(json.status ?? "run_id가 없습니다.");
      setStatus(`실행 중: ${runId}`);
      await pollRun(url, runId, (next) => { setResult(next); setStatus(`상태: ${next.status ?? "확인 중"}`); });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "실행 요청 실패");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, mode]);

  return (
    <div className="space-y-6">
      <LocalBridgeStatus onBaseUrlChange={setBaseUrl} />
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          {mode === "source-link" ? <SourceLinkFields /> : <ImageUploadFields />}
        </div>
        <button type="submit" disabled={busy} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">
          {busy ? "실행 중..." : "실행"}
        </button>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">진행 상태</h2><p className="mt-2 text-sm text-slate-600">{status}</p>{result?.progress ? <p className="mt-2 text-sm">진행률: {result.progress}%</p> : null}</section>
      <ResultPanel result={result} baseUrl={baseUrl} />
    </div>
  );
}

function SourceLinkFields() { return <><Input name="source_link" label="1688 상품 링크" required /><Input name="product_code" label="상품코드" /><label className="md:col-span-2 text-sm font-semibold">보조 링크<textarea name="supporting_links" className="mt-2 min-h-24 w-full rounded-lg border px-3 py-2" /></label><Input name="option_color_memo" label="옵션/색상 메모" /><label className="md:col-span-2 text-sm font-semibold">기획 메모<textarea name="planning_memo" className="mt-2 min-h-28 w-full rounded-lg border px-3 py-2" /></label></>; }
function ImageUploadFields() { return <><Input name="product_name" label="상품명" required /><Input name="product_code" label="상품코드" /><Input name="category_hint" label="카테고리 힌트" /><Input name="option_color_info" label="옵션/색상 정보" /><label className="md:col-span-2 text-sm font-semibold">기획 메모<textarea name="planning_memo" className="mt-2 min-h-28 w-full rounded-lg border px-3 py-2" /></label><label className="md:col-span-2 text-sm font-semibold">상세페이지 이미지 다중 업로드<input name="images" type="file" multiple accept="image/*" className="mt-2 block w-full rounded-lg border px-3 py-2" /></label></>; }
function Input(props: { name: string; label: string; required?: boolean }) { return <label className="text-sm font-semibold">{props.label}<input name={props.name} required={props.required} className="mt-2 w-full rounded-lg border px-3 py-2" /></label>; }

export function ResultPanel({ result, baseUrl }: { result: RunResult | null; baseUrl: string }) {
  const canCopy = Boolean(result?.production_ready && result.full_image_ready && result.shopling_html);
  const imageUrl = result?.full_image_url || bridgeFileUrl(baseUrl, result?.full_image_path);
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">실행 결과</h2>{!result ? <p className="mt-2 text-sm text-slate-500">결과가 없습니다.</p> : <><div className="mt-4 flex flex-wrap gap-2"><Badge ok={result.production_ready} label="production_ready" /><Badge ok={result.full_image_ready} label="full_image_ready" /></div><dl className="mt-4 grid gap-2 text-sm md:grid-cols-2"><Row k="full_image_width" v={result.full_image_width} /><Row k="full_image_format" v={result.full_image_format} /><Row k="copy_quality_score" v={result.copy_quality_score} /><Row k="source_image_count" v={result.source_image_count} /><Row k="blocker_reasons" v={result.blocker_reasons?.join(", ")} /><Row k="warnings" v={result.warnings?.join(", ")} /></dl>{!canCopy ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">이미지 수집 또는 최종 JPG 생성이 완료되지 않아 샵플링 HTML을 복사할 수 없습니다.</p> : null}<div className="mt-4 flex flex-wrap gap-2"><button disabled={!canCopy} onClick={() => navigator.clipboard.writeText(result.shopling_html ?? "")} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:bg-slate-300">샵플링 HTML 복사</button><button disabled={!canCopy || !imageUrl} onClick={() => navigator.clipboard.writeText(imageUrl)} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:bg-slate-300">이미지 주소 복사</button>{imageUrl ? <a href={imageUrl} target="_blank" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">JPG 열기</a> : null}{imageUrl ? <a href={imageUrl} download className="rounded bg-blue-600 px-3 py-2 text-sm text-white">JPG 다운로드</a> : null}{result.preview_url ? <a href={result.preview_url} target="_blank" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">미리보기 열기</a> : null}{result.report_json_url ? <a href={result.report_json_url} target="_blank" className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-700">report JSON 보기</a> : null}</div>{imageUrl ? <ImagePreview src={imageUrl} /> : result.shopling_html ? <iframe sandbox="" srcDoc={result.shopling_html} className="mt-5 h-[720px] w-full rounded border" title="샵플링 HTML 미리보기" /> : null}</>}</section>;
}
function Badge({ ok, label }: { ok?: boolean; label: string }) { return <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{label}: {ok ? "Y" : "N"}</span>; }
function Row({ k, v }: { k: string; v: unknown }) { return <div><dt className="font-semibold text-slate-700">{k}</dt><dd className="break-all text-slate-600">{v == null || v === "" ? "-" : String(v)}</dd></div>; }

function ImagePreview({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="상세페이지 JPG 미리보기" className="mt-5 max-h-[720px] rounded border object-contain" />;
}
