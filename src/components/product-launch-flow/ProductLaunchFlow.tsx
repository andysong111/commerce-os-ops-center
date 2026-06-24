"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
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

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; commandPreview?: string };
type UploadActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: unknown };
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
  const [priceRunResult, setPriceRunResult] = useState<RunResult | null>(null);
  const [priceActionsResult, setPriceActionsResult] = useState<PriceActionsResult | null>(null);
  const [keywordSeed, setKeywordSeed] = useState(() => getStoredValue(KEYWORD_SEED_STORAGE_KEY));
  const [keywordPreview, setKeywordPreview] = useState<unknown>(null);
  const [keywordDispatchResult, setKeywordDispatchResult] = useState<KeywordDispatchResult | null>(null);
  const [keywordRunsResult, setKeywordRunsResult] = useState<KeywordRunsResult | null>(null);
  const [keywordImportMessage, setKeywordImportMessage] = useState<string>("");
  const [keywordBusy, setKeywordBusy] = useState<string>("");

  const uploadRows = useMemo(() => extractRowsWithGoodsKey(uploadActionsResult), [uploadActionsResult]);
  const goodsKeys = useMemo(() => dedupeGoodsKeysForPriceModify(uploadRows), [uploadRows]);

  const runUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploadRunning) return;
    setUploadRunning(true);
    setUploadRunResult(null);
    try {
      const response = await fetch("/api/shopling-product-upload/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowExpression, channel: "", skip_if_goods_key: true, dump: false, sleep: "1.2" }),
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

  const fetchUploadResult = async () => {
    if (uploadFetching) return;
    setUploadFetching(true);
    try {
      const url = uploadRequestId ? `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(uploadRequestId)}` : "/api/shopling-product-upload/actions-result";
      setUploadActionsResult(await (await fetch(url)).json());
    } catch (error) {
      setUploadActionsResult({ status: "error", message: error instanceof Error ? error.message : "상품업로드 결과를 가져오는 중 오류가 발생했습니다." });
    } finally {
      setUploadFetching(false);
    }
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
      window.sessionStorage.setItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY, JSON.stringify({ kind: data.kind, source: data.source, files: data.files, generatedSourceFiles: data.generatedSourceFiles, importedAt: new Date().toISOString(), notAppliedToShopling: true, notPublished: true, requiresHumanReview: true }));
      setKeywordImportMessage("키워드 결과를 검토 화면으로 가져왔습니다.");
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
        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked readOnly className="size-4 rounded border-slate-300" />이미 goods_key 있으면 스킵</label>
        <p className="mt-3 text-sm text-slate-600">채널 선택 없이 도매1~도매4, 소매1~소매2 전체 6채널로 실행합니다.</p>
        <button type="submit" disabled={uploadRunning} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{uploadRunning ? "실행 요청 중..." : "상품업로드 실행"}</button>
        <button type="button" onClick={fetchUploadResult} disabled={uploadFetching} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{uploadFetching ? "가져오는 중..." : "상품업로드 결과 가져오기"}</button>
        <StatusBlock result={uploadRunResult} requestId={uploadRequestId} />
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">상품업로드 결과</h2>
        <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-800">상품그룹은 ptn_goods_cd 끝 글자 a~f 기준의 Commerce OS 내부 인식값입니다. 샵플링 상품그룹 API를 수정하지 않습니다.</p>
        {uploadActionsResult?.message ? <p className="mt-3 text-sm text-slate-600">{uploadActionsResult.message}</p> : null}
        <UploadRowsTable rows={uploadRows} />
      </section>

      {goodsKeys.length > 0 ? <PriceSection goodsKeyCount={goodsKeys.length} result={priceRunResult} actionsResult={priceActionsResult} requestId={priceRequestId} running={priceRunning} fetching={priceFetching} onRun={runPriceModify} onFetch={fetchPriceResult} /> : null}
      {goodsKeys.length > 0 ? <KeywordPrepSection rows={uploadRows} goodsKeys={goodsKeys} seedKeyword={keywordSeed} onSeedKeywordChange={setKeywordSeed} preview={keywordPreview} dispatchResult={keywordDispatchResult} runsResult={keywordRunsResult} importMessage={keywordImportMessage} busy={keywordBusy} onPreview={previewKeywordDispatch} onDispatch={dispatchKeywordEngine} onFetchRuns={fetchKeywordRuns} onImport={importKeywordArtifact} /> : null}
      <FinalChecklist />
    </div>
  );
}

function UploadRowsTable({ rows }: { rows: ProductLaunchUploadRow[] }) {
  return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">행</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">채널</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">ptn_goods_cd</th></tr></thead><tbody>{rows.length > 0 ? rows.map((row, index) => <tr key={`${row.goods_key}-${index}`} className="bg-white"><td className="border border-slate-200 px-3 py-2">{row.row ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "")}</td><td className="border border-slate-200 px-3 py-2">{row.channel ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{row.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{row.ptn_goods_cd ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={6}>goods_key 결과가 없습니다.</td></tr>}</tbody></table></div>;
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

function FinalChecklist() { const items = ["상품업로드 결과 확인", "goods_key 6개 확인", "ptn_goods_cd suffix a~f 그룹 인식 확인", "가격설정 완료 확인", "상품명/키워드 단계는 MVP 기준 동일 적용 예정", "샵플링 마켓전송은 수동으로 진행"]; return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><h2 className="text-lg font-bold text-amber-950">최종 체크리스트</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{items.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold text-red-700">마켓전송은 현재 OPS Center에서 자동 실행하지 않습니다. 샵플링 관리자에서 최종 확인 후 직접 전송하세요.</p></section>; }
function ErrorsTable({ errors }: { errors: ProductLaunchPriceError[] }) { return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">idx</th><th className="border border-slate-200 px-3 py-2">mall</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">msg</th></tr></thead><tbody>{errors.length > 0 ? errors.map((error, index) => <tr key={`${error.goods_key}-${index}`}><td className="border border-slate-200 px-3 py-2">{error.idx ?? index + 1}</td><td className="border border-slate-200 px-3 py-2">{error.mall ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{error.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.msg ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={5}>실패 항목이 없습니다.</td></tr>}</tbody></table></div>; }
function StatusBlock({ result, requestId }: { result: RunResult | null; requestId: string }) { return result ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} /><ResultRow label="요청 추적 ID" value={result.requestId ?? requestId ?? "-"} mono />{result.commandPreview ? <ResultRow label="commandPreview" value={result.commandPreview} mono /> : null}{result.githubActionsUrl ? <ResultRow label="githubActionsUrl" value={result.githubActionsUrl} /> : null}{result.message ? <ResultRow label="message" value={result.message} /> : null}</dl> : null; }
function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd></div>; }
function getStoredValue(key: string) { if (typeof window === "undefined") return ""; return window.localStorage.getItem(key) ?? ""; }
function persistValue(key: string, value: string) { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
