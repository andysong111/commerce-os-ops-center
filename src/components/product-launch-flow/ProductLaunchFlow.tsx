"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGoodsKeyGroupMap,
  buildKeywordEngineDispatchPayload,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  inferProductGroupFromPtnGoodsCd,
  type ProductLaunchPriceError,
  type ProductLaunchUploadRow,
} from "@/lib/productLaunchFlow";

const UPLOAD_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.uploadRequestId";
const PRICE_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.priceRequestId";
const LAST_ROW_EXPRESSION_STORAGE_KEY = "productLaunchFlow.lastRowExpression";
const KEYWORD_SEED_STORAGE_KEY = "productLaunchFlow.keywordSeed";
const KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY = "opsCenter.keywordEngine.importedArtifact.v1";
const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_MAX_POLLS = 24;

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; commandPreview?: string };
type UploadActionsResult = { status?: string; phase?: string; message?: string; requestId?: string; runId?: number; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: unknown };
type PriceActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: { status?: unknown; exit_code?: unknown; goods_key_count?: unknown; estimated_mall_update_count?: unknown; policy_override_count?: unknown; ok_count?: unknown; fail_count?: unknown; errors?: ProductLaunchPriceError[] } };
type KeywordArtifact = { id: number; name: string; expired?: boolean; expected?: boolean };
type KeywordRun = { id: number; status?: string | null; conclusion?: string | null; createdAt?: string; htmlUrl?: string; artifacts?: KeywordArtifact[] };
type KeywordRunsResult = { status?: string; message?: string; actionsUrl?: string; expectedArtifactName?: string; outputReviewRoute?: string; runs?: KeywordRun[] };
type KeywordDispatchResult = { repo?: string; workflowFile?: string; actionsUrl?: string; expectedArtifactName?: string; message?: string };

export function ProductLaunchFlow() {
  const [rowExpression, setRowExpression] = useState(() => getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY));
  const [uploadRequestId, setUploadRequestId] = useState(() => getStoredValue(UPLOAD_REQUEST_ID_STORAGE_KEY));
  const [priceRequestId, setPriceRequestId] = useState(() => getStoredValue(PRICE_REQUEST_ID_STORAGE_KEY));
  const [uploadRunning, setUploadRunning] = useState(false);
  const [uploadFetching, setUploadFetching] = useState(false);
  const [priceRunning, setPriceRunning] = useState(false);
  const [priceFetching, setPriceFetching] = useState(false);
  const [uploadRunResult, setUploadRunResult] = useState<RunResult | null>(null);
  const [uploadActionsResult, setUploadActionsResult] = useState<UploadActionsResult | null>(null);
  const [uploadPolling, setUploadPolling] = useState(false);
  const [uploadPollStartedAt, setUploadPollStartedAt] = useState<number | null>(null);
  const [uploadLastCheckedAt, setUploadLastCheckedAt] = useState<Date | null>(null);
  const [uploadPollCount, setUploadPollCount] = useState(0);
  const [uploadNextCheckIn, setUploadNextCheckIn] = useState(0);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const uploadPollCountRef = useRef(0);
  const [priceRunResult, setPriceRunResult] = useState<RunResult | null>(null);
  const [priceActionsResult, setPriceActionsResult] = useState<PriceActionsResult | null>(null);
  const [keywordSeed, setKeywordSeed] = useState(() => getStoredValue(KEYWORD_SEED_STORAGE_KEY));
  const [keywordPreview, setKeywordPreview] = useState<unknown>(null);
  const [keywordDispatchResult, setKeywordDispatchResult] = useState<KeywordDispatchResult | null>(null);
  const [keywordRunsResult, setKeywordRunsResult] = useState<KeywordRunsResult | null>(null);
  const [keywordImportMessage, setKeywordImportMessage] = useState<string>("");
  const [keywordBusy, setKeywordBusy] = useState<string>("");
  const [skipIfGoodsKey, setSkipIfGoodsKey] = useState(true);

  const uploadRows = useMemo(() => extractRowsWithGoodsKey(uploadActionsResult), [uploadActionsResult]);
  const goodsKeys = useMemo(() => dedupeGoodsKeysForPriceModify(uploadRows), [uploadRows]);
  const uploadPollingFinal = isFinalUploadPollingResult(uploadActionsResult, uploadRows.length);

  const pollUploadResult = useCallback(async (reset: boolean) => {
    if (uploadFetching) return;
    if (reset) {
      uploadPollCountRef.current = 0;
      setUploadPollCount(0);
      setUploadElapsedSeconds(0);
      setUploadPollStartedAt(Date.now());
      setUploadPolling(true);
      setUploadActionsResult({ status: "pending", phase: "request_sent", requestId: uploadRequestId, message: "상품업로드 결과 확인을 시작했습니다. 결과 파일이 준비되면 자동으로 다시 확인합니다." });
    }
    uploadPollCountRef.current += 1;
    setUploadPollCount(uploadPollCountRef.current);
    setUploadFetching(true);
    try {
      const url = uploadRequestId ? `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(uploadRequestId)}` : "/api/shopling-product-upload/actions-result";
      const data = await (await fetch(url)).json();
      setUploadActionsResult(data);
      const rows = extractRowsWithGoodsKey(data);
      const final = isFinalUploadPollingResult(data, rows.length);
      if (final || uploadPollCountRef.current >= UPLOAD_MAX_POLLS) {
        setUploadPolling(false);
        setUploadNextCheckIn(0);
      } else {
        setUploadNextCheckIn(UPLOAD_POLL_INTERVAL_MS / 1_000);
      }
    } catch (error) {
      setUploadActionsResult({ status: "error", phase: "unknown", requestId: uploadRequestId, message: error instanceof Error ? error.message : "상품업로드 결과를 가져오는 중 오류가 발생했습니다." });
      setUploadPolling(false);
      setUploadNextCheckIn(0);
    } finally {
      setUploadLastCheckedAt(new Date());
      setUploadFetching(false);
    }
  }, [uploadFetching, uploadRequestId]);

  useEffect(() => {
    if (!uploadPolling || uploadPollingFinal) return;
    const timer = window.setInterval(() => {
      setUploadNextCheckIn((current) => Math.max(0, current - 1));
      if (uploadPollStartedAt) setUploadElapsedSeconds(Math.max(0, Math.floor((Date.now() - uploadPollStartedAt) / 1_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [uploadPolling, uploadPollingFinal, uploadPollStartedAt]);

  useEffect(() => {
    if (!uploadPolling || uploadPollingFinal) return;
    if (uploadPollCount === 0 || uploadPollCount >= UPLOAD_MAX_POLLS || uploadFetching) return;
    const timer = window.setTimeout(() => {
      void pollUploadResult(false);
    }, UPLOAD_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [uploadPolling, uploadPollCount, uploadPollingFinal, uploadFetching, pollUploadResult]);

  const runUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploadRunning) return;
    setUploadRunning(true);
    setUploadRunResult(null);
    try {
      const response = await fetch("/api/shopling-product-upload/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowExpression, channel: "", skip_if_goods_key: skipIfGoodsKey, dump: false, sleep: "1.2" }),
      });
      const data = await response.json();
      setUploadRunResult(data);
      persistValue(LAST_ROW_EXPRESSION_STORAGE_KEY, rowExpression);
      if (typeof data.requestId === "string" && data.requestId) {
        setUploadRequestId(data.requestId);
        persistValue(UPLOAD_REQUEST_ID_STORAGE_KEY, data.requestId);
      }
    } catch (error) {
      setUploadRunResult({ status: "error", message: error instanceof Error ? error.message : "상품업로드 실행 요청 중 오류가 발생했습니다." });
    } finally {
      setUploadRunning(false);
    }
  };

  const fetchUploadResult = () => {
    void pollUploadResult(true);
  };

  const runPriceModify = async () => {
    if (priceRunning || goodsKeys.length === 0) return;
    setPriceRunning(true);
    setPriceRunResult(null);
    try {
      const response = await fetch("/api/shopling-price-modify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goods_key: goodsKeys.join(","), policy_overrides: [] }),
      });
      const data = await response.json();
      setPriceRunResult(data);
      if (typeof data.requestId === "string" && data.requestId) {
        setPriceRequestId(data.requestId);
        persistValue(PRICE_REQUEST_ID_STORAGE_KEY, data.requestId);
      }
    } catch (error) {
      setPriceRunResult({ status: "error", message: error instanceof Error ? error.message : "가격설정 실행 요청 중 오류가 발생했습니다." });
    } finally {
      setPriceRunning(false);
    }
  };

  const fetchPriceResult = async () => {
    if (priceFetching) return;
    setPriceFetching(true);
    try {
      const url = priceRequestId ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(priceRequestId)}` : "/api/shopling-price-modify/actions-result";
      setPriceActionsResult(await (await fetch(url)).json());
    } catch (error) {
      setPriceActionsResult({ status: "error", message: error instanceof Error ? error.message : "가격설정 결과를 가져오는 중 오류가 발생했습니다." });
    } finally {
      setPriceFetching(false);
    }
  };

  const keywordPayload = () => buildKeywordEngineDispatchPayload(uploadRows, keywordSeed);

  const previewKeywordDispatch = async () => {
    if (keywordBusy) return;
    setKeywordBusy("preview");
    setKeywordPreview(null);
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      const response = await fetch("/api/engine-runners/dispatch-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keywordPayload()) });
      setKeywordPreview(await response.json());
    } catch (error) {
      setKeywordPreview({ status: "error", message: error instanceof Error ? error.message : "키워드 엔진 입력값 확인 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  };

  const dispatchKeywordEngine = async () => {
    if (keywordBusy) return;
    setKeywordBusy("dispatch");
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      const response = await fetch("/api/engine-runners/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keywordPayload()) });
      setKeywordDispatchResult(await response.json());
    } catch (error) {
      setKeywordDispatchResult({ message: error instanceof Error ? error.message : "키워드 엔진 실행 요청 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  };

  const fetchKeywordRuns = async () => {
    if (keywordBusy) return;
    setKeywordBusy("runs");
    try {
      setKeywordRunsResult(await (await fetch("/api/engine-runners/runs?kind=keyword_engine")).json());
    } catch (error) {
      setKeywordRunsResult({ status: "error", message: error instanceof Error ? error.message : "키워드 실행 결과 확인 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  };

  const importKeywordArtifact = async (run: KeywordRun, artifact: KeywordArtifact) => {
    if (keywordBusy) return;
    setKeywordBusy(`import-${artifact.id}`);
    setKeywordImportMessage("");
    try {
      const response = await fetch("/api/engine-runners/artifacts/import-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "keyword_engine", runId: run.id, artifactId: artifact.id }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message ?? "키워드 결과 가져오기에 실패했습니다.");
      window.sessionStorage.setItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY, JSON.stringify({ kind: data.kind, source: data.source, files: data.files, generatedSourceFiles: data.generatedSourceFiles, goodsKeyGroupMap: buildGoodsKeyGroupMap(uploadRows), importedAt: new Date().toISOString(), notAppliedToShopling: true, notPublished: true, requiresHumanReview: true }));
      setKeywordImportMessage("키워드 결과를 검토 화면으로 가져왔습니다. 키워드 결과 검토 화면의 ‘상품 출시 플로우’를 Step 1부터 Step 5까지 순서대로 진행하세요.");
    } catch (error) {
      setKeywordImportMessage(error instanceof Error ? error.message : "키워드 결과 가져오기에 실패했습니다.");
    } finally { setKeywordBusy(""); }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={runUpload} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">Step 1. 상품업로드</h2>
        <label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행 번호
          <input value={rowExpression} onChange={(event) => setRowExpression(event.target.value)} placeholder="예: 950 또는 950-952 또는 950,951" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={skipIfGoodsKey} onChange={(event) => setSkipIfGoodsKey(event.target.checked)} className="size-4 rounded border-slate-300" />이미 goods_key 있으면 스킵</label>
        <p className="mt-1 text-xs text-slate-500">체크 해제하면 이미 goods_key가 있어도 상품업로드를 다시 실행합니다.</p>
        <p className="mt-3 text-sm text-slate-600">채널 선택 없이 도매1~도매4, 소매1~소매2 전체 6채널로 실행합니다.</p>
        <button type="submit" disabled={uploadRunning} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{uploadRunning ? "실행 요청 중..." : "상품업로드 실행"}</button>
        <button type="button" onClick={fetchUploadResult} disabled={uploadFetching || uploadPolling} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{uploadFetching || uploadPolling ? "확인 중..." : "상품업로드 결과 가져오기"}</button>
        <StatusBlock result={uploadRunResult} requestId={uploadRequestId} />
        <UploadActionsShortcut uploadActionsResult={uploadActionsResult} uploadRunResult={uploadRunResult} />
        <UploadPollingStatusCard result={uploadActionsResult} requestId={uploadRequestId} rowsWithGoodsKeyCount={uploadRows.length} polling={uploadPolling} fetching={uploadFetching} elapsedSeconds={uploadElapsedSeconds} lastCheckedAt={uploadLastCheckedAt} pollCount={uploadPollCount} maxPolls={UPLOAD_MAX_POLLS} nextCheckIn={uploadNextCheckIn} />
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">상품업로드 결과</h2>
        <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-800">상품그룹은 ptn_goods_cd 끝 글자 기준의 Commerce OS 내부 인식값입니다. 상품그룹 정의표에 suffix 한 줄을 추가하면 새 그룹을 확장할 수 있습니다. 샵플링 상품그룹 API를 수정하지 않습니다.</p>
        {uploadActionsResult?.message ? <p className="mt-3 text-sm text-slate-600">{uploadActionsResult.message}</p> : null}
        <UploadRowsTable rows={uploadRows} />
      </section>

      {goodsKeys.length > 0 ? <PriceSection goodsKeyCount={goodsKeys.length} result={priceRunResult} actionsResult={priceActionsResult} requestId={priceRequestId} running={priceRunning} fetching={priceFetching} onRun={runPriceModify} onFetch={fetchPriceResult} /> : null}
      {goodsKeys.length > 0 ? <KeywordPrepSection rows={uploadRows} goodsKeys={goodsKeys} seedKeyword={keywordSeed} onSeedKeywordChange={setKeywordSeed} preview={keywordPreview} dispatchResult={keywordDispatchResult} runsResult={keywordRunsResult} importMessage={keywordImportMessage} busy={keywordBusy} onPreview={previewKeywordDispatch} onDispatch={dispatchKeywordEngine} onFetchRuns={fetchKeywordRuns} onImport={importKeywordArtifact} /> : null}
      <FinalChecklist />
    </div>
  );
}

function UploadActionsShortcut({ uploadActionsResult, uploadRunResult }: { uploadActionsResult: UploadActionsResult | null; uploadRunResult: RunResult | null }) {
  const actionsUrl = uploadActionsResult?.runUrl ?? uploadRunResult?.githubActionsUrl;
  if (!actionsUrl) return null;
  return <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
    <p className="text-sm text-blue-900">문제가 있으면 실행 로그에서 실패 원인을 바로 확인할 수 있습니다.</p>
    <Link href={actionsUrl} className="mt-3 inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">GitHub Actions 바로가기</Link>
  </div>;
}

function UploadRowsTable({ rows }: { rows: ProductLaunchUploadRow[] }) {
  return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">행</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">채널</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">ptn_goods_cd</th></tr></thead><tbody>{rows.length > 0 ? rows.map((row, index) => <tr key={`${row.goods_key}-${index}`} className="bg-white"><td className="border border-slate-200 px-3 py-2">{row.row ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "").productGroup}</td><td className="border border-slate-200 px-3 py-2">{row.channel ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{row.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.ptn_goods_cd ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={6}>goods_key 결과가 없습니다.</td></tr>}</tbody></table></div>;
}

function UploadPollingStatusCard({ result, requestId, rowsWithGoodsKeyCount, polling, fetching, elapsedSeconds, lastCheckedAt, pollCount, maxPolls, nextCheckIn }: { result: UploadActionsResult | null; requestId: string; rowsWithGoodsKeyCount: number; polling: boolean; fetching: boolean; elapsedSeconds: number; lastCheckedAt: Date | null; pollCount: number; maxPolls: number; nextCheckIn: number }) {
  const state = getUploadPollingState(result, rowsWithGoodsKeyCount, polling, pollCount >= maxPolls);
  if (!result && !polling && pollCount === 0) return null;
  return <article className={`mt-5 rounded-2xl border p-4 ${state.cardClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className={`text-sm font-bold ${state.textClass}`}>{state.label}</p>
        <p className="mt-1 text-sm text-slate-700">{state.message}</p>
      </div>
      {state.showSpinner || fetching ? <span aria-label="확인 중" className="inline-flex size-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" /> : null}
    </div>
    <div className="mt-4 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
      <span>경과 시간: <strong>{formatElapsed(elapsedSeconds)}</strong></span>
      <span>마지막 확인: <strong>{lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"}</strong></span>
      <span>확인 횟수: <strong>{pollCount}/{maxPolls}</strong></span>
      <span>다음 자동 확인: <strong>{polling && !state.final ? `${nextCheckIn}초 후` : "-"}</strong></span>
    </div>
    <ol className="mt-4 grid gap-2 md:grid-cols-5">
      {["요청 전송", "GitHub Actions 실행 확인", "워크플로우 진행 중", "결과 artifact 확인 중", "OPS Center 결과 반영 완료"].map((step, index) => {
        const stepNumber = index + 1;
        const statusClass = stepNumber < state.currentStep ? "border-emerald-300 bg-emerald-50 text-emerald-800" : stepNumber === state.currentStep ? state.stepClass : "border-slate-200 bg-slate-50 text-slate-500";
        return <li key={step} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${statusClass}`}><span className="mr-1">{stepNumber}</span>{step}</li>;
      })}
    </ol>
    <div className="mt-4 flex flex-wrap gap-3 text-sm">
      {requestId || result?.requestId ? <span className="font-mono text-xs text-slate-600">request_id: {result?.requestId ?? requestId}</span> : null}
      {result?.runId ? <span className="font-mono text-xs text-slate-600">run_id: {result.runId}</span> : null}
      {result?.runUrl ? <Link href={result.runUrl} className="font-semibold text-blue-700 underline">GitHub Actions 로그 확인</Link> : null}
    </div>
    {state.showDetails ? <UploadPollingErrorDetails result={result} requestId={requestId} /> : null}
  </article>;
}

function getUploadPollingState(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number, polling: boolean, timedOut: boolean) {
  if (timedOut && !isFinalUploadPollingResult(result, rowsWithGoodsKeyCount)) return { label: "자동 확인 시간 초과", message: "자동 확인 시간이 초과되었습니다. 잠시 후 다시 확인하거나 GitHub Actions 로그를 확인하세요.", currentStep: 4, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (isConfirmedUploadFailure(result)) return { label: "실패", message: result?.message ?? "상품업로드 실행이 실패했습니다. GitHub Actions 로그를 확인하세요.", currentStep: 3, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (result?.status === "error" && result?.phase === "completed_no_artifact") return { label: "결과 파일 없음", message: result.message ?? "현재 요청의 artifact에서 result_summary.json을 찾지 못했습니다.", currentStep: 4, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (result?.status === "error") return { label: "결과 확인 오류", message: "상품업로드 결과 확인 중 오류가 발생했습니다.", currentStep: 2, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (result?.status === "success" && rowsWithGoodsKeyCount > 0) return { label: "성공", message: "상품업로드가 완료되었습니다. goods_key를 확인했습니다.", currentStep: 5, final: true, showSpinner: false, showDetails: false, cardClass: "border-emerald-200 bg-emerald-50", textClass: "text-emerald-800", stepClass: "border-emerald-300 bg-emerald-100 text-emerald-800" };
  if (result?.status === "success") return { label: "성공 - goods_key 없음", message: "실행은 완료되었지만 goods_key 결과가 아직 없습니다.", currentStep: 5, final: true, showSpinner: false, showDetails: false, cardClass: "border-amber-200 bg-amber-50", textClass: "text-amber-800", stepClass: "border-amber-300 bg-amber-100 text-amber-900" };
  if (result?.phase === "waiting_artifact" || result?.phase === "completed_no_artifact") return { label: "결과 파일 대기", message: "현재 요청의 실행은 확인됐고, 결과 파일을 기다리는 중입니다.", currentStep: 4, final: false, showSpinner: true, showDetails: false, cardClass: "border-amber-200 bg-amber-50", textClass: "text-amber-800", stepClass: "border-amber-300 bg-amber-100 text-amber-900 animate-pulse" };
  if (result?.phase === "queued" || result?.phase === "running" || result?.runStatus === "queued" || result?.runStatus === "in_progress") return { label: "진행 중", message: "상품업로드가 아직 진행 중입니다. 결과 파일이 준비되면 자동으로 다시 확인합니다.", currentStep: 3, final: false, showSpinner: true, showDetails: false, cardClass: "border-blue-200 bg-blue-50", textClass: "text-blue-800", stepClass: "border-blue-300 bg-blue-100 text-blue-800 animate-pulse" };
  return { label: polling ? "GitHub Actions 확인 중" : "결과 확인 대기", message: "현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다.", currentStep: 2, final: false, showSpinner: polling, showDetails: false, cardClass: "border-blue-200 bg-blue-50", textClass: "text-blue-800", stepClass: "border-blue-300 bg-blue-100 text-blue-800 animate-pulse" };
}

function UploadPollingErrorDetails({ result, requestId }: { result: UploadActionsResult | null; requestId: string }) {
  return <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-slate-800"><p className="font-bold text-red-700">상세 오류</p><dl className="mt-2 grid gap-1"><ResultRow label="message" value={result?.message ?? "-"} /><ResultRow label="requestId" value={result?.requestId ?? requestId ?? "-"} mono />{result?.runId ? <ResultRow label="runId" value={result.runId} mono /> : null}{result?.runUrl ? <ResultRow label="runUrl" value={result.runUrl} /> : null}</dl></div>;
}

function isConfirmedUploadFailure(result: UploadActionsResult | null) {
  if (!result) return false;
  const confirmedConclusion = result.runStatus === "completed" && ["failure", "cancelled", "timed_out"].includes(String(result.runConclusion ?? ""));
  const backendConfirmedFailure = result.phase === "failed" && (!!result.runId || !!result.runUrl);
  return confirmedConclusion || backendConfirmedFailure;
}

function isFinalUploadPollingResult(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number) {
  return isConfirmedUploadFailure(result) || result?.status === "success" || rowsWithGoodsKeyCount > 0;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${rest}초`;
}

function PriceSection({ goodsKeyCount, result, actionsResult, requestId, running, fetching, onRun, onFetch }: { goodsKeyCount: number; result: RunResult | null; actionsResult: PriceActionsResult | null; requestId: string; running: boolean; fetching: boolean; onRun: () => void; onFetch: () => void }) {
  const summary = actionsResult?.summary;
  const errors = Array.isArray(summary?.errors) ? summary.errors : [];
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Step 2. 가격설정</h2><p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeyCount}</strong></p><p className="mt-1 text-sm text-slate-700">예상 쇼핑몰 가격설정 대상 수 = goods_key count × 24: <strong>{goodsKeyCount * 24}</strong></p><button type="button" onClick={onRun} disabled={running} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{running ? "실행 요청 중..." : "가격설정 실행"}</button><button type="button" onClick={onFetch} disabled={fetching} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{fetching ? "가져오는 중..." : "가격설정 결과 가져오기"}</button><StatusBlock result={result} requestId={requestId} />{actionsResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="status" value={String(summary?.status ?? actionsResult.status ?? "-")} /><ResultRow label="exit_code" value={String(summary?.exit_code ?? "-")} /><ResultRow label="goods_key_count" value={String(summary?.goods_key_count ?? "-")} /><ResultRow label="estimated_mall_update_count" value={String(summary?.estimated_mall_update_count ?? "-")} /><ResultRow label="policy_override_count" value={String(summary?.policy_override_count ?? 0)} /><ResultRow label="성공 수" value={String(summary?.ok_count ?? "-")} /><ResultRow label="실패 수" value={String(summary?.fail_count ?? "-")} /></dl> : null}<ErrorsTable errors={errors} /></section>;
}

function KeywordPrepSection({ rows, goodsKeys, seedKeyword, onSeedKeywordChange, preview, dispatchResult, runsResult, importMessage, busy, onPreview, onDispatch, onFetchRuns, onImport }: { rows: ProductLaunchUploadRow[]; goodsKeys: string[]; seedKeyword: string; onSeedKeywordChange: (value: string) => void; preview: unknown; dispatchResult: KeywordDispatchResult | null; runsResult: KeywordRunsResult | null; importMessage: string; busy: string; onPreview: () => void; onDispatch: () => void; onFetchRuns: () => void; onImport: (run: KeywordRun, artifact: KeywordArtifact) => void }) {
  const latestRunWithArtifact = runsResult?.runs?.find((run) => run.artifacts?.some((artifact) => artifact.expected && !artifact.expired));
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Step 3. 상품명/키워드 실행 및 검토</h2><p className="mt-3 text-sm text-slate-700">현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용하는 기준으로 준비합니다.</p><p className="mt-1 text-sm text-slate-700">키워드 엔진은 dry_run으로만 실행되며, 결과는 키워드 결과 검토 화면에서 사람이 확인합니다.</p><p className="mt-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">키워드/상품명 결과는 샵플링에 자동 반영되지 않습니다. 검토 화면에서 확인 후 별도 승인해야 합니다.</p><p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeys.length}</strong></p><p className="mt-1 break-all font-mono text-xs text-slate-700">goods_key CSV preview: {goodsKeys.join(",")}</p><label className="mt-4 block text-sm font-semibold text-slate-800">시드 키워드<input value={seedKeyword} onChange={(event) => onSeedKeywordChange(event.target.value)} placeholder="예: 욕실 수납, 주방 정리, 차량용 수납" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><p className="mt-1 text-xs text-slate-600">비워두면 goods_key 기준으로 키워드 엔진이 자동 진행합니다.</p><UploadRowsTable rows={rows} /><div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={onPreview} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 입력값 확인</button><button type="button" onClick={onDispatch} disabled={!!busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 실행</button><button type="button" onClick={onFetchRuns} disabled={!!busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100">키워드 실행 결과 확인</button></div>{preview ? <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{JSON.stringify(preview, null, 2)}</pre> : null}{dispatchResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="repo" value={dispatchResult.repo ?? "-"} /><ResultRow label="workflowFile" value={dispatchResult.workflowFile ?? "-"} /><ResultRow label="actionsUrl" value={dispatchResult.actionsUrl ?? "-"} /><ResultRow label="expectedArtifactName" value={dispatchResult.expectedArtifactName ?? "-"} /><ResultRow label="message" value="키워드 엔진 실행을 요청했습니다. 몇 초 뒤 실행 결과 확인을 눌러주세요." /></dl> : null}{runsResult?.message ? <p className="mt-3 text-sm text-slate-600">{runsResult.message}</p> : null}{latestRunWithArtifact ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">가져올 결과물이 있는 최신 실행을 우선 표시합니다.</p> : null}<div className="mt-4 space-y-3">{runsResult?.runs?.map((run) => { const expectedArtifact = run.artifacts?.find((artifact) => artifact.expected); return <article key={run.id} className="rounded-lg border border-slate-200 p-4 text-sm"><div className="flex flex-wrap gap-3"><span>run id: <strong>{run.id}</strong></span><span>status: {run.status ?? "-"}</span><span>conclusion: {run.conclusion ?? "-"}</span><span>createdAt: {run.createdAt ?? "-"}</span>{run.htmlUrl ? <Link href={run.htmlUrl} className="font-semibold text-blue-700 underline">GitHub Actions link</Link> : null}</div><p className={expectedArtifact ? "mt-2 font-semibold text-emerald-700" : "mt-2 text-slate-600"}>{expectedArtifact ? `expected artifact exists: ${expectedArtifact.name}` : "expected artifact exists: no"}</p>{expectedArtifact ? <button type="button" onClick={() => onImport(run, expectedArtifact)} disabled={!!busy || expectedArtifact.expired} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">결과 가져오기 및 검토 시작</button> : null}</article>; })}</div>{importMessage ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{importMessage}</p> : null}{importMessage ? <Link href="/keyword-review-queue?from=product-launch-flow" className="mt-3 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">키워드 결과 검토 화면 열기</Link> : null}</section>;
}

function FinalChecklist() { const items = ["상품업로드 결과 확인", "goods_key 6개 확인", "ptn_goods_cd suffix 기반 상품그룹 인식 확인", "가격설정 완료 확인", "상품명/키워드 단계는 MVP 기준 동일 적용 예정", "샵플링 마켓전송은 수동으로 진행"]; return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><h2 className="text-lg font-bold text-amber-950">최종 체크리스트</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{items.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold text-red-700">마켓전송은 현재 OPS Center에서 자동 실행하지 않습니다. 샵플링 관리자에서 최종 확인 후 직접 전송하세요.</p></section>; }
function ErrorsTable({ errors }: { errors: ProductLaunchPriceError[] }) { return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">idx</th><th className="border border-slate-200 px-3 py-2">mall</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">msg</th></tr></thead><tbody>{errors.length > 0 ? errors.map((error, index) => <tr key={`${error.goods_key}-${index}`}><td className="border border-slate-200 px-3 py-2">{error.idx ?? index + 1}</td><td className="border border-slate-200 px-3 py-2">{error.mall ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{error.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.msg ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={5}>실패 항목이 없습니다.</td></tr>}</tbody></table></div>; }
function StatusBlock({ result, requestId }: { result: RunResult | null; requestId: string }) { return result ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} /><ResultRow label="요청 추적 ID" value={result.requestId ?? requestId ?? "-"} mono />{result.commandPreview ? <ResultRow label="commandPreview" value={result.commandPreview} mono /> : null}{result.githubActionsUrl ? <ResultRow label="githubActionsUrl" value={result.githubActionsUrl} /> : null}{result.message ? <ResultRow label="message" value={result.message} /> : null}</dl> : null; }
function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd></div>; }
function getStoredValue(key: string) { if (typeof window === "undefined") return ""; return window.localStorage.getItem(key) ?? ""; }
function persistValue(key: string, value: string) { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
