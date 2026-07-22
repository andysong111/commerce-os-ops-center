"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildGoodsKeyGroupJson,
  buildLaunchSourceRowGroups,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  extractUploadRows,
  inferProductGroupFromPtnGoodsCd,
  normalizeManualKeywordOverride,
  parseLaunchRowExpression,
  type LaunchSourceRowGroup,
  type ProductLaunchUploadRow,
} from "@/lib/productLaunchFlow";

const APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING";
const MAX_APPLY_ITEMS = 100;
const PRODUCT_LAUNCH_SESSION_STORAGE_KEY = "productLaunchFlow.manualWizard.v1";

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string };
type UploadActionsResult = { status?: string; phase?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: Record<string, unknown> };
type PriceActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: Record<string, unknown> };
type ApplyActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: Record<string, unknown> };
type CandidateInputs = Record<string, { title: string; search: string }>;
type PreviewItem = { sourceRowId: string; goodsKey: string; productGroup: string; mallKey: string; mallName: string; generatedTitle: string; searchKeywords: string; status: string };
type Session = { rowExpression?: string; uploadRequestId?: string; priceRequestId?: string; finalPriceRequestId?: string; applyRequestId?: string; inputs?: CandidateInputs; uploadResult?: UploadActionsResult | null; priceResult?: PriceActionsResult | null; applyResult?: ApplyActionsResult | null; finalPriceResult?: PriceActionsResult | null };

const MALLS_BY_GROUP: Record<string, Array<[string, string]>> = {
  "도매1": [["cafe24", "카페24"], ["domeme", "도매매"], ["domeggook", "도매꾹"], ["ownerclan", "오너클랜"], ["lotteon", "롯데온"], ["auction", "옥션"], ["gmarket", "지마켓"], ["interpark", "인터파크"], ["11st", "11번가"], ["wemakeprice", "위메프"]],
  "도매2": [["coupang", "쿠팡"], ["smartstore", "스마트스토어"], ["esm", "ESM"], ["talkstore", "톡스토어"]],
  "도매3": [["ssg", "SSG"], ["lotteimall", "롯데아이몰"], ["cjmall", "CJ온스타일"], ["hmall", "현대H몰"]],
  "도매4": [["wholesale", "도매"]],
  "소매1": [["smartstore", "스마트스토어"], ["coupang", "쿠팡"], ["11st", "11번가"], ["gmarket", "지마켓"], ["auction", "옥션"], ["lotteon", "롯데온"], ["ssg", "SSG"], ["wemakeprice", "위메프"], ["tmon", "티몬"], ["interpark", "인터파크"], ["ably", "에이블리"], ["zigzag", "지그재그"]],
  "소매2": [["smartstore", "스마트스토어"], ["coupang", "쿠팡"], ["11st", "11번가"], ["gmarket", "지마켓"], ["ably", "에이블리"]],
};

export function ProductLaunchFlow() {
  const restored = useMemo(() => readSession(), []);
  const [rowExpression, setRowExpression] = useState(restored?.rowExpression ?? "");
  const [uploadRequestId, setUploadRequestId] = useState(restored?.uploadRequestId ?? "");
  const [priceRequestId, setPriceRequestId] = useState(restored?.priceRequestId ?? "");
  const [applyRequestId, setApplyRequestId] = useState(restored?.applyRequestId ?? "");
  const [finalPriceRequestId, setFinalPriceRequestId] = useState(restored?.finalPriceRequestId ?? "");
  const [uploadResult, setUploadResult] = useState<UploadActionsResult | null>(restored?.uploadResult ?? null);
  const [priceResult, setPriceResult] = useState<PriceActionsResult | null>(restored?.priceResult ?? null);
  const [applyResult, setApplyResult] = useState<ApplyActionsResult | null>(restored?.applyResult ?? null);
  const [finalPriceResult, setFinalPriceResult] = useState<PriceActionsResult | null>(restored?.finalPriceResult ?? null);
  const [candidateInputs, setCandidateInputs] = useState<CandidateInputs>(restored?.inputs ?? {});
  const [busy, setBusy] = useState<"" | "upload" | "price" | "preview" | "apply" | "finalPrice">("");
  const [previewGenerated, setPreviewGenerated] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const uploadRows = useMemo(() => extractRowsWithGoodsKey(uploadResult), [uploadResult]);
  const allUploadRows = useMemo(() => extractUploadRows(uploadResult), [uploadResult]);
  const goodsKeys = useMemo(() => dedupeGoodsKeysForPriceModify(uploadRows), [uploadRows]);
  const sourceRowGroups = useMemo(() => buildLaunchSourceRowGroups(uploadRows, rowExpression), [uploadRows, rowExpression]);
  const previewItems = useMemo(() => buildManualPreviewItems(sourceRowGroups, uploadRows, candidateInputs), [candidateInputs, sourceRowGroups, uploadRows]);
  const representativeItems = useMemo(() => sourceRowGroups.map((group) => previewItems.find((item) => item.sourceRowId === group.sourceRowId)).filter((item): item is PreviewItem => !!item), [previewItems, sourceRowGroups]);
  const allRowsReady = sourceRowGroups.length > 0 && sourceRowGroups.every((group) => hasCandidate(candidateInputs[group.sourceRowId]));
  const blockedCount = getBlockedCount({ uploadResult, priceResult, applyResult, finalPriceResult, previewItems, allRowsReady });
  const maxItemsBlocked = previewItems.length > MAX_APPLY_ITEMS;
  const validationSuccess = previewGenerated && previewItems.length > 0 && !maxItemsBlocked;
  const canApprove = allRowsReady && validationSuccess && blockedCount === 0 && !busy;
  const status = getWizardStatus({ busy, uploadRows, uploadResult, priceResult, allRowsReady, previewGenerated, blockedCount: blockedCount + (maxItemsBlocked ? 1 : 0), applyResult, finalPriceResult });
  const progress = getProgress(status);
  const nextAction = getNextAction(status, sourceRowGroups.length, allRowsReady, previewGenerated, maxItemsBlocked);

  useEffect(() => {
    saveSession({ rowExpression, uploadRequestId, priceRequestId, applyRequestId, finalPriceRequestId, inputs: candidateInputs, uploadResult, priceResult, applyResult, finalPriceResult });
  }, [applyRequestId, applyResult, candidateInputs, finalPriceRequestId, finalPriceResult, priceRequestId, priceResult, rowExpression, uploadRequestId, uploadResult]);

  const startLaunch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rowExpression.trim() || busy) return;
    setBusy("upload");
    setPreviewGenerated(false);
    setApplyResult(null);
    setFinalPriceResult(null);
    try {
      const uploadRun = await postJson<RunResult>("/api/shopling-product-upload/run", { rowExpression, channel: "", skip_if_goods_key: true, dump: false, sleep: "1.2" });
      const requestId = uploadRun.requestId ?? "";
      setUploadRequestId(requestId);
      const upload = await fetchUploadResult(requestId);
      setUploadResult(upload);
      const rows = extractRowsWithGoodsKey(upload);
      if (isSuccessfulUploadResult(upload, rows.length)) {
        setBusy("price");
        const priceRun = await postJson<RunResult>("/api/shopling-price-modify/run", { goods_key: dedupeGoodsKeysForPriceModify(rows).join(","), goods_key_group_json: buildGoodsKeyGroupJson(rows), policy_overrides: [] });
        setPriceRequestId(priceRun.requestId ?? "");
        setPriceResult(await fetchPriceResult(priceRun.requestId ?? ""));
      }
    } catch (error) {
      setUploadResult({ status: "error", message: error instanceof Error ? error.message : "상품출시 시작 중 문제가 발생했습니다." });
    } finally {
      setLastCheckedAt(new Date());
      setBusy("");
    }
  };

  const generatePreview = () => {
    if (!allRowsReady) return;
    setBusy("preview");
    window.setTimeout(() => { setPreviewGenerated(true); setLastCheckedAt(new Date()); setBusy(""); }, 100);
  };

  const approveAndApply = async () => {
    if (!canApprove) return;
    setBusy("apply");
    try {
      const applyRun = await postJson<RunResult>("/api/keyword-shopling-apply/run", { execution_plan_json: JSON.stringify({ source: "manual_product_launch_wizard", items: previewItems, search_keywords_by_goods_key: buildSearchKeywordsByGoodsKey(sourceRowGroups, candidateInputs) }), mode: "apply", confirmation_text: APPLY_CONFIRMATION_TEXT, max_items: Math.min(MAX_APPLY_ITEMS, previewItems.length) });
      setApplyRequestId(applyRun.requestId ?? "");
      const applied = await fetchApplyResult(applyRun.requestId ?? "");
      setApplyResult(applied);
      if (isSuccessfulApplyResult(applied)) {
        setBusy("finalPrice");
        const finalRun = await postJson<RunResult>("/api/shopling-price-modify/run", { goods_key: goodsKeys.join(","), goods_key_group_json: buildGoodsKeyGroupJson(uploadRows), policy_overrides: [], reason: "finalize_after_manual_product_launch_apply" });
        setFinalPriceRequestId(finalRun.requestId ?? "");
        setFinalPriceResult(await fetchPriceResult(finalRun.requestId ?? ""));
      }
    } catch (error) {
      setApplyResult({ status: "error", message: error instanceof Error ? error.message : "실제 반영 실행 중 문제가 발생했습니다." });
    } finally {
      setLastCheckedAt(new Date());
      setBusy("");
    }
  };

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">상품출시 진행상태</h2>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <StatusItem label="현재 단계" value={status} />
        <StatusItem label="다음 작업" value={nextAction} />
        <StatusItem label="진행률" value={`${progress}%`} />
        <StatusItem label="문제 수" value={String(blockedCount + (maxItemsBlocked ? 1 : 0))} tone={blockedCount || maxItemsBlocked ? "danger" : "normal"} />
        <StatusItem label="마지막 확인 시각" value={lastCheckedAt ? lastCheckedAt.toLocaleString("ko-KR") : "-"} />
      </dl>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">행번호 입력</h2>
      <form onSubmit={startLaunch} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm font-bold text-slate-800">실재고 시트 행 번호 입력
          <input value={rowExpression} onChange={(event) => setRowExpression(event.target.value)} placeholder="950 또는 950,951 또는 950-952" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={busy !== "" || parseLaunchRowExpression(rowExpression).length === 0} className="self-end rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "upload" || busy === "price" ? "실제 반영 확인 중" : "상품출시 시작"}</button>
      </form>
    </section>

    {sourceRowGroups.length > 0 ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">행별 상품명/검색어 후보 입력</h2>
      <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">{`실재고 시트 행마다 상품명 후보와 검색어 후보를 입력하세요.\n같은 행에서 생성된 도매/소매 상품들은 이 후보군을 함께 사용합니다.\n입력한 후보만 사용해 쇼핑몰별 상품명을 다르게 만듭니다.`}</p>
      <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-900">검색어는 상품별 1세트로 반영됩니다. 쇼핑몰별 차별화는 상품명에서 적용합니다.</p>
      <div className="mt-5 space-y-4">{sourceRowGroups.map((group) => <CandidateCard key={group.sourceRowId} group={group} value={candidateInputs[group.sourceRowId] ?? { title: "", search: "" }} onChange={(value) => { setPreviewGenerated(false); setCandidateInputs((current) => ({ ...current, [group.sourceRowId]: value })); }} />)}</div>
      {!allRowsReady ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">행별 상품명/검색어 후보를 입력하면 미리보기를 생성합니다.</p> : null}
      {allRowsReady && !previewGenerated ? <button type="button" onClick={generatePreview} disabled={busy !== ""} className="mt-5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "preview" ? "미리보기 생성 중" : "후보 입력 후 미리보기 생성"}</button> : null}
    </section> : null}

    {sourceRowGroups.length > 0 ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">최종 반영 전 검토</h2>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-4"><Summary label="입력 행" value={sourceRowGroups.length} /><Summary label="생성 상품" value={goodsKeys.length} /><Summary label="미리보기 항목" value={previewItems.length} /><Summary label="차단 항목" value={blockedCount + (maxItemsBlocked ? 1 : 0)} /></div>
      {maxItemsBlocked ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-black text-red-800">한 번에 반영 가능한 항목은 100개입니다. 행을 나누어 실행하세요.</p> : null}
      <h3 className="mt-6 text-lg font-black text-slate-900">대표 미리보기</h3>
      <PreviewTable items={representativeItems} emptyMessage={previewGenerated ? "대표 항목이 없습니다." : "후보 입력 후 미리보기를 생성하세요."} />
      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm font-black text-slate-800">전체 {previewItems.length}개 항목 펼쳐보기</summary>
        <PreviewTable items={previewItems} emptyMessage="전체 항목이 없습니다." />
      </details>
      <button type="button" onClick={approveAndApply} disabled={!canApprove} className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "apply" ? "실제 반영 확인 중" : busy === "finalPrice" ? "가격 최종 재적용 중" : finalPriceResult && isSuccessfulPriceResult(finalPriceResult) ? "출시 완료" : "승인하고 실제 반영 실행"}</button>
    </section> : null}

    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <summary className="cursor-pointer text-sm font-black text-slate-800">개발자 진단 보기</summary>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-50">{JSON.stringify({ requestIds: { uploadRequestId, priceRequestId, applyRequestId, finalPriceRequestId }, uploadRunRows: allUploadRows, rawSummaries: { uploadResult, priceResult, applyResult, finalPriceResult }, previewItems, confirmationText: APPLY_CONFIRMATION_TEXT, max_items: Math.min(MAX_APPLY_ITEMS, previewItems.length) }, null, 2)}</pre>
    </details>
  </div>;
}

function CandidateCard({ group, value, onChange }: { group: LaunchSourceRowGroup; value: { title: string; search: string }; onChange: (value: { title: string; search: string }) => void }) {
  const ready = hasCandidate(value);
  return <article className="rounded-xl border border-slate-200 p-4">
    <dl className="grid gap-3 text-sm md:grid-cols-3"><StatusItem label="실재고 행" value={group.displayLabel} /><StatusItem label="생성 상품 요약" value={`${group.goodsKeys.length}개 / ${group.productGroups.join(", ") || "상품그룹 확인 필요"}`} /><StatusItem label="현재 상품명" value={group.currentTitle || "-"} /></dl>
    <label className="mt-4 block text-sm font-bold text-slate-800">상품명 후보 입력
      <input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="게임패드,컨트롤러,조이스틱,미니,듀얼센스" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    </label>
    <label className="mt-4 block text-sm font-bold text-slate-800">검색어 후보 입력
      <input value={value.search} onChange={(event) => onChange({ ...value, search: event.target.value })} placeholder="게임패드,컨트롤러,조이스틱,미니,게임장비,보조기기" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    </label>
    <p className={ready ? "mt-3 text-sm font-black text-emerald-700" : "mt-3 text-sm font-black text-amber-700"}>상태: {ready ? "후보 입력 완료" : "후보 입력 대기"}</p>
  </article>;
}

function PreviewTable({ items, emptyMessage }: { items: PreviewItem[]; emptyMessage: string }) {
  return <div className="mt-3 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">실재고 행</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">대표 쇼핑몰</th><th className="border border-slate-200 px-3 py-2">생성 상품명</th><th className="border border-slate-200 px-3 py-2">검색어</th><th className="border border-slate-200 px-3 py-2">상태</th></tr></thead><tbody>{items.length ? items.map((item) => <tr key={`${item.goodsKey}-${item.mallKey}`}><td className="border border-slate-200 px-3 py-2">{item.sourceRowId}</td><td className="border border-slate-200 px-3 py-2">{item.productGroup}</td><td className="border border-slate-200 px-3 py-2">{item.mallName}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{item.generatedTitle}</td><td className="border border-slate-200 px-3 py-2">{item.searchKeywords}</td><td className="border border-slate-200 px-3 py-2">{item.status}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={6}>{emptyMessage}</td></tr>}</tbody></table></div>;
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{value}</p></div>; }
function StatusItem({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" }) { return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className={tone === "danger" ? "mt-1 font-black text-red-700" : "mt-1 font-black text-slate-950"}>{value}</dd></div>; }

export function parseManualCandidates(value: string) { return normalizeManualKeywordOverride(value).split(",").filter(Boolean); }
export function rotateMallTitleCandidates(candidates: string[], mallIndex: number) { const source = candidates.map((item) => item.replace(/,/g, " ").trim()).filter(Boolean); if (!source.length) return ""; const rotated = source.map((_, index) => source[(index + mallIndex) % source.length]); return rotated.join(" ").replace(/\s+/g, " ").slice(0, 80).trim(); }
export function normalizeManualSearchKeywords(searchValue: string, titleValue: string) { return normalizeManualKeywordOverride(searchValue || titleValue); }

function buildManualPreviewItems(groups: LaunchSourceRowGroup[], rows: ProductLaunchUploadRow[], inputs: CandidateInputs): PreviewItem[] {
  const rowsByGoodsKey = new Map(rows.map((row) => [(row.goods_key ?? "").trim(), row]));
  return groups.flatMap((group) => {
    const input = inputs[group.sourceRowId] ?? { title: "", search: "" };
    const titleCandidates = parseManualCandidates(input.title);
    const fallbackTitleCandidates = titleCandidates.length ? titleCandidates : parseManualCandidates(input.search || group.currentTitle);
    const searchKeywords = normalizeManualSearchKeywords(input.search, input.title);
    return group.goodsKeys.flatMap((goodsKey) => {
      const uploadRow = rowsByGoodsKey.get(goodsKey);
      const productGroup = inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").productGroup;
      const malls = MALLS_BY_GROUP[productGroup] ?? [["default", "대표 쇼핑몰"]];
      return malls.map(([mallKey, mallName], index) => ({ sourceRowId: group.displayLabel, goodsKey, productGroup, mallKey, mallName, generatedTitle: rotateMallTitleCandidates(fallbackTitleCandidates, index), searchKeywords, status: fallbackTitleCandidates.length ? "검토 가능" : "차단 항목 있음" }));
    });
  });
}

function buildSearchKeywordsByGoodsKey(groups: LaunchSourceRowGroup[], inputs: CandidateInputs) { const entries = groups.flatMap((group) => { const keywords = normalizeManualSearchKeywords(inputs[group.sourceRowId]?.search ?? "", inputs[group.sourceRowId]?.title ?? ""); return group.goodsKeys.map((goodsKey) => [goodsKey, keywords]); }); return Object.fromEntries(entries); }
function hasCandidate(value?: { title: string; search: string }) { return parseManualCandidates(value?.title ?? "").length > 0 || parseManualCandidates(value?.search ?? "").length > 0; }
function getBlockedCount(input: { uploadResult: UploadActionsResult | null; priceResult: PriceActionsResult | null; applyResult: ApplyActionsResult | null; finalPriceResult: PriceActionsResult | null; previewItems: PreviewItem[]; allRowsReady: boolean }) { return (hasFailure(input.uploadResult) ? 1 : 0) + (hasFailure(input.priceResult) ? 1 : 0) + (hasFailure(input.applyResult) ? 1 : 0) + (hasFailure(input.finalPriceResult) ? 1 : 0) + (input.allRowsReady ? input.previewItems.filter((item) => !item.generatedTitle).length : 0); }
function getWizardStatus(input: { busy: string; uploadRows: ProductLaunchUploadRow[]; uploadResult: UploadActionsResult | null; priceResult: PriceActionsResult | null; allRowsReady: boolean; previewGenerated: boolean; blockedCount: number; applyResult: ApplyActionsResult | null; finalPriceResult: PriceActionsResult | null }) { if (input.busy === "upload") return "상품업로드 중"; if (input.busy === "price") return "가격 1차 적용 중"; if (input.busy === "preview") return "미리보기 생성 중"; if (input.busy === "apply") return "실제 반영 중"; if (input.busy === "finalPrice") return "가격 최종 재적용 중"; if (input.finalPriceResult && isSuccessfulPriceResult(input.finalPriceResult)) return "출시 완료"; if (hasFailure(input.uploadResult) || hasFailure(input.priceResult) || hasFailure(input.applyResult) || hasFailure(input.finalPriceResult)) return "실패 - 문제 확인 필요"; if (input.blockedCount > 0) return "차단 항목 있음"; if (!input.uploadRows.length) return "시작 전"; if (!isSuccessfulPriceResult(input.priceResult)) return "가격 1차 적용 중"; if (!input.allRowsReady) return "후보 입력 대기"; if (input.previewGenerated) return "검토 완료 - 승인 대기"; return "미리보기 생성 중"; }
function getProgress(status: string) { return ({ "시작 전": 0, "상품업로드 중": 15, "가격 1차 적용 중": 35, "후보 입력 대기": 50, "미리보기 생성 중": 65, "검토 완료 - 승인 대기": 80, "차단 항목 있음": 80, "실제 반영 중": 90, "가격 최종 재적용 중": 95, "출시 완료": 100, "실패 - 문제 확인 필요": 0 } as Record<string, number>)[status] ?? 0; }
function getNextAction(status: string, groupCount: number, ready: boolean, preview: boolean, maxBlocked: boolean) { if (maxBlocked) return "행을 나누어 실행하세요."; if (!groupCount) return "행 번호를 입력하고 상품출시를 시작하세요."; if (!ready) return "행별 후보를 입력하세요."; if (!preview) return "후보 입력 후 미리보기 생성"; if (status === "검토 완료 - 승인 대기") return "승인하고 실제 반영 실행"; if (status === "출시 완료") return "출시 완료"; return status; }
function hasFailure(result: { status?: string; runConclusion?: string | null; summary?: Record<string, unknown> } | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return ["error", "failed", "failure", "blocked", "partial_failure"].includes(status) || ["failure", "cancelled", "timed_out"].includes(conclusion); }
function isSuccessfulUploadResult(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return rowsWithGoodsKeyCount > 0 && !hasFailure(result as PriceActionsResult | null) && (["success", "completed"].includes(status) || conclusion === "success"); }
function isSuccessfulPriceResult(result: PriceActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return status === "success" || conclusion === "success"; }
function isSuccessfulApplyResult(result: ApplyActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return !["error", "failed", "failure", "blocked", "partial_failure"].includes(status) && (status === "success" || conclusion === "success"); }
async function postJson<T>(url: string, body: unknown): Promise<T> { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return response.json(); }
async function fetchUploadResult(requestId: string) { const suffix = requestId ? `?request_id=${encodeURIComponent(requestId)}` : ""; return (await fetch(`/api/shopling-product-upload/actions-result${suffix}`)).json(); }
async function fetchPriceResult(requestId: string) { const suffix = requestId ? `?request_id=${encodeURIComponent(requestId)}` : ""; return (await fetch(`/api/shopling-price-modify/actions-result${suffix}`)).json(); }
async function fetchApplyResult(requestId: string) { const suffix = requestId ? `?request_id=${encodeURIComponent(requestId)}&mode=apply` : "?mode=apply"; return (await fetch(`/api/keyword-shopling-apply/actions-result${suffix}`)).json(); }
function readSession(): Session | null { if (typeof window === "undefined") return null; try { const value = JSON.parse(window.localStorage.getItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY) ?? "null"); return value && typeof value === "object" ? value as Session : null; } catch { return null; } }
function saveSession(session: Session) { if (typeof window !== "undefined") window.localStorage.setItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY, JSON.stringify(session)); }
