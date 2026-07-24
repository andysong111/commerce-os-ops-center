"use client";

import { FormEvent, useCallback, useState } from "react";
import { LocalBridgeStatus } from "./LocalBridgeStatus";
import { defaultBaseUrl, normalizeLocalBridgeBaseUrl } from "@/lib/localOpsBridgeConfig";

type RunLogs = {
  error_text?: string;
  log_text?: string;
  diagnostic_files?: string[];
  status_json?: unknown;
};

type RunResult = {
  run_id?: string;
  status?: string;
  step?: string;
  message?: string;
  product_dir?: string;
  outer_status?: string;
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
  product_code?: string;
  report_json_url?: string;
  result?: unknown;
};

export function normalizeRunResult(payload: RunResult): RunResult {
  if (payload?.result && typeof payload.result === "object" && !Array.isArray(payload.result)) {
    const nested = payload.result as RunResult;
    return {
      ...nested,
      run_id: payload.run_id ?? nested.run_id,
      status: payload.status ?? nested.status,
      step: payload.step,
      message: payload.message,
      product_dir: payload.product_dir,
      outer_status: payload.status,
    };
  }

  return payload;
}

async function fetchRunResult(baseUrl: string, runId: string) {
  const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/result`);
  if (!response.ok) throw new Error("실행 결과를 불러오지 못했습니다.");
  return normalizeRunResult((await response.json()) as RunResult);
}

async function refreshRunResult(baseUrl: string, runId: string) {
  const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error("실행 상태를 불러오지 못했습니다.");
  const statusResult = normalizeRunResult((await response.json()) as RunResult);
  if (statusResult.status === "success") return fetchRunResult(baseUrl, runId);
  return statusResult;
}

async function pollRun(baseUrl: string, runId: string, onResult: (result: RunResult) => void) {
  for (let i = 0; i < 120; i += 1) {
    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`);
    const json = normalizeRunResult((await response.json()) as RunResult);
    onResult(json);
    if (json.status === "success") {
      const finalResult = await fetchRunResult(baseUrl, runId);
      onResult(finalResult);
      return finalResult;
    }
    if (["completed", "failed", "blocked", "cancelled"].includes(String(json.status))) return json;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function fetchRunLogs(baseUrl: string, runId: string) {
  const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/logs`);
  if (!response.ok) throw new Error("실패 로그를 불러오지 못했습니다.");
  return (await response.json()) as RunLogs;
}

function buildSafeJpgFilename(result: RunResult) {
  const rawIdentifier = result.product_code || result.run_id || "local";
  const safeIdentifier = rawIdentifier.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "local";
  return `detailpage_${safeIdentifier}_1000.jpg`;
}

async function downloadJpg(finalImageUrl: string, filename: string) {
  const response = await fetch(finalImageUrl);
  if (!response.ok) throw new Error("download failed");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function isFailureStatus(status?: string) {
  return ["failed", "blocked", "cancelled"].includes(String(status));
}

function bridgeFileUrl(baseUrl: string, path?: string) {
  if (!path) return "";
  return `${baseUrl}/files?path=${encodeURIComponent(path)}`;
}

function localTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function buildSourceLinkProductCode(sourceLink: string) {
  const offerId = sourceLink.match(/\/offer\/(\d+)/)?.[1];
  return offerId ? `DP-${offerId}` : `DP-local-${localTimestamp()}`;
}

export function DetailPageLocalRunner({ mode }: { mode: "source-link" | "upload-images" }) {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("아직 실행 전입니다.");
  const [result, setResult] = useState<RunResult | null>(null);
  const [runLogs, setRunLogs] = useState<RunLogs | null>(null);

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("로컬 브릿지에 실행 요청 중...");
    setResult(null);
    setRunLogs(null);
    const form = new FormData(event.currentTarget);
    const url = normalizeLocalBridgeBaseUrl(baseUrl);
    const sourceLink = String(form.get("source_link") ?? "");
    const sourceLinkPayload = {
      source_link: sourceLink,
      product_code: buildSourceLinkProductCode(sourceLink),
      source_links: "",
      option_info: "",
      planning_point: "",
      target: "",
    };

    if (mode === "upload-images") {
      form.set("product_code", `IMG-local-${localTimestamp()}`);
      form.set("product_name", "");
      form.set("category_hint", "");
      form.set("option_info", "");
      form.set("planning_point", "");
      form.set("target", "");
    }

    try {
      const response = await fetch(`${url}${mode === "source-link" ? "/runs/source-link" : "/runs/upload-images"}`, {
        method: "POST",
        body: mode === "source-link" ? JSON.stringify(sourceLinkPayload) : form,
        headers: mode === "source-link" ? { "Content-Type": "application/json" } : undefined,
      });
      const json = normalizeRunResult((await response.json()) as RunResult);
      const runId = json.run_id;
      setResult(json);
      if (!response.ok || !runId) throw new Error(json.status ?? "run_id가 없습니다.");
      setStatus(`실행 중: ${runId}`);
      const finalResult = await pollRun(url, runId, (next) => { setResult(next); setStatus(`상태: ${next.status ?? "확인 중"}`); });
      if (finalResult?.run_id && isFailureStatus(finalResult.status)) {
        const logs = await fetchRunLogs(url, finalResult.run_id);
        setRunLogs(logs);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "실행 요청 실패");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, mode]);

  const runId = result?.run_id;

  const refreshResult = useCallback(async () => {
    if (!runId) return;
    setBusy(true);
    setStatus("결과를 다시 불러오는 중...");
    try {
      const refreshed = await refreshRunResult(normalizeLocalBridgeBaseUrl(baseUrl), runId);
      setResult(refreshed);
      setStatus(`상태: ${refreshed.status ?? "확인 중"}`);
      if (refreshed.run_id && isFailureStatus(refreshed.status)) {
        const logs = await fetchRunLogs(normalizeLocalBridgeBaseUrl(baseUrl), refreshed.run_id);
        setRunLogs(logs);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "결과 새로고침 실패");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, runId]);

  return (
    <div className="space-y-6">
      <LocalBridgeStatus onBaseUrlChange={setBaseUrl} />
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          {mode === "source-link" ? <SourceLinkFields /> : <ImageUploadFields />}
        </div>
        <button type="submit" disabled={busy} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">
          {busy ? "실행 중..." : "실행"}
        </button>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">진행 상태</h2><p className="mt-2 text-sm text-slate-600">{status}</p>{result?.progress ? <p className="mt-2 text-sm">진행률: {result.progress}%</p> : null}</section>
      <ResultPanel result={result} runLogs={runLogs} baseUrl={baseUrl} onRefresh={refreshResult} refreshDisabled={busy || !runId} />
    </div>
  );
}

function SourceLinkFields() { return <><p className="text-sm text-slate-600">1688 상품 링크만 넣고 실행하면 승준컴 로컬 브릿지가 상세페이지를 생성합니다.</p><Input name="source_link" label="1688 상품 링크" required /></>; }
function ImageUploadFields() { return <><p className="text-sm text-slate-600">상세페이지 이미지만 업로드하면 로컬 브릿지가 이미지 기반 상세페이지를 생성합니다.</p><label className="text-sm font-semibold">상세페이지 이미지 업로드<input name="images" type="file" multiple accept="image/*" className="mt-2 block w-full rounded-lg border px-3 py-2" /></label></>; }
function Input(props: { name: string; label: string; required?: boolean }) { return <label className="text-sm font-semibold">{props.label}<input name={props.name} required={props.required} className="mt-2 w-full rounded-lg border px-3 py-2" /></label>; }

export function ResultPanel({ result, runLogs, baseUrl, onRefresh, refreshDisabled }: { result: RunResult | null; runLogs: RunLogs | null; baseUrl: string; onRefresh: () => void; refreshDisabled: boolean }) {
  const [downloadWarning, setDownloadWarning] = useState("");
  const canCopy = Boolean(result?.production_ready && result.full_image_ready && result.shopling_html);
  const finalImageUrl = result?.full_image_url || bridgeFileUrl(baseUrl, result?.full_image_path);

  const openJpgInNewTab = useCallback(() => {
    if (!finalImageUrl) return;
    window.open(finalImageUrl, "_blank", "noopener,noreferrer");
  }, [finalImageUrl]);

  const handleJpgDownload = useCallback(async () => {
    if (!result || !finalImageUrl) return;
    setDownloadWarning("");
    try {
      await downloadJpg(finalImageUrl, buildSafeJpgFilename(result));
    } catch {
      setDownloadWarning("브라우저 보안 정책 때문에 직접 다운로드가 실패했습니다. 새 탭에서 열린 이미지에서 저장해 주세요.");
      window.open(finalImageUrl, "_blank", "noopener,noreferrer");
    }
  }, [finalImageUrl, result]);

  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">실행 결과</h2><button type="button" onClick={onRefresh} disabled={refreshDisabled} className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 disabled:text-slate-300">결과 다시 불러오기</button></div>{!result ? <p className="mt-2 text-sm text-slate-500">결과가 없습니다.</p> : <><dl className="mt-4 grid gap-2 text-sm md:grid-cols-2"><Row k="run_id" v={result.run_id} /><Row k="status" v={result.status} /><Row k="step" v={result.step} /><Row k="message" v={result.message} /></dl><div className="mt-4 flex flex-wrap gap-2"><Badge ok={result.production_ready} label="production_ready" /><Badge ok={result.full_image_ready} label="full_image_ready" /></div><dl className="mt-4 grid gap-2 text-sm md:grid-cols-2"><Row k="product_dir" v={result.product_dir} /><Row k="outer_status" v={result.outer_status} /><Row k="full_image_width" v={result.full_image_width} /><Row k="full_image_format" v={result.full_image_format} /><Row k="copy_quality_score" v={result.copy_quality_score} /><Row k="source_image_count" v={result.source_image_count} /><Row k="blocker_reasons" v={result.blocker_reasons?.join(", ")} /><Row k="warnings" v={result.warnings?.join(", ")} /></dl>{!canCopy ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">이미지 수집 또는 최종 JPG 생성이 완료되지 않아 샵플링 HTML을 복사할 수 없습니다.</p> : null}<div className="mt-4 flex flex-wrap gap-2"><button disabled={!canCopy} onClick={() => navigator.clipboard.writeText(result.shopling_html ?? "")} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:bg-slate-300">샵플링 HTML 복사</button><button disabled={!canCopy || !finalImageUrl} onClick={() => navigator.clipboard.writeText(finalImageUrl)} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:bg-slate-300">이미지 주소 복사</button>{finalImageUrl ? <button type="button" onClick={openJpgInNewTab} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">JPG 새창 열기</button> : null}{finalImageUrl ? <button type="button" onClick={handleJpgDownload} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">JPG 다운로드</button> : null}{result.preview_url ? <a href={result.preview_url} target="_blank" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">미리보기 열기</a> : null}{result.report_json_url ? <a href={result.report_json_url} target="_blank" className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-700">report JSON 보기</a> : null}</div>{downloadWarning ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">{downloadWarning}</p> : null}{isFailureStatus(result.status) ? <FailureDiagnosticsCard result={result} runLogs={runLogs} /> : null}{finalImageUrl ? <ImagePreview src={finalImageUrl} /> : result.shopling_html ? <iframe sandbox="" srcDoc={result.shopling_html} className="mt-5 h-[720px] w-full rounded border" title="샵플링 HTML 미리보기" /> : null}</>}</section>;
}
function FailureDiagnosticsCard({ result, runLogs }: { result: RunResult; runLogs: RunLogs | null }) {
  const [open, setOpen] = useState(false);
  const statusJson = JSON.stringify(result, null, 2);
  const fullDiagnostics = [
    "[status_json]",
    statusJson,
    "[error_text]",
    runLogs?.error_text ?? "",
    "[log_text]",
    runLogs?.log_text ?? "",
    "[diagnostic_files]",
    ...(runLogs?.diagnostic_files ?? []),
  ].join("\n");
  return <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">실패 진단</h3><p className="mt-1 text-red-700">로컬 실행이 실패했습니다. 로그와 생성된 진단 파일을 확인하세요.</p></div><button type="button" onClick={() => setOpen((next) => !next)} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white">실패 로그 펼쳐보기</button></div><div className="mt-3 rounded-lg bg-white/70 p-3 text-xs text-red-800"><p><strong>힌트:</strong> image_hosting_map.json이 비었거나 누락되었는지, no_usable_source_images 또는 1688_auth_or_traffic_challenge 원인이 있는지 확인하세요.</p></div>{open ? <div className="mt-4 space-y-4"><div className="flex flex-wrap gap-2"><CopyButton text={fullDiagnostics} label="전체 진단 복사" /><CopyButton text={runLogs?.error_text ?? ""} label="에러 로그 복사" /><CopyButton text={statusJson} label="상태 JSON 복사" /></div><DiagnosticsBlock title="error_text" value={runLogs?.error_text} /><DiagnosticsBlock title="log_text" value={runLogs?.log_text} /><DiagnosticsBlock title="diagnostic_files" value={(runLogs?.diagnostic_files ?? []).join("\n")} /></div> : null}</div>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return <button type="button" disabled={!text} onClick={() => navigator.clipboard.writeText(text)} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-red-200">{label}</button>;
}

function DiagnosticsBlock({ title, value }: { title: string; value?: string }) {
  return <div><h4 className="font-semibold">{title}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-800">{value || "-"}</pre></div>;
}

function Badge({ ok, label }: { ok?: boolean; label: string }) { return <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{label}: {ok ? "Y" : "N"}</span>; }
function Row({ k, v }: { k: string; v: unknown }) { return <div><dt className="font-semibold text-slate-700">{k}</dt><dd className="break-all text-slate-600">{v == null || v === "" ? "-" : String(v)}</dd></div>; }

function ImagePreview({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="상세페이지 JPG 미리보기" className="mt-5 max-h-[720px] rounded border object-contain" />;
}
