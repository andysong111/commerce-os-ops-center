"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCompactKeywordApplyExecutionPlan, buildKeywordExecutionPreflight } from "@/lib/keywordReviewExecutionPreflight";
import { buildGoodsKeyGroupJson, buildLaunchSourceRowGroups, buildManualCandidatePreview, dedupeGoodsKeysForPriceModify, extractRowsWithGoodsKey, extractUploadRows, parseLaunchRowExpression, type ProductLaunchPriceError } from "@/lib/productLaunchFlow";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";

const PRODUCT_LAUNCH_SESSION_STORAGE_KEY = "productLaunchFlow.session.v2";
const MANUAL_CANDIDATES_STORAGE_PREFIX = "productLaunchFlow.manualCandidatesBySourceRow";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 24;
const APPLY_CONFIRMATION_TEXT = "APPLY_SHOPLING_KEYWORD_UPDATES";

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; runUrl?: string };
type UploadActionsResult = { status?: string; phase?: string; message?: string; requestId?: string; runUrl?: string; summary?: unknown };
type PriceActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: { errors?: ProductLaunchPriceError[]; fail_count?: unknown; failed_count?: unknown } };
type ProductLaunchSessionV2 = { rowExpression?: string; startedAt?: string; updatedAt?: string; uploadRequestId?: string; priceRequestId?: string; keywordDryRunRequestId?: string; keywordRealApplyRequestId?: string; finalPriceRequestId?: string; uploadResult?: UploadActionsResult | null; priceResult?: PriceActionsResult | null; finalPriceResult?: PriceActionsResult | null; manualTitleCandidatesBySourceRow?: Record<string, string>; manualSearchCandidatesBySourceRow?: Record<string, string>; stage?: LaunchStage };
type LaunchStage = "시작 전" | "상품업로드 중" | "가격 1차 적용 중" | "후보 입력 대기" | "미리보기 생성 중" | "검토 완료 - 승인 대기" | "차단 항목 있음" | "실제 반영 중" | "가격 최종 재적용 중" | "출시 완료" | "실패 - 문제 확인 필요";

export function ProductLaunchFlow() {
  const restoredSession = useMemo(() => readProductLaunchSession(), []);
  const [rowExpression, setRowExpression] = useState(restoredSession?.rowExpression ?? "");
  const [uploadRequestId, setUploadRequestId] = useState(restoredSession?.uploadRequestId ?? "");
  const [priceRequestId, setPriceRequestId] = useState(restoredSession?.priceRequestId ?? "");
  const [dryRunRequestId, setDryRunRequestId] = useState(restoredSession?.keywordDryRunRequestId ?? "");
  const [realApplyRequestId, setRealApplyRequestId] = useState(restoredSession?.keywordRealApplyRequestId ?? "");
  const [finalPriceRequestId, setFinalPriceRequestId] = useState(restoredSession?.finalPriceRequestId ?? "");
  const [uploadResult, setUploadResult] = useState<UploadActionsResult | null>(restoredSession?.uploadResult ?? null);
  const [priceResult, setPriceResult] = useState<PriceActionsResult | null>(restoredSession?.priceResult ?? null);
  const [finalPriceResult, setFinalPriceResult] = useState<PriceActionsResult | null>(restoredSession?.finalPriceResult ?? null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<LaunchStage>("시작 전");
  const [manualTitleCandidatesBySourceRow, setManualTitleCandidatesBySourceRow] = useState<Record<string, string>>(restoredSession?.manualTitleCandidatesBySourceRow ?? {});
  const [manualSearchCandidatesBySourceRow, setManualSearchCandidatesBySourceRow] = useState<Record<string, string>>(restoredSession?.manualSearchCandidatesBySourceRow ?? {});
  const [dryRunResult, setDryRunResult] = useState<Record<string, unknown> | null>(null);
  const [applyResult, setApplyResult] = useState<Record<string, unknown> | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string>("");
  const finalPriceStartedForApplyRef = useRef("");

  const uploadRows = useMemo(() => extractRowsWithGoodsKey(uploadResult), [uploadResult]);
  const uploadResultRows = useMemo(() => extractUploadRows(uploadResult), [uploadResult]);
  const sourceRowGroups = useMemo(() => buildLaunchSourceRowGroups(uploadRows, rowExpression), [rowExpression, uploadRows]);
  const goodsKeys = useMemo(() => dedupeGoodsKeysForPriceModify(uploadRows), [uploadRows]);
  const manualScope = useMemo(() => currentManualScope(rowExpression, uploadRequestId), [rowExpression, uploadRequestId]);
  const preview = useMemo(() => buildManualCandidatePreview({ sourceRowGroups, uploadRows, manualTitleCandidatesBySourceRow, manualSearchCandidatesBySourceRow }), [manualSearchCandidatesBySourceRow, manualTitleCandidatesBySourceRow, sourceRowGroups, uploadRows]);
  const allowedMallKeys = useMemo(() => [...new Set(PRODUCT_GROUP_MARKET_REGISTRY.map((market) => market.mallKey))], []);
  const preflight = useMemo(() => buildKeywordExecutionPreflight({ previewResult: preview, finalConfirmationText: "" }, { allowedMallKeys, maxRows: 500, alreadyAppliedGoodsKeys: [], requireFinalConfirmation: false, confirmationText: "" }), [allowedMallKeys, preview]);
  const blockedCount = preflight.summary.blockedCount;
  const readyCount = preflight.summary.eligibleCount;
  const needsReviewCount = preview.items.filter((item) => item.validation_warnings.length > 0).length;
  const searchShortCount = preview.items.filter((item) => item.warning_flags.includes("검색어 부족")).length;
  const stage = deriveStage({ busy, uploadResult, priceResult, sourceRowGroups, readyCount, blockedCount, dryRunResult, applyResult, finalPriceResult });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setManualTitleCandidatesBySourceRow(readStoredRecord(`${MANUAL_CANDIDATES_STORAGE_PREFIX}.${manualScope}.title`));
      setManualSearchCandidatesBySourceRow(readStoredRecord(`${MANUAL_CANDIDATES_STORAGE_PREFIX}.${manualScope}.search`));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [manualScope]);
  useEffect(() => persistRecord(`${MANUAL_CANDIDATES_STORAGE_PREFIX}.${manualScope}.title`, manualTitleCandidatesBySourceRow), [manualScope, manualTitleCandidatesBySourceRow]);
  useEffect(() => persistRecord(`${MANUAL_CANDIDATES_STORAGE_PREFIX}.${manualScope}.search`, manualSearchCandidatesBySourceRow), [manualScope, manualSearchCandidatesBySourceRow]);
  useEffect(() => persistProductLaunchSession({ rowExpression, uploadRequestId, priceRequestId, keywordDryRunRequestId: dryRunRequestId, keywordRealApplyRequestId: realApplyRequestId, finalPriceRequestId, uploadResult, priceResult, finalPriceResult, manualTitleCandidatesBySourceRow, manualSearchCandidatesBySourceRow, stage, updatedAt: new Date().toISOString() }), [dryRunRequestId, finalPriceRequestId, finalPriceResult, manualSearchCandidatesBySourceRow, manualTitleCandidatesBySourceRow, priceRequestId, priceResult, realApplyRequestId, rowExpression, stage, uploadRequestId, uploadResult]);

  const pollJson = useCallback(async <T,>(url: string, setter: (value: T) => void) => {
    for (let count = 0; count < MAX_POLLS; count += 1) {
      const json = await (await fetch(url)).json();
      setter(json);
      setLastCheckedAt(new Date().toLocaleString("ko-KR"));
      if (isFinalActionsResult(json)) return json;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return null;
  }, []);

  const runPriceModify = useCallback(async (finalPass = false) => {
    if (goodsKeys.length === 0) return;
    setBusy(finalPass ? "가격 최종 재적용 중" : "가격 1차 적용 중");
    const response = await fetch("/api/shopling-price-modify/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goods_key: goodsKeys.join(","), goods_key_group_json: buildGoodsKeyGroupJson(uploadRows), policy_overrides: [], reason: finalPass ? "product_launch_final_price_reapply" : "product_launch_initial_price_setup" }) });
    const json = await response.json();
    const requestId = json.requestId ?? "";
    if (finalPass) setFinalPriceRequestId(requestId); else setPriceRequestId(requestId);
    await pollJson<PriceActionsResult>(`/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(requestId)}`, finalPass ? setFinalPriceResult : setPriceResult);
    setBusy("시작 전");
  }, [goodsKeys, pollJson, uploadRows]);

  async function startLaunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rowExpression.trim()) return;
    setBusy("상품업로드 중");
    setUploadResult(null); setPriceResult(null); setFinalPriceResult(null); setApplyResult(null); setDryRunResult(null);
    const response = await fetch("/api/shopling-product-upload/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rowExpression, channel: "", skip_if_goods_key: true, dump: false, sleep: "1.2" }) });
    const json = await response.json();
    setRunResult(json);
    const requestId = json.requestId ?? "";
    setUploadRequestId(requestId);
    const uploaded = await pollJson<UploadActionsResult>(`/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(requestId)}`, setUploadResult);
    if (uploaded) await runPriceModify(false);
    setBusy("시작 전");
  }

  const runDryRunIfNeeded = useCallback(async () => {
    if (readyCount === 0 || blockedCount > 0 || dryRunRequestId || dryRunResult) return;
    setBusy("미리보기 생성 중");
    const response = await fetch("/api/keyword-shopling-apply/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_plan_json: buildCompactKeywordApplyExecutionPlan(preflight), mode: "dry_run", confirmation_text: "", max_items: 500 }) });
    const json = await response.json();
    const requestId = json.requestId ?? "";
    setDryRunRequestId(requestId);
    await pollJson<Record<string, unknown>>(`/api/keyword-shopling-apply/actions-result?request_id=${encodeURIComponent(requestId)}&mode=dry_run`, setDryRunResult);
    setBusy("시작 전");
  }, [blockedCount, dryRunRequestId, dryRunResult, pollJson, preflight, readyCount]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void runDryRunIfNeeded(); }, 0);
    return () => window.clearTimeout(timer);
  }, [runDryRunIfNeeded]);

  async function approveAndApply() {
    if (blockedCount > 0 || readyCount === 0) return;
    if (!window.confirm("실제 샵플링 상품명/검색어를 반영합니다. 계속하시겠습니까?")) return;
    setBusy("실제 반영 중");
    const response = await fetch("/api/keyword-shopling-apply/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_plan_json: buildCompactKeywordApplyExecutionPlan(preflight), mode: "apply", confirmation_text: APPLY_CONFIRMATION_TEXT, max_items: 500 }) });
    const json = await response.json();
    const requestId = json.requestId ?? "";
    setRealApplyRequestId(requestId);
    const result = await pollJson<Record<string, unknown>>(`/api/keyword-shopling-apply/actions-result?request_id=${encodeURIComponent(requestId)}&mode=apply`, setApplyResult);
    setBusy("시작 전");
    if (result && finalPriceStartedForApplyRef.current !== requestId) {
      finalPriceStartedForApplyRef.current = requestId;
      await runPriceModify(true);
    }
  }

  const issueCount = blockedCount + needsReviewCount;
  const progress = stage === "출시 완료" ? 100 : stage === "시작 전" ? 0 : stage === "상품업로드 중" ? 15 : stage === "가격 1차 적용 중" ? 35 : stage === "후보 입력 대기" ? 50 : stage === "검토 완료 - 승인 대기" ? 75 : stage === "실제 반영 중" ? 85 : stage === "가격 최종 재적용 중" ? 95 : 60;

  return <div className="space-y-6">
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
      <p className="text-sm font-black text-emerald-700">AI 상품출시 에이전트</p>
      <div className="mt-4 grid gap-3 md:grid-cols-5"><SummaryCard label="현재 단계" value={stage} /><SummaryCard label="다음 작업" value={nextActionForStage(stage)} /><SummaryCard label="진행률" value={`${progress}%`} /><SummaryCard label="문제 수" value={issueCount} /><SummaryCard label="마지막 확인 시각" value={lastCheckedAt || "-"} /></div>
    </section>

    <form onSubmit={startLaunch} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">행번호 입력</h2>
      <label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행 번호 입력<input value={rowExpression} onChange={(event) => setRowExpression(event.target.value)} placeholder="예: 950 또는 950,951 또는 950-952" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
      <button type="submit" disabled={busy !== "시작 전" || !rowExpression.trim()} className="mt-5 rounded-lg bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">상품출시 시작</button>
    </form>

    {sourceRowGroups.length > 0 ? <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">행별 상품명/검색어 후보 입력</h2>
      <p className="mt-2 text-sm font-semibold text-slate-700">실재고 시트 행마다 상품명에 사용할 좋은 후보와 검색어 후보를 입력하세요.<br />같은 행에서 생성된 도매/소매 상품들은 이 후보군을 함께 사용합니다.<br />입력한 후보만 재료로 사용해 쇼핑몰별 상품명을 다르게 만듭니다.</p>
      <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-900">검색어는 상품별 1세트로 반영됩니다. 쇼핑몰별 차별화는 상품명에서 적용합니다.</p>
      <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">실재고 행</th><th className="border border-slate-200 px-3 py-2">생성 상품 요약</th><th className="border border-slate-200 px-3 py-2">현재 상품명</th><th className="border border-slate-200 px-3 py-2">상품명 후보 입력</th><th className="border border-slate-200 px-3 py-2">검색어 후보 입력</th><th className="border border-slate-200 px-3 py-2">상태</th></tr></thead><tbody>{sourceRowGroups.map((group) => <tr key={group.sourceRowId}><td className="border border-slate-200 px-3 py-2 font-mono font-bold">{group.displayLabel}</td><td className="border border-slate-200 px-3 py-2">{group.productGroups.join("·") || "상품그룹 확인 필요"} / goods_key {group.goodsKeys.length}개</td><td className="border border-slate-200 px-3 py-2">{group.currentTitle}</td><td className="border border-slate-200 px-3 py-2"><input value={manualTitleCandidatesBySourceRow[group.sourceRowId] ?? ""} onChange={(event) => setManualTitleCandidatesBySourceRow((current) => ({ ...current, [group.sourceRowId]: event.target.value }))} placeholder="게임패드,컨트롤러,조이스틱,미니,듀얼센스" className="w-72 rounded-lg border border-slate-300 px-3 py-2" /></td><td className="border border-slate-200 px-3 py-2"><input value={manualSearchCandidatesBySourceRow[group.sourceRowId] ?? ""} onChange={(event) => setManualSearchCandidatesBySourceRow((current) => ({ ...current, [group.sourceRowId]: event.target.value }))} placeholder="게임패드,컨트롤러,조이스틱,미니,게임장비,보조기기" className="w-72 rounded-lg border border-slate-300 px-3 py-2" /></td><td className="border border-slate-200 px-3 py-2 font-bold">{group.goodsKeys.every((goodsKey) => preview.items.some((item) => item.goods_key === goodsKey && item.payload_status === "preview_ready")) ? "준비 완료" : "후보 입력 필요"}</td></tr>)}</tbody></table></div>
    </section> : null}

    {sourceRowGroups.length > 0 ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">쇼핑몰별 상품명 미리보기</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-5"><SummaryCard label="총 반영 대상" value={preview.items.length} /><SummaryCard label="상품명 생성 완료" value={readyCount} /><SummaryCard label="검색어 생성 완료" value={preview.items.filter((item) => item.final_site_srch).length} /><SummaryCard label="검토 필요" value={needsReviewCount} /><SummaryCard label="차단" value={blockedCount} /></div>
      <details className="mt-4"><summary className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">전체 항목 펼쳐보기</summary><div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">실재고 행</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">쇼핑몰</th><th className="border border-slate-200 px-3 py-2">상품번호</th><th className="border border-slate-200 px-3 py-2">생성 상품명</th><th className="border border-slate-200 px-3 py-2">검색어</th><th className="border border-slate-200 px-3 py-2">상태</th><th className="border border-slate-200 px-3 py-2">사유</th></tr></thead><tbody>{preview.items.map((item, index) => <tr key={`${item.goods_key}-${item.mall_key}-${index}`}><td className="border border-slate-200 px-3 py-2">{item.source_row_index}</td><td className="border border-slate-200 px-3 py-2">{item.product_group}</td><td className="border border-slate-200 px-3 py-2">{item.market_name}</td><td className="border border-slate-200 px-3 py-2 font-mono">{item.goods_key}</td><td className="border border-slate-200 px-3 py-2">{item.final_title}</td><td className="border border-slate-200 px-3 py-2">{item.final_site_srch}</td><td className="border border-slate-200 px-3 py-2 font-bold">{item.payload_status === "preview_ready" ? "안전" : "차단"}</td><td className="border border-slate-200 px-3 py-2">{[...item.validation_errors, ...item.validation_warnings].join(", ") || "-"}</td></tr>)}</tbody></table></div></details>
    </section> : null}

    {sourceRowGroups.length > 0 ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">최종 반영 전 검토</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-5"><SummaryCard label="안전" value={readyCount} /><SummaryCard label="검토 필요" value={needsReviewCount} /><SummaryCard label="차단" value={blockedCount} /><SummaryCard label="검색어 부족" value={searchShortCount} /><SummaryCard label="위험 키워드" value={0} /></div>
      <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{blockedCount > 0 ? "검토 실패. 고급 진단에서 원인을 확인하세요." : "검토 완료. 승인하면 실제 반영할 수 있습니다."}</p>
      <button type="button" onClick={approveAndApply} disabled={blockedCount > 0 || readyCount === 0 || busy !== "시작 전"} className="mt-5 rounded-lg bg-red-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">승인하고 실제 반영 실행</button>
    </section> : null}

    <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><summary className="cursor-pointer text-lg font-bold text-slate-950">개발자 진단 보기</summary><pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-50">{JSON.stringify({ runResult, uploadRequestId, priceRequestId, dryRunRequestId, realApplyRequestId, finalPriceRequestId, uploadResultRows, priceResult, dryRunResult, applyResult, finalPriceResult, preflightSummary: preflight.summary }, null, 2)}</pre></details>
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-950">{value}</p></div>; }
function nextActionForStage(stage: LaunchStage) { if (stage === "시작 전") return "행 번호를 입력하세요."; if (stage === "후보 입력 대기") return "행별 후보를 입력하세요."; if (stage === "검토 완료 - 승인 대기") return "승인 버튼을 누르세요."; if (stage === "차단 항목 있음") return "차단 사유를 수정하세요."; if (stage === "출시 완료") return "완료"; return "자동 처리 중"; }
function deriveStage(input: { busy: LaunchStage; uploadResult: UploadActionsResult | null; priceResult: PriceActionsResult | null; sourceRowGroups: unknown[]; readyCount: number; blockedCount: number; dryRunResult: Record<string, unknown> | null; applyResult: Record<string, unknown> | null; finalPriceResult: PriceActionsResult | null }): LaunchStage { if (input.busy !== "시작 전") return input.busy; if (input.finalPriceResult && isSuccessfulResult(input.finalPriceResult)) return "출시 완료"; if (input.applyResult && isSuccessfulResult(input.applyResult)) return "가격 최종 재적용 중"; if (input.blockedCount > 0) return "차단 항목 있음"; if (input.readyCount > 0 && input.dryRunResult) return "검토 완료 - 승인 대기"; if (input.sourceRowGroups.length > 0) return "후보 입력 대기"; if (input.priceResult) return "후보 입력 대기"; if (input.uploadResult) return "가격 1차 적용 중"; return "시작 전"; }
function isFinalActionsResult(value: unknown) { const text = JSON.stringify(value ?? {}).toLowerCase(); return /success|failed|failure|completed|error/.test(text); }
function isSuccessfulResult(value: unknown) { const text = JSON.stringify(value ?? {}).toLowerCase(); return /success|completed/.test(text) && !/failed|failure|error/.test(text); }
function currentManualScope(rowExpression: string, uploadRequestId: string) { return (uploadRequestId || parseLaunchRowExpression(rowExpression).join("_") || "default").replace(/[^a-zA-Z0-9_-]/g, "_"); }
function readProductLaunchSession(): ProductLaunchSessionV2 | null { if (typeof window === "undefined") return null; try { const parsed = JSON.parse(window.localStorage.getItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY) ?? "null"); return parsed && typeof parsed === "object" ? parsed as ProductLaunchSessionV2 : null; } catch { return null; } }
function persistProductLaunchSession(session: ProductLaunchSessionV2) { if (typeof window !== "undefined") window.localStorage.setItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY, JSON.stringify(session)); }
function readStoredRecord(key: string): Record<string, string> { if (typeof window === "undefined") return {}; try { const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}"); return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {}; } catch { return {}; } }
function persistRecord(key: string, value: Record<string, string>) { if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value)); }
