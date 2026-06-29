"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGoodsKeyGroupMap,
  buildKeywordEngineDispatchPayload,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  extractUploadRows,
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
const ACTIVE_POLL_INTERVAL_MS = 5_000;
const ACTIVE_MAX_POLLS = 24;

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; commandPreview?: string };
type UploadSummary = { status?: unknown; rows?: ProductLaunchUploadRow[]; goods_keys?: ProductLaunchUploadRow[] };
type UploadActionsResult = { status?: string; phase?: string; message?: string; requestId?: string; runId?: number; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: UploadSummary | unknown };
type PriceActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: { status?: unknown; exit_code?: unknown; goods_key_count?: unknown; estimated_mall_update_count?: unknown; policy_override_count?: unknown; ok_count?: unknown; fail_count?: unknown; failed_count?: unknown; not_applied_count?: unknown; blank_risk_count?: unknown; affected_malls?: unknown; errors?: ProductLaunchPriceError[] } };
type KeywordArtifact = { id: number; name: string; expired?: boolean; expected?: boolean };
type KeywordRun = { id: number; status?: string | null; conclusion?: string | null; createdAt?: string; htmlUrl?: string; artifacts?: KeywordArtifact[] };
type KeywordRunsResult = { status?: string; message?: string; actionsUrl?: string; expectedArtifactName?: string; outputReviewRoute?: string; runs?: KeywordRun[] };
type KeywordDispatchResult = { repo?: string; workflowFile?: string; actionsUrl?: string; expectedArtifactName?: string; message?: string };

export function ProductLaunchFlow() {
  const [rowExpression, setRowExpression] = useState(() => getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY));
  const [lastStartedRowExpression, setLastStartedRowExpression] = useState(() => getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY));
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
  const [pricePolling, setPricePolling] = useState(false);
  const [pricePollCount, setPricePollCount] = useState(0);
  const [priceLastCheckedAt, setPriceLastCheckedAt] = useState<Date | null>(null);
  const [keywordSeed, setKeywordSeed] = useState(() => getStoredValue(KEYWORD_SEED_STORAGE_KEY));
  const [keywordPreview, setKeywordPreview] = useState<unknown>(null);
  const [keywordDispatchResult, setKeywordDispatchResult] = useState<KeywordDispatchResult | null>(null);
  const [keywordRunsResult, setKeywordRunsResult] = useState<KeywordRunsResult | null>(null);
  const [keywordImportMessage, setKeywordImportMessage] = useState<string>("");
  const [keywordBusy, setKeywordBusy] = useState<string>("");
  const [keywordPolling, setKeywordPolling] = useState(false);
  const [keywordPollCount, setKeywordPollCount] = useState(0);
  const [keywordLastCheckedAt, setKeywordLastCheckedAt] = useState<Date | null>(null);
  const [skipIfGoodsKey, setSkipIfGoodsKey] = useState(true);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);

  const uploadResultRows = useMemo(() => extractUploadRows(uploadActionsResult), [uploadActionsResult]);
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

  const runUploadRequest = async () => {
    if (uploadRunning || !rowExpression.trim()) return;
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
      setLastStartedRowExpression(rowExpression);
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

  const runUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runUploadRequest();
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
      setPricePolling(true);
      setPricePollCount(0);
    }
  };

  const fetchPriceResult = useCallback(async () => {
    if (priceFetching) return;
    setPriceFetching(true);
    try {
      const url = priceRequestId ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(priceRequestId)}` : "/api/shopling-price-modify/actions-result";
      const data = await (await fetch(url)).json();
      setPriceActionsResult(data);
      setPriceLastCheckedAt(new Date());
      if (isFinalPriceResult(data)) setPricePolling(false);
    } catch (error) {
      setPriceActionsResult({ status: "error", message: error instanceof Error ? error.message : "가격설정 결과를 가져오는 중 오류가 발생했습니다." });
    } finally {
      setPriceFetching(false);
    }
  }, [priceFetching, priceRequestId]);

  useEffect(() => {
    if (!pricePolling || priceFetching) return;
    if (pricePollCount >= ACTIVE_MAX_POLLS || isFinalPriceResult(priceActionsResult)) return;
    const timer = window.setTimeout(() => {
      setPricePollCount((count) => { const next = count + 1; if (next >= ACTIVE_MAX_POLLS) setPricePolling(false); return next; });
      void fetchPriceResult();
    }, pricePollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [pricePolling, priceFetching, pricePollCount, priceActionsResult, fetchPriceResult]);

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
      setKeywordPolling(true);
      setKeywordPollCount(0);
    } catch (error) {
      setKeywordDispatchResult({ message: error instanceof Error ? error.message : "키워드 엔진 실행 요청 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  };

  const fetchKeywordRuns = useCallback(async () => {
    if (keywordBusy) return;
    setKeywordBusy("runs");
    try {
      const data = await (await fetch("/api/engine-runners/runs?kind=keyword_engine")).json();
      setKeywordRunsResult(data);
      setKeywordLastCheckedAt(new Date());
      if (isFinalKeywordRuns(data)) setKeywordPolling(false);
    } catch (error) {
      setKeywordRunsResult({ status: "error", message: error instanceof Error ? error.message : "키워드 실행 결과 확인 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  }, [keywordBusy]);

  useEffect(() => {
    if (!keywordPolling || keywordBusy) return;
    if (keywordPollCount >= ACTIVE_MAX_POLLS || isFinalKeywordRuns(keywordRunsResult)) return;
    const timer = window.setTimeout(() => {
      setKeywordPollCount((count) => { const next = count + 1; if (next >= ACTIVE_MAX_POLLS) setKeywordPolling(false); return next; });
      void fetchKeywordRuns();
    }, keywordPollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [keywordPolling, keywordBusy, keywordPollCount, keywordRunsResult, fetchKeywordRuns]);

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

  const rowMatchesCurrentRun = rowExpression === lastStartedRowExpression;
  const currentUploadRequestId = rowMatchesCurrentRun ? uploadRequestId : "";
  const uploadGithubActionsUrl = currentUploadRequestId ? uploadActionsResult?.runUrl ?? uploadRunResult?.githubActionsUrl : undefined;
  const priceGithubActionsUrl = priceRunResult?.githubActionsUrl;
  const keywordGithubActionsUrl = keywordRunsResult?.runs?.[0]?.htmlUrl ?? keywordDispatchResult?.actionsUrl ?? keywordRunsResult?.actionsUrl;
  const uploadCounts = getUploadCounts(uploadActionsResult, uploadResultRows, uploadRows);
  const priceCounts = getPriceCounts(priceActionsResult, goodsKeys.length);
  const keywordSummary = getKeywordSummary(keywordRunsResult, goodsKeys.length);
  const cockpit = buildCockpit({
    hasUploadRequest: !!uploadRequestId || !!uploadRunResult,
    uploadActive: uploadRunning || uploadFetching || uploadPolling,
    uploadSuccess: goodsKeys.length > 0,
    uploadFailed: hasUploadFailure(uploadActionsResult),
    priceActive: priceRunning || priceFetching || pricePolling,
    priceSuccess: isSuccessfulPriceResult(priceActionsResult),
    priceFailed: hasPriceFailure(priceActionsResult),
    keywordActive: keywordBusy === "dispatch" || keywordBusy === "runs" || keywordPolling || isKeywordRunning(keywordRunsResult),
    keywordSuccess: !!keywordSummary.artifact,
    keywordFailed: hasKeywordFailure(keywordRunsResult),
  });
  const currentRequestId = rowMatchesCurrentRun ? priceRequestId || currentUploadRequestId || keywordDispatchResult?.expectedArtifactName || "" : "";
  const previousRequestId = priceRequestId || uploadRequestId || keywordDispatchResult?.expectedArtifactName || "-";
  const lastCheckedAt = keywordLastCheckedAt ?? priceLastCheckedAt ?? uploadLastCheckedAt;
  const runNextSafeStep = () => {
    if (cockpit.primaryAction === "upload") void runUploadRequest();
    if (cockpit.primaryAction === "price") void runPriceModify();
    if (cockpit.primaryAction === "keyword") void dispatchKeywordEngine();
  };

  useEffect(() => {
    if (!autopilotEnabled) return;
    if (cockpit.primaryAction !== "price" && cockpit.primaryAction !== "keyword") return;
    if (cockpit.primaryAction === "price" && (priceRunning || priceFetching || pricePolling)) return;
    if (cockpit.primaryAction === "keyword" && (keywordBusy || keywordPolling)) return;
    const timer = window.setTimeout(() => {
      if (cockpit.primaryAction === "price") void runPriceModify();
      if (cockpit.primaryAction === "keyword") void dispatchKeywordEngine();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autopilotEnabled, cockpit.primaryAction, priceRunning, priceFetching, pricePolling, keywordBusy, keywordPolling, runPriceModify, dispatchKeywordEngine]);

  return (
    <div className="space-y-6">
      <LaunchCockpit steps={cockpit.steps} currentStage={cockpit.currentStage} nextAction={cockpit.nextAction} primaryAction={cockpit.primaryAction} onNext={runNextSafeStep} rowExpression={rowExpression} onRowExpressionChange={setRowExpression} uploadBusy={uploadRunning || uploadFetching || uploadPolling} autoPilotEnabled={autopilotEnabled} onAutoPilotChange={setAutopilotEnabled} currentRequestId={currentRequestId} previousRequestId={previousRequestId} lastCheckedAt={lastCheckedAt} autoPollStatus={`업로드 ${uploadPollCount}회 · 가격 ${pricePollCount}회 · 키워드 ${keywordPollCount}회`} actionsUrl={keywordGithubActionsUrl ?? priceGithubActionsUrl ?? uploadGithubActionsUrl} counts={{ upload: uploadCounts, price: priceCounts, keyword: keywordSummary }} />
      {cockpit.primaryAction === "price" ? <PrimaryButton onClick={runPriceModify} disabled={priceRunning || priceFetching || pricePolling || goodsKeys.length === 0}>가격설정 실행</PrimaryButton> : null}
      {cockpit.primaryAction === "keyword" ? <PrimaryButton onClick={dispatchKeywordEngine} disabled={!!keywordBusy || keywordPolling}>키워드 엔진 실행</PrimaryButton> : null}
      {cockpit.primaryAction === "review" ? <Link href="/keyword-review-queue?from=product-launch-flow" className="inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">키워드 결과 검토 화면 열기</Link> : null}
      {cockpit.primaryAction === "failed" ? <ErrorDrawer title="실패 원인" uploadResult={uploadActionsResult} priceResult={priceActionsResult} keywordResult={keywordRunsResult} requestId={previousRequestId} actionsUrl={keywordGithubActionsUrl ?? priceGithubActionsUrl ?? uploadGithubActionsUrl} /> : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-slate-950">고급 옵션 열기</summary>
      <form onSubmit={runUpload} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">Step 1. 상품업로드</h2>
        <label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행 번호
          <input value={rowExpression} onChange={(event) => setRowExpression(event.target.value)} placeholder="예: 950 또는 950-952 또는 950,951" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={skipIfGoodsKey} onChange={(event) => setSkipIfGoodsKey(event.target.checked)} className="size-4 rounded border-slate-300" />이미 goods_key 있으면 스킵(권장)</label>
        <div className="mt-1 space-y-1 text-xs text-slate-600"><p>체크하면 이미 업로드된 상품은 건너뜁니다.</p><p>체크 해제는 기존 상품 수정이 아니라 새 상품 등록을 다시 시도합니다. 같은 자사상품코드가 이미 있으면 중복 오류가 발생할 수 있습니다.</p></div>
        {!skipIfGoodsKey ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">주의: 체크 해제 상태에서는 같은 행을 다시 업로드할 때 자사상품코드 중복으로 실패할 수 있습니다. 기존 상품 수정이 목적이라면 업로드가 아니라 수정/가격/상품명 반영 플로우를 사용하세요.</p> : null}
        <p className="mt-3 text-sm text-slate-600">채널 선택 없이 도매1~도매4, 소매1~소매2 전체 6채널로 실행합니다.</p>
        <button type="submit" disabled={uploadRunning || !rowExpression.trim()} className="mt-5 rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 disabled:bg-slate-100">{uploadRunning ? "실행 요청 중..." : "고급 옵션으로 상품업로드 시작"}</button>
        <button type="button" onClick={fetchUploadResult} disabled={uploadFetching || uploadPolling} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{uploadFetching || uploadPolling ? "확인 중..." : "상품업로드 결과 가져오기"}</button>
        <GithubActionsShortcutButton href={uploadGithubActionsUrl} className="ml-3 mt-5" />
        <StatusBlock result={uploadRunResult} requestId={uploadRequestId} />
        <UploadPollingStatusCard result={uploadActionsResult} requestId={uploadRequestId} rowsWithGoodsKeyCount={uploadRows.length} polling={uploadPolling} fetching={uploadFetching} elapsedSeconds={uploadElapsedSeconds} lastCheckedAt={uploadLastCheckedAt} pollCount={uploadPollCount} maxPolls={UPLOAD_MAX_POLLS} nextCheckIn={uploadNextCheckIn} />
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2"><button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">문제만 보기</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">전체 보기</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">성공 항목 숨기기</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">성공 항목 펼치기</button></div>
        <h2 className="text-lg font-bold text-slate-950">상품업로드 결과</h2>
        <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-800">상품그룹은 ptn_goods_cd 끝 글자 기준의 Commerce OS 내부 인식값입니다. 상품그룹 정의표에 suffix 한 줄을 추가하면 새 그룹을 확장할 수 있습니다. 샵플링 상품그룹 API를 수정하지 않습니다.</p>
        {uploadActionsResult?.message ? <p className="mt-3 text-sm text-slate-600">{uploadActionsResult.message}</p> : null}
        <UploadRowsTable rows={uploadResultRows} />
      </section>

      {goodsKeys.length === 0 && uploadActionsResult?.status === "success" ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">goods_key가 생성된 상품이 없어 가격설정을 진행할 수 없습니다.</p> : null}
      {goodsKeys.length > 0 ? <PriceSection goodsKeyCount={goodsKeys.length} result={priceRunResult} actionsResult={priceActionsResult} requestId={priceRequestId} running={priceRunning} fetching={priceFetching} onRun={runPriceModify} onFetch={fetchPriceResult} /> : null}
      {goodsKeys.length > 0 ? <KeywordPrepSection rows={uploadRows} goodsKeys={goodsKeys} seedKeyword={keywordSeed} onSeedKeywordChange={setKeywordSeed} preview={keywordPreview} dispatchResult={keywordDispatchResult} runsResult={keywordRunsResult} importMessage={keywordImportMessage} busy={keywordBusy} onPreview={previewKeywordDispatch} onDispatch={dispatchKeywordEngine} onFetchRuns={fetchKeywordRuns} onImport={importKeywordArtifact} /> : null}
      <FinalChecklist />
      </details>
    </div>
  );
}

type StepState = "waiting" | "running" | "checking" | "success" | "failed" | "action";
type CockpitStep = { name: string; state: StepState; action: string; message: string; count?: string };

function LaunchCockpit({ steps, currentStage, nextAction, primaryAction, onNext, rowExpression, onRowExpressionChange, uploadBusy, autoPilotEnabled, onAutoPilotChange, currentRequestId, previousRequestId, lastCheckedAt, autoPollStatus, actionsUrl, counts }: { steps: CockpitStep[]; currentStage: string; nextAction: string; primaryAction: string; onNext: () => void; rowExpression: string; onRowExpressionChange: (value: string) => void; uploadBusy: boolean; autoPilotEnabled: boolean; onAutoPilotChange: (value: boolean) => void; currentRequestId: string; previousRequestId: string; lastCheckedAt: Date | null; autoPollStatus: string; actionsUrl?: string; counts: { upload: Record<string, number>; price: Record<string, number>; keyword: { targetCount: number; artifactState: string; reviewPendingCount: number; failureReason: string; artifact?: KeywordArtifact } } }) {
  const rowIsValid = rowExpression.trim().length > 0;
  const primaryLabel = getPrimaryActionLabel(primaryAction, uploadBusy, currentStage);
  const disabled = primaryAction === "upload" ? !rowIsValid || uploadBusy : primaryAction === "wait" || primaryAction === "review" || primaryAction === "failed";
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">운영 집중 모드</p><h1 className="text-2xl font-black text-slate-950">상품 출시 플로우</h1><p className="mt-1 text-sm text-slate-600">행 번호를 입력하면 상품업로드부터 순서대로 진행합니다.</p></div></div>
    {primaryAction === "upload" ? <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5"><h2 className="text-lg font-black text-slate-950">먼저 실재고 시트 행 번호를 입력하세요</h2><label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행 번호<input value={rowExpression} onChange={(event) => onRowExpressionChange(event.target.value)} placeholder="예: 950 또는 950-955" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><p className="mt-2 text-sm text-slate-700">상품을 업로드할 실재고 시트의 행 번호입니다. 처음에는 행 번호만 입력하면 됩니다.</p>{!rowIsValid ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-blue-800">행 번호를 입력하면 상품업로드를 시작할 수 있습니다.</p> : null}<button type="button" onClick={onNext} disabled={disabled} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300">{rowIsValid ? primaryLabel : "행 번호 입력 후 시작"}</button></div> : <div className="mt-5"><button type="button" onClick={onNext} disabled={disabled} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300">{primaryLabel}</button></div>}
    <details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">선택 옵션 열기</summary><label className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={autoPilotEnabled} onChange={(event) => onAutoPilotChange(event.target.checked)} className="mt-1 size-4" />자동 진행 모드</label><p className="mt-2 text-xs text-slate-600">켜면 상품업로드 성공 후 가격설정과 키워드 dry_run까지 자동으로 이어서 진행합니다.</p><p className="mt-1 text-xs text-slate-600">실제 상품명/검색어 반영은 검토 화면에서 별도 승인해야 합니다.</p>{!currentRequestId && actionsUrl ? <div className="mt-3"><GithubActionsShortcutButton href={actionsUrl} /></div> : null}</details>
    <div className="mt-5 grid gap-3 lg:grid-cols-5">{steps.map((step, index) => <article key={step.name} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{index + 1}. {step.name}</h3><StateBadge state={step.state} /></div><p className="mt-3 text-sm font-semibold text-slate-800">{step.action}</p><p className="mt-1 text-xs text-slate-600">{step.message}</p>{step.count ? <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs font-semibold text-slate-700">{step.count}</p> : null}</article>)}</div>
    <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm md:grid-cols-2 lg:grid-cols-3"><ResultRow label="현재 단계" value={currentStage} /><ResultRow label="지금 할 일" value={nextAction} /><ResultRow label="현재 입력 행" value={rowExpression || "아직 없음"} /><ResultRow label="현재 요청 ID" value={currentRequestId || "아직 없음"} mono /><ResultRow label="마지막 확인 시각" value={lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"} /><ResultRow label="자동 확인" value={autoPollStatus} />{currentRequestId && actionsUrl ? <div><GithubActionsShortcutButton href={actionsUrl} /></div> : null}</div>
    <details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">이전 실행 기록 보기</summary><ResultRow label="이전 요청 ID" value={previousRequestId} mono /></details>
    <div className="mt-4 grid gap-2 text-xs text-slate-700 md:grid-cols-3"><p>업로드: 대상 행 {counts.upload.targetRows} · 생성 goods_key 수 {counts.upload.goodsKeyCount} · 실패 행 수 {counts.upload.failedRows} · 중복 자사상품코드 수 {counts.upload.duplicateRows}</p><p>가격: 대상 goods_key 수 {counts.price.targetGoodsKeys} · 성공 수 {counts.price.okCount} · 실패 수 {counts.price.failCount}</p><p>키워드: 대상 goods_key 수 {counts.keyword.targetCount} · artifact 상태 {counts.keyword.artifactState} · 검토 대기 수 {counts.keyword.reviewPendingCount} · 실패 원인 {counts.keyword.failureReason}</p></div>
  </section>;
}
function getPrimaryActionLabel(primaryAction: string, uploadBusy: boolean, currentStage: string) {
  if (primaryAction === "upload") return uploadBusy ? "상품업로드 결과 확인 중..." : "상품업로드 시작";
  if (primaryAction === "price") return "가격설정 시작";
  if (primaryAction === "keyword") return "키워드 dry_run 시작";
  if (primaryAction === "review") return "키워드 결과 검토 화면 열기";
  if (primaryAction === "failed") return "실패 원인 보기";
  if (currentStage === "가격설정") return "가격설정 결과 확인 중...";
  if (currentStage === "키워드/상품명 준비") return "키워드 결과 확인 중...";
  return "상품업로드 결과 확인 중...";
}
function StateBadge({ state }: { state: StepState }) { const map = { waiting: ["대기", "bg-slate-100 text-slate-700"], running: ["실행 중", "bg-blue-100 text-blue-800"], checking: ["결과 확인 중", "bg-blue-100 text-blue-800"], success: ["성공", "bg-emerald-100 text-emerald-800"], failed: ["실패", "bg-red-100 text-red-800"], action: ["확인 필요", "bg-amber-100 text-amber-900"] } as const; const [label, cls] = map[state]; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${cls}`}>{state === "running" || state === "checking" ? <span className="size-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" /> : null}{label}</span>; }
function PrimaryButton({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) { return <button type="button" onClick={onClick} disabled={disabled} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:bg-slate-400">{children}</button>; }
function ErrorDrawer({ title, uploadResult, priceResult, keywordResult, requestId, actionsUrl }: { title: string; uploadResult: UploadActionsResult | null; priceResult: PriceActionsResult | null; keywordResult: KeywordRunsResult | null; requestId: string; actionsUrl?: string }) { const keywordFailure = hasKeywordFailure(keywordResult); const duplicate = allFailedRowsAreDuplicatePtnGoodsCd(uploadResult); return <details open className="rounded-2xl border border-red-200 bg-red-50 p-5"><summary className="cursor-pointer text-lg font-bold text-red-800">{title}</summary><div className="mt-3 space-y-3 text-sm text-red-950"><p className="font-semibold">{keywordFailure ? "키워드 엔진 실행이 실패했습니다." : duplicate ? "같은 자사상품코드가 이미 샵플링에 등록되어 있습니다. 같은 행을 다시 업로드할 때는 “이미 goods_key 있으면 스킵(권장)”을 켜세요." : "실패한 단계의 로그와 행별 오류를 확인하세요."}</p>{keywordFailure ? <p>키워드 엔진이 상품정보를 조회하지 못했습니다. 새로 업로드한 상품은 API 반영 지연일 수 있습니다. 잠시 후 다시 실행하거나 seed keyword를 입력해 실행하세요. 권장 작업: GitHub Actions 로그 확인, 잠시 후 다시 실행, 시드 키워드를 입력하고 다시 실행.</p> : null}<dl className="grid gap-2"><ResultRow label="technical detail" value={uploadResult?.message ?? priceResult?.message ?? keywordResult?.message ?? "-"} /><ResultRow label="request id" value={requestId} mono /><ResultRow label="run id" value={String(uploadResult?.runId ?? keywordResult?.runs?.[0]?.id ?? "-")} mono /><ResultRow label="run conclusion" value={String(uploadResult?.runConclusion ?? keywordResult?.runs?.[0]?.conclusion ?? "-")} /><ResultRow label="artifact state" value={getKeywordSummary(keywordResult, 0).artifactState} /><ResultRow label="recommended next action" value="실패 원인 보기 후 GitHub Actions 바로가기에서 로그를 확인하고, 안전 재시도 안내에 따라 중복 스킵 또는 시드 키워드를 사용해 다시 실행하세요." /></dl><GithubActionsShortcutButton href={actionsUrl} /></div></details>; }

function GithubActionsShortcutButton({ href, className = "" }: { href?: string; className?: string }) {
  if (!href) return null;
  return <span className={`inline-flex flex-col gap-1 align-top ${className}`}>
    <Link href={href} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">GitHub Actions 바로가기</Link>
    <span className="text-xs text-slate-600">문제가 있으면 실행 로그에서 실패 원인을 바로 확인할 수 있습니다.</span>
  </span>;
}

function UploadRowsTable({ rows }: { rows: ProductLaunchUploadRow[] }) {
  const issueRows = rows.filter((row) => isFailedUploadRow(row) || !row.goods_key);
  const displayRows = issueRows.length > 0 ? issueRows.slice(0, 20) : rows.slice(0, 20);
  const hiddenSuccessCount = rows.filter((row) => !isFailedUploadRow(row) && row.goods_key).length;
  return <div className="mt-4 overflow-x-auto"><p className="mb-2 text-xs font-semibold text-slate-600">문제 {displayRows.length}개 표시 중 · 성공 {hiddenSuccessCount}개 숨김 <button className="ml-2 underline">더 보기</button> <button className="ml-2 underline">전체 펼치기</button></p><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">행</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">채널</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">ptn_goods_cd</th><th className="border border-slate-200 px-3 py-2">상태</th><th className="border border-slate-200 px-3 py-2">메시지</th></tr></thead><tbody>{displayRows.length > 0 ? displayRows.map((row, index) => { const duplicate = isDuplicatePtnGoodsCdError(row); const failed = isFailedUploadRow(row); return <tr key={`${row.row}-${row.channel}-${row.goods_key}-${row.ptn_goods_cd}-${index}`} className={failed ? "bg-red-50 text-red-950" : "bg-white"}><td className="border border-slate-200 px-3 py-2">{row.row ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "").productGroup}</td><td className="border border-slate-200 px-3 py-2">{row.channel ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{row.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.ptn_goods_cd ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{row.status ?? (failed ? "failed" : "-")}</td><td className="border border-slate-200 px-3 py-2">{duplicate ? <><strong>같은 자사상품코드가 이미 샵플링에 등록되어 있습니다.</strong><br /></> : null}{row.message ?? row.msg ?? "-"}</td></tr>; }) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={8}>업로드 행별 결과가 없습니다.</td></tr>}</tbody></table></div>;
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
      <GithubActionsShortcutButton href={result?.runUrl} />
    </div>
    {state.showDetails ? <UploadPollingErrorDetails result={result} requestId={requestId} /> : null}
  </article>;
}

function getUploadPollingState(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number, polling: boolean, timedOut: boolean) {
  if (timedOut && !isFinalUploadPollingResult(result, rowsWithGoodsKeyCount)) return { label: "자동 확인 시간 초과", message: "자동 확인 시간이 초과되었습니다. 잠시 후 다시 확인하거나 GitHub Actions 로그를 확인하세요.", currentStep: 4, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (isConfirmedUploadFailure(result)) return { label: "실패", message: result?.message ?? "상품업로드 실행이 실패했습니다. GitHub Actions 로그를 확인하세요.", currentStep: 3, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (result?.status === "error" && result?.phase !== "completed_no_artifact") return { label: "결과 확인 오류", message: "상품업로드 결과 확인 중 오류가 발생했습니다.", currentStep: 2, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  const summaryStatus = getUploadSummaryStatus(result);
  if (summaryStatus === "failed") return { label: "상품업로드 실패", message: allFailedRowsAreDuplicatePtnGoodsCd(result) ? "같은 자사상품코드가 이미 등록되어 업로드가 차단되었습니다." : "샵플링이 상품등록을 거절했습니다. 아래 행별 오류를 확인하세요.",
    currentStep: 5, final: true, showSpinner: false, showDetails: true, cardClass: "border-red-200 bg-red-50", textClass: "text-red-700", stepClass: "border-red-300 bg-red-100 text-red-800" };
  if (summaryStatus === "partial_failure") return { label: "상품업로드 일부 실패", message: "일부 상품등록이 실패했습니다. 아래 행별 오류를 확인하세요.", currentStep: 5, final: true, showSpinner: false, showDetails: true, cardClass: "border-amber-200 bg-amber-50", textClass: "text-amber-800", stepClass: "border-amber-300 bg-amber-100 text-amber-900" };
  if (summaryStatus === "success" || (result?.status === "success" && rowsWithGoodsKeyCount > 0)) return { label: "상품업로드 완료", message: "상품업로드가 완료되었습니다. goods_key를 확인했습니다.", currentStep: 5, final: true, showSpinner: false, showDetails: false, cardClass: "border-emerald-200 bg-emerald-50", textClass: "text-emerald-800", stepClass: "border-emerald-300 bg-emerald-100 text-emerald-800" };
  if (result?.status === "success") return { label: "상품업로드 결과 확인 완료", message: "실행 결과를 가져왔지만 goods_key 결과가 없습니다.", currentStep: 5, final: true, showSpinner: false, showDetails: false, cardClass: "border-amber-200 bg-amber-50", textClass: "text-amber-800", stepClass: "border-amber-300 bg-amber-100 text-amber-900" };
  if (result?.phase === "waiting_artifact" || result?.phase === "completed_no_artifact") return { label: "결과 파일 대기", message: result.status === "error" ? "현재 요청의 artifact에서 result_summary.json을 찾지 못했습니다." : "현재 요청의 실행은 확인됐고, 결과 파일을 기다리는 중입니다.", currentStep: 4, final: result.status === "error", showSpinner: result.status !== "error", showDetails: result.status === "error", cardClass: result.status === "error" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50", textClass: result.status === "error" ? "text-red-700" : "text-amber-800", stepClass: result.status === "error" ? "border-red-300 bg-red-100 text-red-800" : "border-amber-300 bg-amber-100 text-amber-900 animate-pulse" };
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
  return (confirmedConclusion && !result.summary) || backendConfirmedFailure;
}

function isFinalUploadPollingResult(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number) {
  return isConfirmedUploadFailure(result) || result?.status === "success" || rowsWithGoodsKeyCount > 0;
}

function getUploadSummaryStatus(result: UploadActionsResult | null) {
  const summary = result?.summary;
  if (!summary || typeof summary !== "object") return "";
  return String((summary as { status?: unknown }).status ?? "");
}

function isFailedUploadRow(row: ProductLaunchUploadRow) {
  const status = String(row.status ?? row.success ?? row.ok ?? "").toLowerCase();
  return status === "failed" || status === "failure" || status === "false" || isDuplicatePtnGoodsCdError(row);
}

function isDuplicatePtnGoodsCdError(row: ProductLaunchUploadRow) {
  const code = String(row.code ?? "");
  const message = `${row.message ?? ""} ${row.msg ?? ""}`;
  return code.startsWith("110") || message.includes("자사상품코드 중복");
}

function allFailedRowsAreDuplicatePtnGoodsCd(result: UploadActionsResult | null) {
  const rows = extractUploadRows(result).filter(isFailedUploadRow);
  return rows.length > 0 && rows.every(isDuplicatePtnGoodsCdError);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${rest}초`;
}

function PriceSection({ goodsKeyCount, result, actionsResult, requestId, running, fetching, onRun, onFetch }: { goodsKeyCount: number; result: RunResult | null; actionsResult: PriceActionsResult | null; requestId: string; running: boolean; fetching: boolean; onRun: () => void; onFetch: () => void }) {
  const summary = actionsResult?.summary;
  const errors = Array.isArray(summary?.errors) ? summary.errors : [];
  const notApplied = Number(summary?.not_applied_count ?? 0);
  const blankRisk = Number(summary?.blank_risk_count ?? 0);
  const failed = Number(summary?.failed_count ?? summary?.fail_count ?? 0);
  const affectedMalls = Array.isArray(summary?.affected_malls) ? summary.affected_malls.join(", ") : [...new Set(errors.map((error) => error.mall).filter(Boolean))].join(", ");
  const hasCoverageRisk = notApplied > 0 || blankRisk > 0 || failed > 0;
  const confirmedAll = actionsResult && !hasCoverageRisk && Number(summary?.estimated_mall_update_count ?? 0) >= goodsKeyCount * 24;
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Step 2. 가격설정</h2><p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeyCount}</strong></p><p className="mt-1 text-sm text-slate-700">예상 쇼핑몰 가격설정 대상 수 = goods_key count × 24: <strong>{goodsKeyCount * 24}</strong></p><button type="button" onClick={onRun} disabled={running} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{running ? "실행 요청 중..." : "가격설정 실행"}</button><button type="button" onClick={onFetch} disabled={fetching} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{fetching ? "가져오는 중..." : "가격설정 결과 가져오기"}</button><StatusBlock result={result} requestId={requestId} />{hasCoverageRisk ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950"><h3 className="font-black">가격이 비어 있을 수 있는 쇼핑몰이 있습니다.</h3><p className="mt-2">영향 쇼핑몰: {affectedMalls || "확인 필요"}</p><p>영향 goods_key 수: {String(summary?.goods_key_count ?? goodsKeyCount)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onRun} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">가격설정 재실행</button><GithubActionsShortcutButton href={actionsResult?.runUrl} /><button type="button" className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-800">상세 결과 보기</button></div></div> : confirmedAll ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-800">모든 필수 쇼핑몰 가격 반영을 확인했습니다.</p> : null}{actionsResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="status" value={String(summary?.status ?? actionsResult.status ?? "-")} /><ResultRow label="exit_code" value={String(summary?.exit_code ?? "-")} /><ResultRow label="goods_key_count" value={String(summary?.goods_key_count ?? "-")} /><ResultRow label="estimated_mall_update_count" value={String(summary?.estimated_mall_update_count ?? "-")} /><ResultRow label="policy_override_count" value={String(summary?.policy_override_count ?? 0)} /><ResultRow label="성공 수" value={String(summary?.ok_count ?? "-")} /><ResultRow label="실패 수" value={String(summary?.fail_count ?? "-")} /></dl> : null}<ErrorsTable errors={errors} /></section>;
}

function KeywordPrepSection({ rows, goodsKeys, seedKeyword, onSeedKeywordChange, preview, dispatchResult, runsResult, importMessage, busy, onPreview, onDispatch, onFetchRuns, onImport }: { rows: ProductLaunchUploadRow[]; goodsKeys: string[]; seedKeyword: string; onSeedKeywordChange: (value: string) => void; preview: unknown; dispatchResult: KeywordDispatchResult | null; runsResult: KeywordRunsResult | null; importMessage: string; busy: string; onPreview: () => void; onDispatch: () => void; onFetchRuns: () => void; onImport: (run: KeywordRun, artifact: KeywordArtifact) => void }) {
  const latestRunWithArtifact = runsResult?.runs?.find((run) => run.artifacts?.some((artifact) => artifact.expected && !artifact.expired));
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Step 3. 상품명/키워드 실행 및 검토</h2><p className="mt-3 text-sm text-slate-700">현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용하는 기준으로 준비합니다.</p><p className="mt-1 text-sm text-slate-700">키워드 엔진은 dry_run으로만 실행되며, 결과는 키워드 결과 검토 화면에서 사람이 확인합니다.</p><p className="mt-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">키워드/상품명 결과는 샵플링에 자동 반영되지 않습니다. 검토 화면에서 확인 후 별도 승인해야 합니다.</p><p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeys.length}</strong></p><p className="mt-1 break-all font-mono text-xs text-slate-700">goods_key CSV preview: {goodsKeys.join(",")}</p><label className="mt-4 block text-sm font-semibold text-slate-800">시드 키워드<input value={seedKeyword} onChange={(event) => onSeedKeywordChange(event.target.value)} placeholder="예: 욕실 수납, 주방 정리, 차량용 수납" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><p className="mt-1 text-xs text-slate-600">비워두면 goods_key 기준으로 키워드 엔진이 자동 진행합니다.</p><UploadRowsTable rows={rows} /><div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={onPreview} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 입력값 확인</button><button type="button" onClick={onDispatch} disabled={!!busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 실행</button><button type="button" onClick={onFetchRuns} disabled={!!busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100">키워드 실행 결과 확인</button></div>{preview ? <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">상세 실행 정보 열기</summary><pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{JSON.stringify(preview, null, 2)}</pre></details> : null}{dispatchResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="repo" value={dispatchResult.repo ?? "-"} /><ResultRow label="workflowFile" value={dispatchResult.workflowFile ?? "-"} /><ResultRow label="actionsUrl" value={dispatchResult.actionsUrl ?? "-"} /><ResultRow label="expectedArtifactName" value={dispatchResult.expectedArtifactName ?? "-"} /><ResultRow label="message" value="키워드 엔진 실행을 요청했습니다. 몇 초 뒤 실행 결과 확인을 눌러주세요." /></dl> : null}{runsResult?.message ? <p className="mt-3 text-sm text-slate-600">{runsResult.message}</p> : null}{latestRunWithArtifact ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">가져올 결과물이 있는 최신 실행을 우선 표시합니다.</p> : null}<details className="mt-4"><summary className="cursor-pointer text-sm font-bold text-slate-700">이전 실행 기록 보기</summary><div className="mt-4 space-y-3">{runsResult?.runs?.map((run) => { const expectedArtifact = run.artifacts?.find((artifact) => artifact.expected); return <article key={run.id} className="rounded-lg border border-slate-200 p-4 text-sm"><div className="flex flex-wrap gap-3"><span>run id: <strong>{run.id}</strong></span><span>status: {run.status ?? "-"}</span><span>conclusion: {run.conclusion ?? "-"}</span><span>createdAt: {run.createdAt ?? "-"}</span>{run.htmlUrl ? <Link href={run.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">GitHub Actions 바로가기</Link> : null}</div><p className={expectedArtifact ? "mt-2 font-semibold text-emerald-700" : "mt-2 text-slate-600"}>{expectedArtifact ? `expected artifact exists: ${expectedArtifact.name}` : "expected artifact exists: no"}</p>{expectedArtifact ? <button type="button" onClick={() => onImport(run, expectedArtifact)} disabled={!!busy || expectedArtifact.expired} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">결과 가져오기 및 검토 시작</button> : null}</article>; })}</div></details>{importMessage ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{importMessage}</p> : null}{importMessage ? <Link href="/keyword-review-queue?from=product-launch-flow" className="mt-3 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">키워드 결과 검토 화면 열기</Link> : null}</section>;
}

function FinalChecklist() { const items = ["상품업로드 결과 확인", "goods_key 6개 확인", "ptn_goods_cd suffix 기반 상품그룹 인식 확인", "가격설정 완료 확인", "상품명/키워드 단계는 MVP 기준 동일 적용 예정", "샵플링 마켓전송은 수동으로 진행"]; return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><h2 className="text-lg font-bold text-amber-950">최종 체크리스트</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{items.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold text-red-700">마켓전송은 현재 OPS Center에서 자동 실행하지 않습니다. 샵플링 관리자에서 최종 확인 후 직접 전송하세요.</p></section>; }
function ErrorsTable({ errors }: { errors: ProductLaunchPriceError[] }) { return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">idx</th><th className="border border-slate-200 px-3 py-2">mall</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">msg</th></tr></thead><tbody>{errors.length > 0 ? errors.map((error, index) => <tr key={`${error.goods_key}-${index}`}><td className="border border-slate-200 px-3 py-2">{error.idx ?? index + 1}</td><td className="border border-slate-200 px-3 py-2">{error.mall ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{error.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.msg ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={5}>실패 항목이 없습니다.</td></tr>}</tbody></table></div>; }
function StatusBlock({ result, requestId }: { result: RunResult | null; requestId: string }) { return result ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} /><ResultRow label="요청 추적 ID" value={result.requestId ?? requestId ?? "-"} mono />{result.commandPreview ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">상세 실행 정보 열기</summary><ResultRow label="commandPreview" value={result.commandPreview} mono /></details> : null}{result.githubActionsUrl ? <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">githubActionsUrl</dt><dd><a href={result.githubActionsUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-blue-700 underline">{result.githubActionsUrl}</a></dd></div> : null}{result.message ? <ResultRow label="message" value={result.message} /> : null}</dl> : null; }
function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd></div>; }
function getStoredValue(key: string) { if (typeof window === "undefined") return ""; return window.localStorage.getItem(key) ?? ""; }
function persistValue(key: string, value: string) { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }

function getUploadCounts(result: UploadActionsResult | null, rows: ProductLaunchUploadRow[], rowsWithGoodsKey: ProductLaunchUploadRow[]) {
  return { targetRows: rows.length, goodsKeyCount: rowsWithGoodsKey.length, failedRows: rows.filter(isFailedUploadRow).length, duplicateRows: rows.filter(isDuplicatePtnGoodsCdError).length };
}
function getPriceCounts(result: PriceActionsResult | null, targetGoodsKeys: number) { const summary = result?.summary; return { targetGoodsKeys, okCount: Number(summary?.ok_count ?? 0), failCount: Number(summary?.fail_count ?? 0) }; }
function getKeywordSummary(result: KeywordRunsResult | null, targetCount: number) { const latest = result?.runs?.[0]; const artifact = latest?.artifacts?.find((item) => item.expected && !item.expired); const failed = hasKeywordFailure(result); return { targetCount, artifact, artifactState: artifact ? "ready" : latest?.status === "queued" || latest?.status === "in_progress" ? "waiting" : failed ? "missing" : "not checked", reviewPendingCount: artifact ? 1 : 0, failureReason: failed && !artifact ? "키워드 결과 파일이 아직 없습니다. 실행 중이거나 실패했을 수 있습니다." : "-" }; }
function isFinalPriceResult(result: PriceActionsResult | null) { if (!result) return false; const status = String(result.summary?.status ?? result.status ?? "").toLowerCase(); const conclusion = String(result.runConclusion ?? "").toLowerCase(); return ["success", "failed", "failure", "error"].includes(status) || ["success", "failure", "cancelled", "timed_out"].includes(conclusion); }
function isSuccessfulPriceResult(result: PriceActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return status === "success" || conclusion === "success"; }
function hasPriceFailure(result: PriceActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return ["failed", "failure", "error"].includes(status) || ["failure", "cancelled", "timed_out"].includes(conclusion); }
function hasUploadFailure(result: UploadActionsResult | null) { return isConfirmedUploadFailure(result) || getUploadSummaryStatus(result) === "failed" || getUploadSummaryStatus(result) === "partial_failure"; }
function isKeywordRunning(result: KeywordRunsResult | null) { const status = result?.runs?.[0]?.status; return status === "queued" || status === "in_progress"; }
function hasKeywordFailure(result: KeywordRunsResult | null) { const run = result?.runs?.[0]; return run?.status === "completed" && ["failure", "cancelled", "timed_out"].includes(String(run.conclusion ?? "")) && !run.artifacts?.some((artifact) => artifact.expected && !artifact.expired); }
function isFinalKeywordRuns(result: KeywordRunsResult | null) { const run = result?.runs?.[0]; return !!run && (hasKeywordFailure(result) || !!run.artifacts?.some((artifact) => artifact.expected && !artifact.expired)); }
function buildCockpit(state: { hasUploadRequest: boolean; uploadActive: boolean; uploadSuccess: boolean; uploadFailed: boolean; priceActive: boolean; priceSuccess: boolean; priceFailed: boolean; keywordActive: boolean; keywordSuccess: boolean; keywordFailed: boolean }) {
  const steps: CockpitStep[] = [
    { name: "상품업로드", state: state.uploadFailed ? "failed" : state.uploadActive ? "checking" : state.uploadSuccess ? "success" : "waiting", action: state.uploadSuccess ? "가격설정 시작" : state.uploadActive ? "상품업로드 결과 확인 중..." : "상품업로드 시작", message: state.uploadSuccess ? "goods_key가 준비되었습니다." : state.uploadActive ? "중복 클릭 없이 자동 확인합니다." : "행 번호 입력 후 시작하세요." },
    { name: "가격설정", state: state.priceFailed ? "failed" : state.priceActive ? "checking" : state.priceSuccess ? "success" : state.uploadSuccess ? "action" : "waiting", action: state.priceSuccess ? "키워드 dry_run 시작" : state.priceActive ? "가격설정 결과 확인 중..." : "가격설정 시작", message: state.uploadSuccess ? "업로드 성공 후 실행할 수 있습니다." : "업로드 완료 후 활성화됩니다." },
    { name: "키워드/상품명 준비", state: state.keywordFailed ? "failed" : state.keywordActive ? "running" : state.keywordSuccess ? "success" : state.priceSuccess ? "action" : "waiting", action: state.keywordSuccess ? "키워드 결과 검토 화면 열기" : state.keywordActive ? "키워드 결과 확인 중..." : "키워드 dry_run 시작", message: state.keywordActive ? "키워드 엔진이 실행 중입니다. 결과 파일이 생성되면 자동으로 표시됩니다." : state.keywordFailed ? "키워드 엔진 실행이 실패했습니다." : "dry_run 결과만 준비합니다." },
    { name: "키워드 결과 검토", state: state.keywordSuccess ? "action" : "waiting", action: "키워드 결과 검토 화면 열기", message: state.keywordSuccess ? "결과 파일이 준비되었습니다. 검토 화면에서 확인하세요." : "artifact 생성 후 열 수 있습니다." },
    { name: "최종 확인", state: state.keywordSuccess ? "action" : "waiting", action: "최종 확인", message: "마켓전송은 수동으로 진행합니다." },
  ];
  let primaryAction: "upload" | "price" | "keyword" | "review" | "failed" | "wait" = "upload";
  if (state.uploadFailed || state.priceFailed || state.keywordFailed) primaryAction = "failed";
  else if (state.uploadActive || state.priceActive || state.keywordActive) primaryAction = "wait";
  else if (!state.uploadSuccess) primaryAction = "upload";
  else if (!state.priceSuccess) primaryAction = "price";
  else if (!state.keywordSuccess) primaryAction = "keyword";
  else primaryAction = "review";
  const currentStage = steps.find((step) => step.state === "failed" || step.state === "running" || step.state === "checking" || step.state === "action")?.name ?? "상품업로드";
  const nextAction = primaryAction === "failed" ? "문제가 발생했습니다. 실패 원인을 확인하세요." : state.uploadActive ? "상품업로드 결과를 확인하는 중입니다. 잠시만 기다려주세요." : state.priceActive ? "가격설정 결과를 확인하는 중입니다. 잠시만 기다려주세요." : state.keywordActive ? "키워드 결과를 확인하는 중입니다. 잠시만 기다려주세요." : primaryAction === "upload" ? "행 번호를 입력하고 상품업로드를 시작하세요." : primaryAction === "price" ? "상품업로드가 완료되었습니다. 이제 가격설정을 시작하세요." : primaryAction === "keyword" ? "가격설정이 완료되었습니다. 이제 키워드 dry_run을 시작하세요." : primaryAction === "review" ? "키워드 결과가 준비되었습니다. 검토 화면에서 확인하세요." : steps.find((step) => step.name === currentStage)?.action ?? "상품업로드 시작";
  return { steps, primaryAction, currentStage, nextAction };
}
