"use client";

import Link from "next/link";
import { type KeywordApplyState } from "@/components/keyword-review/KeywordReviewWorkspace";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGoodsKeyGroupJson,
  buildGoodsKeyGroupMap,
  buildGoodsKeyProductGroupMap,
  buildKeywordEngineDispatchPayload,
  buildLaunchSourceRowGroups,
  expandSeedKeywordsBySourceRowToGoodsKeys,
  isSafeLaunchTitle,
  MISSING_SOURCE_ROW_WARNING,
  parseLaunchRowExpression,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  expectedLaunchApplyCount,
  expectedPriceModifyUpdateCount,
  FULL_PRICE_POLICY_MALL_COUNT,
  extractUploadRows,
  inferProductGroupFromPtnGoodsCd,
  normalizeManualKeywordOverride,
  normalizeSeedKeywords,
  resolveManualTitleOverride,
  type ProductLaunchPriceError,
  type ProductLaunchUploadRow,
} from "@/lib/productLaunchFlow";
import { getMarketsForProductGroup, PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import { buildCompactKeywordApplyExecutionPlan, buildKeywordExecutionPreflight, type KeywordExecutionPreflightResult } from "@/lib/keywordReviewExecutionPreflight";
import type { KeywordPayloadPreviewItem, KeywordPayloadPreviewResult } from "@/lib/keywordReviewPayloadPreview";

const PRODUCT_LAUNCH_SESSION_STORAGE_KEY = "productLaunchFlow.session.v2";
const UPLOAD_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.uploadRequestId";
const PRICE_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.priceRequestId";
const LAST_ROW_EXPRESSION_STORAGE_KEY = "productLaunchFlow.lastRowExpression";
const KEYWORD_SEED_STORAGE_KEY = "productLaunchFlow.keywordSeed";
const SEED_KEYWORDS_STORAGE_PREFIX = "productLaunchFlow.seedKeywordsBySourceRow";
const MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX = "productLaunchFlow.manualTitleOverrides";
const MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX = "productLaunchFlow.manualKeywordOverrides";
const KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY = "opsCenter.keywordEngine.importedArtifact.v1";
const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_MAX_POLLS = 24;
const ACTIVE_POLL_INTERVAL_MS = 5_000;
const ACTIVE_MAX_POLLS = 24;
const APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING";

const PRODUCT_LAUNCH_INLINE_REVIEW_COPY = [
  "현재 연결된 상품출시 작업",
  "상품업로드 request id",
  "가격설정 request id",
  "키워드 run id",
  "artifact name",
  "AI가 상품명 반영 준비",
  "상품명 첫 후보 자동 선택",
  "상품명 반영 커버리지",
  "누락 상품명 자동 보강",
  "상품그룹별 상품명 미리보기",
  "적용 계획 생성",
  "dry_run 실행",
  "실제 샵플링 반영 실행",
  "켜면 상품업로드 성공 후 가격설정과 키워드 dry_run까지 자동으로 이어서 진행합니다",
  "키워드 결과 후보가 아직 불러와지지 않았습니다",
  "승인된 상품명이 있어야 미리보기를 생성할 수 있습니다",
  "적용 계획을 먼저 생성하세요",
  "dry_run 성공 후 실제 반영이 가능합니다",
  "행별 상품명/검색어 후보를 입력하면 미리보기를 생성합니다.",
  APPLY_CONFIRMATION_TEXT,
] as const;

type RunResult = { status?: string; message?: string; requestId?: string; githubActionsUrl?: string; commandPreview?: string };
type UploadSummary = { status?: unknown; rows?: ProductLaunchUploadRow[]; goods_keys?: ProductLaunchUploadRow[] };
type UploadActionsResult = { status?: string; phase?: string; message?: string; requestId?: string; runId?: number; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: UploadSummary | unknown };
type PriceActionsResult = { status?: string; message?: string; requestId?: string; runStatus?: string; runConclusion?: string | null; runUrl?: string; summary?: { status?: unknown; exit_code?: unknown; goods_key_count?: unknown; estimated_mall_update_count?: unknown; policy_override_count?: unknown; ok_count?: unknown; fail_count?: unknown; failed_count?: unknown; not_applied_count?: unknown; blank_risk_count?: unknown; affected_malls?: unknown; errors?: ProductLaunchPriceError[]; verification_supported?: unknown; api_success_count?: unknown; required_update_count?: unknown; missing_price_count?: unknown; missing_mall_row_count?: unknown; mismatch_count?: unknown; visible_price_unrepaired_count?: unknown } };
type KeywordArtifact = { id: number; name: string; expired?: boolean; expected?: boolean };
type KeywordRun = { id: number; status?: string | null; conclusion?: string | null; createdAt?: string; htmlUrl?: string; artifacts?: KeywordArtifact[] };
type KeywordRunsResult = { status?: string; message?: string; actionsUrl?: string; expectedArtifactName?: string; outputReviewRoute?: string; runs?: KeywordRun[] };
type KeywordDispatchResult = { repo?: string; workflowFile?: string; actionsUrl?: string; expectedArtifactName?: string; message?: string };
type ProductLaunchSessionV2 = { rowExpression?: string; startedAt?: string; updatedAt?: string; uploadRequestId?: string; priceRequestId?: string; keywordRequestId?: string; keywordRunId?: string; keywordDryRunRequestId?: string; keywordRealApplyRequestId?: string; finalPriceRequestId?: string; uploadResult?: UploadActionsResult | null; priceResult?: PriceActionsResult | null; keywordResult?: KeywordRunsResult | null; finalPriceResult?: PriceActionsResult | null; seedKeywordsBySourceRow?: Record<string, string>; stage?: string };

export function ProductLaunchFlow() {
  void PRODUCT_LAUNCH_INLINE_REVIEW_COPY;
  const restoredSession = useMemo(() => readProductLaunchSession(), []);
  const [sessionRestored, setSessionRestored] = useState(() => !!restoredSession);
  const [uploadRecovered, setUploadRecovered] = useState(false);
  const [rowExpression, setRowExpression] = useState(() => restoredSession?.rowExpression ?? getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY));
  const [lastStartedRowExpression, setLastStartedRowExpression] = useState(() => restoredSession?.rowExpression ?? getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY));
  const [uploadRequestId, setUploadRequestId] = useState(() => restoredSession?.uploadRequestId ?? getStoredValue(UPLOAD_REQUEST_ID_STORAGE_KEY));
  const [priceRequestId, setPriceRequestId] = useState(() => restoredSession?.priceRequestId ?? getStoredValue(PRICE_REQUEST_ID_STORAGE_KEY));
  const [uploadRunning, setUploadRunning] = useState(false);
  const [uploadFetching, setUploadFetching] = useState(false);
  const [priceRunning, setPriceRunning] = useState(false);
  const [priceFetching, setPriceFetching] = useState(false);
  const [uploadRunResult, setUploadRunResult] = useState<RunResult | null>(null);
  const [uploadActionsResult, setUploadActionsResult] = useState<UploadActionsResult | null>(restoredSession?.uploadResult ?? null);
  const [uploadPolling, setUploadPolling] = useState(false);
  const [uploadPollStartedAt, setUploadPollStartedAt] = useState<number | null>(null);
  const [uploadLastCheckedAt, setUploadLastCheckedAt] = useState<Date | null>(null);
  const [uploadPollCount, setUploadPollCount] = useState(0);
  const [uploadNextCheckIn, setUploadNextCheckIn] = useState(0);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const uploadPollCountRef = useRef(0);
  const [priceRunResult, setPriceRunResult] = useState<RunResult | null>(null);
  const [priceActionsResult, setPriceActionsResult] = useState<PriceActionsResult | null>(restoredSession?.priceResult ?? null);
  const [pricePolling, setPricePolling] = useState(false);
  const [pricePollCount, setPricePollCount] = useState(0);
  const [priceLastCheckedAt, setPriceLastCheckedAt] = useState<Date | null>(null);
  const [finalPriceRequestId, setFinalPriceRequestId] = useState(restoredSession?.finalPriceRequestId ?? "");
  const [finalPriceRunResult, setFinalPriceRunResult] = useState<RunResult | null>(null);
  const [finalPriceActionsResult, setFinalPriceActionsResult] = useState<PriceActionsResult | null>(restoredSession?.finalPriceResult ?? null);
  const [finalPriceRunning, setFinalPriceRunning] = useState(false);
  const [finalPriceFetching, setFinalPriceFetching] = useState(false);
  const [finalPricePolling, setFinalPricePolling] = useState(false);
  const [finalPricePollCount, setFinalPricePollCount] = useState(0);
  const [finalPriceLastCheckedAt, setFinalPriceLastCheckedAt] = useState<Date | null>(null);
  const [keywordSeed, setKeywordSeed] = useState(() => getStoredValue(KEYWORD_SEED_STORAGE_KEY));
  const [seedKeywordsBySourceRow, setSeedKeywordsBySourceRow] = useState<Record<string, string>>(restoredSession?.seedKeywordsBySourceRow ?? {});
  const [manualTitleOverridesByGoodsKey, setManualTitleOverridesByGoodsKey] = useState<Record<string, string>>({});
  const [manualKeywordOverridesByGoodsKey, setManualKeywordOverridesByGoodsKey] = useState<Record<string, string>>({});
  const [keywordPreview, setKeywordPreview] = useState<unknown>(null);
  const [keywordDispatchResult, setKeywordDispatchResult] = useState<KeywordDispatchResult | null>(null);
  const [keywordRunsResult, setKeywordRunsResult] = useState<KeywordRunsResult | null>(restoredSession?.keywordResult ?? null);
  const [keywordImportMessage, setKeywordImportMessage] = useState<string>("");
  const [embeddedReviewOpen, setEmbeddedReviewOpen] = useState(false);
  const [keywordImportedAt, setKeywordImportedAt] = useState("");
  const [keywordBusy, setKeywordBusy] = useState<string>("");
  const [keywordPolling, setKeywordPolling] = useState(false);
  const [keywordPollCount, setKeywordPollCount] = useState(0);
  const [keywordLastCheckedAt, setKeywordLastCheckedAt] = useState<Date | null>(null);
  const [skipIfGoodsKey, setSkipIfGoodsKey] = useState(true);
  const [autopilotEnabled, setAutopilotEnabled] = useState(true);
  const [autoActualApplyEnabled, setAutoActualApplyEnabled] = useState(false);
  const [keywordApplyState, setKeywordApplyState] = useState<KeywordApplyState | null>(null);
  const [manualApplyState, setManualApplyState] = useState<KeywordApplyState | null>(null);
  const autoPriceStartedForUploadRequestRef = useRef<string>("");
  const autoKeywordStartedForPriceRequestRef = useRef<string>("");
  const autoKeywordImportedArtifactRef = useRef<string>("");
  const finalPriceStartedForRealApplyRequestRef = useRef<string>("");

  const uploadResultRows = useMemo(() => extractUploadRows(uploadActionsResult), [uploadActionsResult]);
  const uploadRows = useMemo(() => extractRowsWithGoodsKey(uploadActionsResult), [uploadActionsResult]);
  const goodsKeys = useMemo(() => dedupeGoodsKeysForPriceModify(uploadRows), [uploadRows]);
  const goodsKeyProductGroupMap = useMemo(() => buildGoodsKeyProductGroupMap(uploadRows), [uploadRows]);
  const uploadPollingFinal = isFinalUploadPollingResult(uploadActionsResult, uploadRows.length);
  const manualOverrideStorageScope = currentManualOverrideStorageScope(rowExpression, uploadRequestId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeedKeywordsBySourceRow(readStoredRecord(`${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`));
  }, [manualOverrideStorageScope]);

  useEffect(() => {
    persistRecord(`${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`, seedKeywordsBySourceRow);
  }, [manualOverrideStorageScope, seedKeywordsBySourceRow]);


  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualTitleOverridesByGoodsKey(readStoredRecord(`${MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`));
    setManualKeywordOverridesByGoodsKey(readStoredRecord(`${MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`));
  }, [manualOverrideStorageScope]);

  useEffect(() => {
    persistRecord(`${MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`, manualTitleOverridesByGoodsKey);
  }, [manualOverrideStorageScope, manualTitleOverridesByGoodsKey]);

  useEffect(() => {
    persistRecord(`${MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`, manualKeywordOverridesByGoodsKey);
  }, [manualOverrideStorageScope, manualKeywordOverridesByGoodsKey]);

  const pollUploadResult = useCallback(async (reset: boolean, requestIdOverride?: string) => {
    const effectiveRequestId = requestIdOverride || uploadRequestId;
    if (uploadFetching) return;
    if (reset) {
      uploadPollCountRef.current = 0;
      setUploadPollCount(0);
      setUploadElapsedSeconds(0);
      setUploadPollStartedAt(Date.now());
      setUploadPolling(true);
      setUploadNextCheckIn(0);
      setUploadActionsResult({ status: "pending", phase: "request_sent", requestId: effectiveRequestId, message: "상품업로드 실행을 확인하는 중입니다. 결과가 준비되면 자동으로 다음 단계로 이동합니다." });
    }
    uploadPollCountRef.current += 1;
    setUploadPollCount(uploadPollCountRef.current);
    setUploadFetching(true);
    try {
      const url = effectiveRequestId ? `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(effectiveRequestId)}` : "/api/shopling-product-upload/actions-result";
      const data = await (await fetch(url)).json();
      setUploadActionsResult(data);
      const rows = extractRowsWithGoodsKey(data);
      if (isSuccessfulUploadResult(data, rows.length)) setUploadRecovered(true);
      const final = isFinalUploadPollingResult(data, rows.length);
      if (final || uploadPollCountRef.current >= UPLOAD_MAX_POLLS) {
        setUploadPolling(false);
        setUploadNextCheckIn(0);
      } else {
        setUploadNextCheckIn(UPLOAD_POLL_INTERVAL_MS / 1_000);
      }
    } catch (error) {
      setUploadActionsResult({ status: "error", phase: "unknown", requestId: effectiveRequestId, message: error instanceof Error ? error.message : "상품업로드 결과를 가져오는 중 오류가 발생했습니다." });
      setUploadPolling(false);
      setUploadNextCheckIn(0);
    } finally {
      setUploadLastCheckedAt(new Date());
      setUploadFetching(false);
    }
  }, [uploadFetching, uploadRequestId]);

  const startUploadPolling = useCallback((requestId: string) => {
    uploadPollCountRef.current = 0;
    setUploadPollCount(0);
    setUploadElapsedSeconds(0);
    setUploadPollStartedAt(Date.now());
    setUploadPolling(true);
    setUploadNextCheckIn(0);
    setUploadActionsResult({ status: "pending", phase: "request_sent", requestId, message: "상품업로드 실행을 확인하는 중입니다. 결과가 준비되면 자동으로 다음 단계로 이동합니다." });
    void pollUploadResult(false, requestId);
  }, [pollUploadResult]);

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
      void pollUploadResult(false, uploadRequestId);
    }, UPLOAD_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [uploadPolling, uploadPollCount, uploadPollingFinal, uploadFetching, pollUploadResult, uploadRequestId]);

  const runUploadRequest = useCallback(async () => {
    if (uploadRunning || !rowExpression.trim()) return;
    setUploadRunning(true);
    setUploadRunResult(null);
    setUploadActionsResult(null);
    setPriceRunResult(null);
    setPriceActionsResult(null);
    setKeywordDispatchResult(null);
    setKeywordRunsResult(null);
    setKeywordImportMessage("");
    setKeywordApplyState(null);
    setFinalPriceRequestId("");
    setFinalPriceRunResult(null);
    setFinalPriceActionsResult(null);
    finalPriceStartedForRealApplyRequestRef.current = "";
    autoPriceStartedForUploadRequestRef.current = "";
    autoKeywordStartedForPriceRequestRef.current = "";
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
        startUploadPolling(data.requestId);
      }
    } catch (error) {
      setUploadRunResult({ status: "error", message: error instanceof Error ? error.message : "상품업로드 실행 요청 중 오류가 발생했습니다." });
    } finally {
      setUploadRunning(false);
    }
  }, [rowExpression, skipIfGoodsKey, startUploadPolling, uploadRunning]);

  const runUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runUploadRequest();
  };

  const fetchUploadResult = () => {
    void pollUploadResult(true, currentUploadRequestId || uploadRequestId);
  };

  const recoverLatestUploadResult = () => {
    void pollUploadResult(true, uploadRequestId);
  };

  const runPriceModify = useCallback(async () => {
    if (priceRunning || goodsKeys.length === 0) return;
    setPriceRunning(true);
    setPriceRunResult(null);
    try {
      const response = await fetch("/api/shopling-price-modify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goods_key: goodsKeys.join(","), goods_key_group_json: buildGoodsKeyGroupJson(uploadRows), policy_overrides: [] }),
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
  }, [goodsKeys, priceRunning, uploadRows]);

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


  const runFinalPriceModify = useCallback(async () => {
    if (finalPriceRunning || goodsKeys.length === 0) return;
    setFinalPriceRunning(true);
    setFinalPriceRunResult(null);
    setFinalPriceActionsResult(null);
    try {
      const response = await fetch("/api/shopling-price-modify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goods_key: goodsKeys.join(","), goods_key_group_json: buildGoodsKeyGroupJson(uploadRows), policy_overrides: [], reason: "finalize_after_keyword_apply" }),
      });
      const data = await response.json();
      setFinalPriceRunResult(data);
      if (typeof data.requestId === "string" && data.requestId) setFinalPriceRequestId(data.requestId);
    } catch (error) {
      setFinalPriceRunResult({ status: "error", message: error instanceof Error ? error.message : "가격 최종 재적용 실행 요청 중 오류가 발생했습니다." });
    } finally {
      setFinalPriceRunning(false);
      setFinalPricePolling(true);
      setFinalPricePollCount(0);
    }
  }, [finalPriceRunning, goodsKeys, uploadRows]);

  const fetchFinalPriceResult = useCallback(async () => {
    if (finalPriceFetching) return;
    setFinalPriceFetching(true);
    try {
      const url = finalPriceRequestId ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(finalPriceRequestId)}` : "/api/shopling-price-modify/actions-result";
      const data = await (await fetch(url)).json();
      setFinalPriceActionsResult(data);
      setFinalPriceLastCheckedAt(new Date());
      if (isFinalPriceResult(data)) setFinalPricePolling(false);
    } catch (error) {
      setFinalPriceActionsResult({ status: "error", message: error instanceof Error ? error.message : "가격 최종 재적용 결과를 가져오는 중 오류가 발생했습니다." });
    } finally {
      setFinalPriceFetching(false);
    }
  }, [finalPriceFetching, finalPriceRequestId]);

  useEffect(() => {
    if (!finalPricePolling || finalPriceFetching) return;
    if (finalPricePollCount >= ACTIVE_MAX_POLLS || isFinalPriceResult(finalPriceActionsResult)) return;
    const timer = window.setTimeout(() => {
      setFinalPricePollCount((count) => { const next = count + 1; if (next >= ACTIVE_MAX_POLLS) setFinalPricePolling(false); return next; });
      void fetchFinalPriceResult();
    }, finalPricePollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [finalPricePolling, finalPriceFetching, finalPricePollCount, finalPriceActionsResult, fetchFinalPriceResult]);

  const sourceRowGroups = useMemo(() => buildLaunchSourceRowGroups(uploadRows, lastStartedRowExpression || rowExpression), [lastStartedRowExpression, rowExpression, uploadRows]);
  const seedKeywordsByGoodsKey = useMemo(() => expandSeedKeywordsBySourceRowToGoodsKeys(seedKeywordsBySourceRow, sourceRowGroups), [seedKeywordsBySourceRow, sourceRowGroups]);
  const keywordPayload = useCallback(() => buildKeywordEngineDispatchPayload(uploadRows, keywordSeed, seedKeywordsByGoodsKey), [keywordSeed, seedKeywordsByGoodsKey, uploadRows]);

  const previewKeywordDispatch = async () => {
    if (keywordBusy) return;
    setKeywordBusy("preview");
    setKeywordPreview(null);
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      persistRecord(`${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`, seedKeywordsBySourceRow);
      const response = await fetch("/api/engine-runners/dispatch-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keywordPayload()) });
      setKeywordPreview(await response.json());
    } catch (error) {
      setKeywordPreview({ status: "error", message: error instanceof Error ? error.message : "키워드 엔진 입력값 확인 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  };

  const dispatchKeywordEngine = useCallback(async () => {
    if (keywordBusy) return;
    setKeywordBusy("dispatch");
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      persistRecord(`${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`, seedKeywordsBySourceRow);
      const response = await fetch("/api/engine-runners/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keywordPayload()) });
      setKeywordDispatchResult(await response.json());
      setKeywordPolling(true);
      setKeywordPollCount(0);
    } catch (error) {
      setKeywordDispatchResult({ message: error instanceof Error ? error.message : "키워드 엔진 실행 요청 중 오류가 발생했습니다." });
    } finally { setKeywordBusy(""); }
  }, [keywordBusy, keywordPayload, keywordSeed, manualOverrideStorageScope, seedKeywordsBySourceRow]);

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
      const importedAt = new Date().toISOString();
      window.sessionStorage.setItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY, JSON.stringify({ kind: data.kind, source: data.source, files: data.files, generatedSourceFiles: data.generatedSourceFiles, goodsKeyGroupMap: buildGoodsKeyGroupMap(uploadRows), importedAt, artifactName: artifact.name, notAppliedToShopling: true, notPublished: true, requiresHumanReview: true }));
      setKeywordImportedAt(importedAt);
      setEmbeddedReviewOpen(true);
      setKeywordImportMessage("키워드 결과 파일이 준비되었습니다. 이 화면에서 상품명 후보 선택부터 실제 반영 전 dry_run까지 이어서 진행합니다.");
    } catch (error) {
      setKeywordImportMessage(error instanceof Error ? error.message : "키워드 결과 가져오기에 실패했습니다.");
    } finally { setKeywordBusy(""); }
  };


  const openInlineKeywordReview = async () => {
    const artifact = keywordSummary.artifact;
    const run = keywordRunsResult?.runs?.find((item) => item.artifacts?.some((candidate) => candidate.id === artifact?.id));
    if (artifact && run) {
      await importKeywordArtifact(run, artifact);
      return;
    }
    if (typeof window !== "undefined" && window.sessionStorage.getItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY)) {
      setEmbeddedReviewOpen(true);
      return;
    }
    setKeywordImportMessage("키워드 결과 파일은 불러왔지만 검토할 후보가 없습니다. GitHub Actions 로그 또는 artifact 파일을 확인하세요.");
  };

  const rowMatchesCurrentRun = rowExpression === lastStartedRowExpression;
  const currentUploadRequestId = rowMatchesCurrentRun ? uploadRequestId : "";
  const uploadGithubActionsUrl = currentUploadRequestId ? uploadActionsResult?.runUrl ?? uploadRunResult?.githubActionsUrl : undefined;
  const priceGithubActionsUrl = finalPriceRunResult?.githubActionsUrl ?? priceRunResult?.githubActionsUrl;
  const keywordGithubActionsUrl = keywordRunsResult?.runs?.[0]?.htmlUrl ?? keywordDispatchResult?.actionsUrl ?? keywordRunsResult?.actionsUrl;
  const uploadCounts = getUploadCounts(uploadActionsResult, uploadResultRows, uploadRows);
  const priceCounts = getPriceCounts(finalPriceActionsResult ?? priceActionsResult, goodsKeys.length);
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
  const boardMallCount = expectedPriceModifyUpdateCount(goodsKeyProductGroupMap);
  const titleTargetCount = expectedLaunchApplyCount(goodsKeys, buildGoodsKeyGroupMap(uploadRows));
  const manualCandidatesReady = hasManualCandidatesForAllSourceRows(sourceRowGroups, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey);
  const keywordRealApplySucceeded = isKeywordRealApplySuccess(manualApplyState ?? keywordApplyState);
  const finalPriceDone = isSuccessfulPriceResult(finalPriceActionsResult) && getPriceCounts(finalPriceActionsResult, goodsKeys.length).failCount === 0;
  const finalPriceFailed = hasPriceFailure(finalPriceActionsResult) || getPriceCounts(finalPriceActionsResult, goodsKeys.length).failCount > 0;
  const finalPriceActive = finalPriceRunning || finalPriceFetching || finalPricePolling;
  const actualApplyDone = (isSuccessfulPriceResult(priceActionsResult) || finalPriceDone) && keywordRealApplySucceeded && finalPriceDone;
  const priceIssueState = getPriceIssueState(finalPriceActionsResult ?? priceActionsResult);
  const keywordWarningCount = getKeywordWarningCount(keywordApplyState);
  const issueCount = getLaunchBoardIssueCount({ priceIssueState, uploadRows, goodsKeys, titleTargetCount, keywordApplyState, cockpit });
  const derivedStage = deriveLaunchStage({ uploadActionsResult, uploadRowsCount: uploadRows.length, priceActionsResult, keywordRunsResult, keywordApplyState, finalPriceActionsResult, manualCandidatesReady });
  const currentRequestId = getRequestIdForStage(derivedStage, { uploadRequestId: currentUploadRequestId || uploadRequestId, priceRequestId, keywordRequestId: keywordDispatchResult?.expectedArtifactName ?? String(keywordRunsResult?.runs?.[0]?.id ?? restoredSession?.keywordRequestId ?? restoredSession?.keywordRunId ?? ""), keywordDryRunRequestId: keywordApplyState?.dryRunRequestId ?? restoredSession?.keywordDryRunRequestId ?? "", keywordRealApplyRequestId: keywordApplyState?.realApplyRequestId ?? restoredSession?.keywordRealApplyRequestId ?? "", finalPriceRequestId });
  const previousRequestId = finalPriceRequestId || keywordApplyState?.realApplyRequestId || keywordApplyState?.dryRunRequestId || priceRequestId || uploadRequestId || keywordDispatchResult?.expectedArtifactName || "-";
  const lastCheckedAt = finalPriceLastCheckedAt ?? keywordLastCheckedAt ?? priceLastCheckedAt ?? uploadLastCheckedAt;

  useEffect(() => {
    const nextSession: ProductLaunchSessionV2 = {
      rowExpression,
      startedAt: restoredSession?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uploadRequestId,
      priceRequestId,
      keywordRequestId: keywordDispatchResult?.expectedArtifactName ?? restoredSession?.keywordRequestId ?? "",
      keywordRunId: String(keywordRunsResult?.runs?.[0]?.id ?? restoredSession?.keywordRunId ?? ""),
      keywordDryRunRequestId: keywordApplyState?.dryRunRequestId ?? restoredSession?.keywordDryRunRequestId ?? "",
      keywordRealApplyRequestId: keywordApplyState?.realApplyRequestId ?? restoredSession?.keywordRealApplyRequestId ?? "",
      finalPriceRequestId,
      uploadResult: uploadActionsResult,
      priceResult: priceActionsResult,
      keywordResult: keywordRunsResult,
      finalPriceResult: finalPriceActionsResult,
      seedKeywordsBySourceRow,
      stage: derivedStage,
    };
    persistProductLaunchSession(nextSession);
  }, [derivedStage, finalPriceActionsResult, finalPriceRequestId, keywordApplyState?.dryRunRequestId, keywordApplyState?.realApplyRequestId, keywordDispatchResult?.expectedArtifactName, keywordRunsResult, priceActionsResult, priceRequestId, restoredSession, rowExpression, seedKeywordsBySourceRow, uploadActionsResult, uploadRequestId]);

  useEffect(() => {
    if (!restoredSession) return;
    const timer = window.setTimeout(() => {
      if (restoredSession.uploadRequestId && !isSuccessfulUploadResult(restoredSession.uploadResult ?? null, extractRowsWithGoodsKey(restoredSession.uploadResult ?? null).length)) {
        setUploadPolling(true);
        void pollUploadResult(true, restoredSession.uploadRequestId);
      }
      if (restoredSession.priceRequestId && !restoredSession.priceResult) {
        setPricePolling(true);
        void fetchPriceResult();
      }
      if ((restoredSession.keywordRequestId || restoredSession.keywordRunId) && !restoredSession.keywordResult) {
        setKeywordPolling(true);
        void fetchKeywordRuns();
      }
      if (restoredSession.finalPriceRequestId && !restoredSession.finalPriceResult) {
        setFinalPricePolling(true);
        void fetchFinalPriceResult();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  // run once on mount; persisted request IDs are intentionally recovered after a Vercel-style remount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetProductLaunchSession = () => {
    clearProductLaunchSession();
    setSessionRestored(false);
    setUploadRecovered(false);
    setRowExpression("");
    setLastStartedRowExpression("");
    setUploadRequestId("");
    setPriceRequestId("");
    setFinalPriceRequestId("");
    setUploadRunResult(null);
    setUploadActionsResult(null);
    setPriceRunResult(null);
    setPriceActionsResult(null);
    setKeywordDispatchResult(null);
    setKeywordRunsResult(null);
    setKeywordApplyState(null);
    setFinalPriceRunResult(null);
    setFinalPriceActionsResult(null);
  };
  useEffect(() => {
    const artifact = keywordSummary.artifact;
    const run = keywordRunsResult?.runs?.find((item) => item.artifacts?.some((candidate) => candidate.id === artifact?.id));
    const importKey = artifact && run ? `${run.id}:${artifact.name}:${artifact.id}` : "";
    if (!autopilotEnabled || !artifact || !run || !importKey) return;
    if (autoKeywordImportedArtifactRef.current === importKey) return;
    autoKeywordImportedArtifactRef.current = importKey;
    void importKeywordArtifact(run, artifact);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotEnabled, keywordRunsResult, keywordSummary.artifact]);

  const runNextSafeStep = () => {
    if (cockpit.primaryAction === "upload") void runUploadRequest();
    if (cockpit.primaryAction === "price") void runPriceModify();
    if (cockpit.primaryAction === "keyword") void dispatchKeywordEngine();
    if (cockpit.primaryAction === "review") void openInlineKeywordReview();
  };

  useEffect(() => {
    if (!autopilotEnabled) return;
    if (!isSuccessfulUploadResult(uploadActionsResult, uploadRows.length) || goodsKeys.length === 0 || !currentUploadRequestId) return;
    if (priceRunning || priceFetching || pricePolling || priceRunResult || priceActionsResult) return;
    if (autoPriceStartedForUploadRequestRef.current === currentUploadRequestId) return;
    autoPriceStartedForUploadRequestRef.current = currentUploadRequestId;
    const timer = window.setTimeout(() => {
      void runPriceModify();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autopilotEnabled, currentUploadRequestId, goodsKeys.length, priceActionsResult, priceFetching, pricePolling, priceRunResult, priceRunning, runPriceModify, uploadActionsResult, uploadRows.length]);

  useEffect(() => {
    if (!autopilotEnabled) return;
    if (!priceRequestId || !isAutopilotSafePriceResult(priceActionsResult) || goodsKeys.length === 0) return;
    if (keywordBusy || keywordPolling || keywordDispatchResult || keywordSummary.artifact) return;
    if (autoKeywordStartedForPriceRequestRef.current === priceRequestId) return;
    autoKeywordStartedForPriceRequestRef.current = priceRequestId;
    const timer = window.setTimeout(() => {
      void dispatchKeywordEngine();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autopilotEnabled, dispatchKeywordEngine, goodsKeys.length, keywordBusy, keywordDispatchResult, keywordPolling, keywordSummary.artifact, priceActionsResult, priceRequestId]);

  useEffect(() => {
    const realApplyRequestId = keywordApplyState?.realApplyRequestId ?? "";
    if (!autopilotEnabled) return;
    if (!keywordRealApplySucceeded || goodsKeys.length === 0 || !realApplyRequestId) return;
    if (finalPriceActive || finalPriceRunResult || finalPriceActionsResult) return;
    if (finalPriceStartedForRealApplyRequestRef.current === realApplyRequestId) return;
    finalPriceStartedForRealApplyRequestRef.current = realApplyRequestId;
    const timer = window.setTimeout(() => {
      void runFinalPriceModify();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autopilotEnabled, finalPriceActionsResult, finalPriceActive, finalPriceRunResult, goodsKeys.length, keywordApplyState?.realApplyRequestId, keywordRealApplySucceeded, runFinalPriceModify]);

  return (
    <div className="space-y-6">
      {sessionRestored ? <RecoveryBanner uploadRecovered={uploadRecovered || isSuccessfulUploadResult(uploadActionsResult, uploadRows.length)} /> : null}
      <ManualLaunchWizard rowExpression={rowExpression} onRowExpressionChange={setRowExpression} uploadBusy={uploadRunning || uploadFetching || uploadPolling} onUpload={runUploadRequest} uploadRows={uploadRows} sourceRowGroups={sourceRowGroups} manualTitleOverridesByGoodsKey={manualTitleOverridesByGoodsKey} manualKeywordOverridesByGoodsKey={manualKeywordOverridesByGoodsKey} onManualTitleChange={(goodsKey, value) => setManualTitleOverridesByGoodsKey((current) => ({ ...current, [goodsKey]: value }))} onManualKeywordChange={(goodsKey, value) => setManualKeywordOverridesByGoodsKey((current) => ({ ...current, [goodsKey]: value }))} onApplyStateChange={setManualApplyState} />
      {cockpit.primaryAction === "failed" ? <ErrorDrawer title="실패 원인" uploadResult={uploadActionsResult} priceResult={priceActionsResult} keywordResult={keywordRunsResult} requestId={previousRequestId} actionsUrl={keywordGithubActionsUrl ?? priceGithubActionsUrl ?? uploadGithubActionsUrl} /> : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-slate-950">고급 / 상세 결과 보기</summary>
      <LaunchCockpit steps={cockpit.steps} currentStage={derivedStage} nextAction={cockpit.nextAction} primaryAction={cockpit.primaryAction} onNext={runNextSafeStep} rowExpression={rowExpression} onRowExpressionChange={setRowExpression} uploadBusy={uploadRunning || uploadFetching || uploadPolling} priceBusy={priceRunning || priceFetching || pricePolling || finalPriceActive} keywordBusy={keywordBusy === "dispatch" || keywordBusy === "runs" || keywordPolling || isKeywordRunning(keywordRunsResult)} autoPilotEnabled={autopilotEnabled} onAutoPilotChange={setAutopilotEnabled} currentRequestId={currentRequestId} previousRequestId={previousRequestId} lastCheckedAt={lastCheckedAt} autoPollStatus={`업로드 ${uploadPollCount}회 · 가격 ${pricePollCount}회 · 키워드 ${keywordPollCount}회 · 최종가격 ${finalPricePollCount}회`} actionsUrl={keywordGithubActionsUrl ?? priceGithubActionsUrl ?? uploadGithubActionsUrl} counts={{ upload: uploadCounts, price: priceCounts, keyword: keywordSummary }} uploadProgress={{ phase: getUploadPhaseLabel(uploadActionsResult, uploadRunning, uploadFetching, uploadPolling), elapsedSeconds: uploadElapsedSeconds, pollCount: uploadPollCount, lastCheckedAt: uploadLastCheckedAt, nextCheckIn: uploadNextCheckIn, requestId: currentUploadRequestId, actionsUrl: uploadGithubActionsUrl, active: uploadRunning || uploadFetching || uploadPolling, onCheckNow: fetchUploadResult, checking: uploadFetching }} autoActualApplyEnabled={autoActualApplyEnabled} onAutoActualApplyEnabledChange={setAutoActualApplyEnabled} />
      <AILaunchAgentBoard state={cockpit} productCount={goodsKeys.length} mallCount={boardMallCount} titleTargetCount={titleTargetCount} keywordWarningCount={keywordWarningCount} issueCount={issueCount} actualApplyDone={actualApplyDone} keywordApplyState={keywordApplyState} priceIssueState={priceIssueState} manualCandidatesReady={manualCandidatesReady} onNext={keywordRealApplySucceeded && !finalPriceDone ? runFinalPriceModify : runNextSafeStep} initialPriceRequestId={priceRequestId} finalPriceRequestId={finalPriceRequestId} finalPriceActionsResult={finalPriceActionsResult} finalPriceActive={finalPriceActive} finalPriceDone={finalPriceDone} finalPriceFailed={finalPriceFailed} finalPriceTargetCount={goodsKeys.length * FULL_PRICE_POLICY_MALL_COUNT} />
      <SeedKeywordSection sourceRowGroups={sourceRowGroups} rowExpression={lastStartedRowExpression || rowExpression} seedKeywordsBySourceRow={seedKeywordsBySourceRow} onSeedKeywordChange={(sourceRowId, value) => setSeedKeywordsBySourceRow((current) => ({ ...current, [sourceRowId]: value }))} />
      <button type="button" onClick={resetProductLaunchSession} className="mb-4 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700">현재 상품출시 작업 초기화</button>
      <ManualOverrideSection goodsKeys={goodsKeys} uploadRows={uploadRows} manualTitleOverridesByGoodsKey={manualTitleOverridesByGoodsKey} manualKeywordOverridesByGoodsKey={manualKeywordOverridesByGoodsKey} onManualTitleChange={(goodsKey, value) => setManualTitleOverridesByGoodsKey((current) => ({ ...current, [goodsKey]: value }))} onManualKeywordChange={(goodsKey, value) => setManualKeywordOverridesByGoodsKey((current) => ({ ...current, [goodsKey]: value }))} />
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
        {!uploadRequestId && rowExpression ? <button type="button" onClick={recoverLatestUploadResult} disabled={uploadFetching || uploadPolling} className="ml-3 mt-5 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:bg-slate-100">최근 상품업로드 결과 복구</button> : null}
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
      {keywordRealApplySucceeded ? <PriceSection title="가격 최종 재적용" goodsKeyCount={goodsKeys.length} result={finalPriceRunResult} actionsResult={finalPriceActionsResult} requestId={finalPriceRequestId} running={finalPriceRunning} fetching={finalPriceFetching} onRun={runFinalPriceModify} onFetch={fetchFinalPriceResult} finalPass /> : null}
      {goodsKeys.length > 0 ? <KeywordPrepSection rows={uploadRows} goodsKeys={goodsKeys} seedKeyword={keywordSeed} onSeedKeywordChange={setKeywordSeed} preview={keywordPreview} dispatchResult={keywordDispatchResult} runsResult={keywordRunsResult} importMessage={keywordImportMessage} busy={keywordBusy} onPreview={previewKeywordDispatch} onDispatch={dispatchKeywordEngine} onFetchRuns={fetchKeywordRuns} onImport={importKeywordArtifact} /> : null}
      <FinalChecklist />
      </details>
    </div>
  );
}



export function hasManualCandidatesForAllSourceRows(sourceRowGroups: ReturnType<typeof buildLaunchSourceRowGroups>, manualTitleCandidatesBySourceRow: Record<string, string>, manualSearchCandidatesBySourceRow: Record<string, string>) {
  if (sourceRowGroups.length === 0) return false;
  return sourceRowGroups.every((group) => {
    const sourceRowTitle = String(manualTitleCandidatesBySourceRow[group.sourceRowId] ?? "").trim();
    const sourceRowSearch = String(manualSearchCandidatesBySourceRow[group.sourceRowId] ?? "").trim();
    if (sourceRowTitle || sourceRowSearch) return true;
    return group.goodsKeys.some((goodsKey) => String(manualTitleCandidatesBySourceRow[goodsKey] ?? "").trim() || String(manualSearchCandidatesBySourceRow[goodsKey] ?? "").trim());
  });
}



function ManualLaunchWizard({ rowExpression, onRowExpressionChange, uploadBusy, onUpload, uploadRows, sourceRowGroups, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey, onManualTitleChange, onManualKeywordChange, onApplyStateChange }: { rowExpression: string; onRowExpressionChange: (value: string) => void; uploadBusy: boolean; onUpload: () => void; uploadRows: ProductLaunchUploadRow[]; sourceRowGroups: ReturnType<typeof buildLaunchSourceRowGroups>; manualTitleOverridesByGoodsKey: Record<string, string>; manualKeywordOverridesByGoodsKey: Record<string, string>; onManualTitleChange: (goodsKey: string, value: string) => void; onManualKeywordChange: (goodsKey: string, value: string) => void; onApplyStateChange: (state: KeywordApplyState | null) => void }) {
  const [preflight, setPreflight] = useState<KeywordExecutionPreflightResult | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const previewResult = useMemo(() => buildManualKeywordPreviewResult(uploadRows, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey), [manualKeywordOverridesByGoodsKey, manualTitleOverridesByGoodsKey, uploadRows]);
  const representativeItem = previewResult.items[0];
  const ready = sourceRowGroups.length > 0 && hasManualCandidatesForAllSourceRows(sourceRowGroups, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey);
  const makePreflight = () => {
    const next = buildKeywordExecutionPreflight({ previewResult, finalConfirmationText: APPLY_CONFIRMATION_TEXT }, { allowedMallKeys: PRODUCT_GROUP_MARKET_REGISTRY.map((market) => market.mallKey), maxRows: 100, alreadyAppliedGoodsKeys: [], requireFinalConfirmation: true, confirmationText: APPLY_CONFIRMATION_TEXT });
    setPreflight(next);
    return next;
  };
  const runApply = async () => {
    if (running || !ready) return;
    setRunning(true);
    setResult(null);
    try {
      const next = makePreflight();
      if (next.summary.blockedCount > 0 || next.summary.eligibleCount === 0) throw new Error("차단 항목을 해결한 뒤 다시 실행하세요.");
      const json = buildCompactKeywordApplyExecutionPlan(next);
      const response = await fetch("/api/keyword-shopling-apply/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_plan_json: json, mode: "apply", confirmation_text: APPLY_CONFIRMATION_TEXT, max_items: 100 }) });
      const payload = await response.json();
      setResult(payload);
      onApplyStateChange({ dryRunStatus: "success", realApplyStatus: response.ok && payload.status !== "error" ? "queued" : "failed", appliedCount: 0, failedCount: 0, warningCount: 0, requestId: typeof payload.requestId === "string" ? payload.requestId : "", dryRunRequestId: "", realApplyRequestId: typeof payload.requestId === "string" ? payload.requestId : "", blankMallTitleBlockedCount: 0, lastUpdatedAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "실제 반영 실행 요청 중 오류가 발생했습니다.";
      setResult({ status: "error", message });
      onApplyStateChange({ dryRunStatus: "success", realApplyStatus: "failed", appliedCount: 0, failedCount: 1, warningCount: 0, requestId: "", dryRunRequestId: "", realApplyRequestId: "", blankMallTitleBlockedCount: 0, lastUpdatedAt: new Date().toISOString() });
    } finally {
      setRunning(false);
    }
  };
  return <section className="rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
    <p className="text-sm font-semibold text-blue-700">수동 상품 출시</p><h1 className="text-2xl font-black text-slate-950">상품 출시 플로우</h1>
    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-5"><h2 className="text-lg font-black text-slate-950">1. 행번호 입력</h2><label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행번호<input value={rowExpression} onChange={(event) => onRowExpressionChange(event.target.value)} placeholder="예: 950 또는 950-955" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><button type="button" onClick={onUpload} disabled={uploadBusy || !rowExpression.trim()} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">행번호로 상품업로드 실행</button></div>
    <div className="mt-5 rounded-2xl border border-slate-200 p-5"><h2 className="text-lg font-black text-slate-950">2. 행별 상품명/검색어 후보 입력</h2><p className="mt-2 text-sm text-slate-700">업로드 결과의 goods_key에 실제 상품명과 검색어 후보를 직접 입력합니다. 검색어는 상품별 1세트로 반영됩니다.</p><ManualOverrideSection goodsKeys={uploadRows.map((row) => row.goods_key ?? "").filter(Boolean)} uploadRows={uploadRows} manualTitleOverridesByGoodsKey={manualTitleOverridesByGoodsKey} manualKeywordOverridesByGoodsKey={manualKeywordOverridesByGoodsKey} onManualTitleChange={onManualTitleChange} onManualKeywordChange={onManualKeywordChange} /></div>
    <div className="mt-5 rounded-2xl border border-slate-200 p-5"><h2 className="text-lg font-black text-slate-950">3. 대표 미리보기 1개</h2>{representativeItem ? <dl className="mt-3 grid gap-2 text-sm"><ResultRow label="goods_key" value={representativeItem.goods_key} mono /><ResultRow label="상품그룹" value={representativeItem.product_group} /><ResultRow label="쇼핑몰" value={`${representativeItem.market_name ?? "-"} / ${representativeItem.mall_key}`} /><ResultRow label="상품명" value={representativeItem.final_title} /><ResultRow label="검색어" value={representativeItem.final_site_srch} /></dl> : <p className="mt-3 text-sm text-slate-600">행번호 업로드 결과와 후보 입력 후 대표 미리보기가 표시됩니다.</p>}<button type="button" onClick={makePreflight} disabled={!ready} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 disabled:bg-slate-100">미리보기 점검</button>{preflight ? <p className="mt-3 text-sm font-semibold text-slate-700">반영 가능 {preflight.summary.eligibleCount}개 · 차단 {preflight.summary.blockedCount}개</p> : null}</div>
    <details className="mt-5 rounded-2xl border border-slate-200 p-5"><summary className="cursor-pointer text-lg font-black text-slate-950">4. 전체 항목 펼쳐보기</summary><div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border px-3 py-2">goods_key</th><th className="border px-3 py-2">mall_key</th><th className="border px-3 py-2">상품명</th><th className="border px-3 py-2">검색어</th></tr></thead><tbody>{previewResult.items.map((item) => <tr key={`${item.goods_key}-${item.mall_key}`}><td className="border px-3 py-2 font-mono">{item.goods_key}</td><td className="border px-3 py-2 font-mono">{item.mall_key}</td><td className="border px-3 py-2">{item.final_title}</td><td className="border px-3 py-2">{item.final_site_srch}</td></tr>)}</tbody></table></div></details>
    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-black text-slate-950">5. 승인하고 실제 반영 실행</h2><p className="mt-2 text-sm text-emerald-900">확인문구는 {APPLY_CONFIRMATION_TEXT}로 고정되며 compact execution plan만 전송합니다.</p><button type="button" onClick={runApply} disabled={running || !ready} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">승인하고 샵플링 반영 실행</button>{result ? <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{JSON.stringify(result, null, 2)}</pre> : null}</div>
  </section>;
}

function buildManualKeywordPreviewResult(rows: ProductLaunchUploadRow[], titles: Record<string, string>, keywords: Record<string, string>): KeywordPayloadPreviewResult {
  const items: KeywordPayloadPreviewItem[] = rows.flatMap((row, sourceIndex) => {
    const goodsKey = String(row.goods_key ?? "").trim();
    if (!goodsKey) return [];
    const group = inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "").productGroup;
    const markets = getMarketsForProductGroup(group);
    const title = resolveManualTitleOverride(titles[goodsKey] ?? "", String(row.product_name ?? "")).trim();
    const siteSrch = normalizeManualKeywordOverride(keywords[goodsKey] ?? normalizeSeedKeywords(title));
    return markets.map((market): KeywordPayloadPreviewItem => ({ goods_key: goodsKey, mall_key: market.mallKey, source_row_index: sourceIndex, ptn_goods_cd: String(row.ptn_goods_cd ?? ""), group_suffix: market.groupSuffix, product_group: group, product_group_type: market.productGroupType, product_group_status: "registered", original_title: String(row.product_name ?? ""), recommended_title: title, edited_title: title, final_title: title, original_site_srch: "", recommended_site_srch: siteSrch, edited_site_srch: siteSrch, edited_mall_key: market.mallKey, final_site_srch: siteSrch, classification: "auto_apply_candidate", review_status: "approved", block_reason: "", warning_flags: "", payload_status: title && siteSrch ? "preview_ready" : "invalid", validation_errors: title && siteSrch ? [] : ["manual candidate required"], validation_warnings: [], preview_xml_fragment: null, preview_payload: title && siteSrch ? { goods_key: goodsKey, mall_key: market.mallKey, title, site_srch: siteSrch } : null, expansion_mode: "product_group_markets", market_name: market.marketName, account_id_label: market.accountIdLabel }));
  }).slice(0, 100);
  return { items, previewableItems: items.filter((item) => item.payload_status === "preview_ready"), excludedItems: items.filter((item) => item.payload_status !== "preview_ready"), summary: { totalReviewedRows: rows.length, approvedCount: items.length, previewReadyCount: items.filter((item) => item.payload_status === "preview_ready").length, invalidCount: items.filter((item) => item.payload_status === "invalid").length, heldCount: 0, blockedRiskCount: 0 }, previewXml: "", expansionMode: "product_group_markets", expandedItemCount: items.length, groupVariantEnabled: false, attributeModifierMode: "safe_source_only", expansionErrors: [] };
}


function RecoveryBanner({ uploadRecovered }: { uploadRecovered: boolean }) {
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900">
    <p>이전 상품출시 작업을 복구했습니다.</p>
    <p>완료된 GitHub Actions 결과를 다시 확인하는 중입니다.</p>
    {uploadRecovered ? <p className="mt-2">상품업로드 결과를 복구했습니다. 생성된 goods_key 기준으로 다음 단계를 이어갑니다.</p> : <p className="mt-2">상품업로드 결과 확인 중</p>}
  </section>;
}

function SeedKeywordSection({ sourceRowGroups, rowExpression, seedKeywordsBySourceRow, onSeedKeywordChange }: { sourceRowGroups: ReturnType<typeof buildLaunchSourceRowGroups>; rowExpression: string; seedKeywordsBySourceRow: Record<string, string>; onSeedKeywordChange: (sourceRowId: string, value: string) => void; }) {
  const hasMissingMapping = sourceRowGroups.some((group) => group.mappingMissing) && parseLaunchRowExpression(rowExpression).length > 1;
  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
    <p className="text-sm font-bold text-blue-700">행별 핵심 키워드</p>
    <h2 className="mt-1 text-xl font-black text-slate-950">행별 핵심 키워드</h2>
    <p className="mt-2 text-sm font-semibold text-slate-700">실재고 시트 행마다 좋은 키워드를 한 번만 입력하세요.<br />같은 행에서 생성된 도매/소매 상품들은 이 키워드를 함께 사용합니다.<br />AI가 이 키워드로 쇼핑몰별 상품명과 상품별 검색어를 자동 생성합니다.</p>
    <p className="mt-2 rounded-lg bg-blue-50 p-3 text-xs font-semibold text-blue-800">검색어는 상품별 1세트로 반영됩니다. 쇼핑몰별 차별화는 상품명에서 적용합니다.</p>
    {hasMissingMapping ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{MISSING_SOURCE_ROW_WARNING}</p> : null}
    {sourceRowGroups.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">상품업로드 후 실재고 행별 핵심 키워드 입력칸이 표시됩니다.</p> : <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">실재고 행</th><th className="border border-slate-200 px-3 py-2">생성 상품</th><th className="border border-slate-200 px-3 py-2">현재 상품명</th><th className="border border-slate-200 px-3 py-2">핵심 키워드 입력</th><th className="border border-slate-200 px-3 py-2">상태</th></tr></thead><tbody>{sourceRowGroups.map((group) => {
      const seedValue = seedKeywordsBySourceRow[group.sourceRowId] ?? "";
      const normalizedPreview = normalizeSeedKeywords(seedValue);
      const safeTitle = isSafeLaunchTitle(group.currentTitle) ? group.currentTitle : "키워드 엔진 대기";
      const status = group.mappingMissing ? "확인 필요" : normalizedPreview ? "준비 완료" : safeTitle !== "키워드 엔진 대기" ? "엔진 보강" : "키워드 필요";
      const productSummary = `${group.productGroups.join("·") || "상품그룹 확인 필요"} / goods_key ${group.goodsKeys.length}개`;
      return <tr key={group.sourceRowId} className="bg-white"><td className="border border-slate-200 px-3 py-2 font-mono font-bold">{group.displayLabel}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{productSummary}</td><td className="border border-slate-200 px-3 py-2">{safeTitle}</td><td className="border border-slate-200 px-3 py-2"><input value={seedValue} onChange={(event) => onSeedKeywordChange(group.sourceRowId, event.target.value)} placeholder="게임패드,컨트롤러,조이스틱,미니" className="w-80 rounded-lg border border-slate-300 px-3 py-2" />{normalizedPreview ? <p className="mt-1 text-xs font-semibold text-emerald-700">{normalizedPreview}</p> : <p className="mt-1 text-xs text-slate-500">행별 핵심 키워드를 입력하세요.</p>}</td><td className="border border-slate-200 px-3 py-2 font-bold">{status}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}

function ManualOverrideSection({ goodsKeys, uploadRows, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey, onManualTitleChange, onManualKeywordChange }: { goodsKeys: string[]; uploadRows: ProductLaunchUploadRow[]; manualTitleOverridesByGoodsKey: Record<string, string>; manualKeywordOverridesByGoodsKey: Record<string, string>; onManualTitleChange: (goodsKey: string, value: string) => void; onManualKeywordChange: (goodsKey: string, value: string) => void; }) {
  const uploadRowsByGoodsKey = new Map(uploadRows.map((row) => [(row.goods_key ?? "").trim(), row]));
  const rows = goodsKeys.length > 0 ? goodsKeys : uploadRows.map((row) => (row.goods_key ?? "").trim()).filter(Boolean);
  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
    <p className="text-sm font-bold text-blue-700">상품별 수동 보정</p>
    <h2 className="mt-1 text-xl font-black text-slate-950">상품별 수동 보정</h2>
    <p className="mt-2 text-sm font-semibold text-slate-700">상품명을 직접 입력하면 이 값이 1순위로 반영됩니다.<br />비워두면 키워드 엔진이 만든 상품명을 사용합니다.</p>
    {rows.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">상품업로드 후 goods_key별 수동 상품명/검색어 입력칸이 표시됩니다.</p> : <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left text-slate-700"><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">상품그룹</th><th className="border border-slate-200 px-3 py-2">현재 엔진 추천 상품명</th><th className="border border-slate-200 px-3 py-2">수동 상품명 입력</th><th className="border border-slate-200 px-3 py-2">수동 검색어 입력</th><th className="border border-slate-200 px-3 py-2">상태</th></tr></thead><tbody>{rows.map((goodsKey) => {
      const uploadRow = uploadRowsByGoodsKey.get(goodsKey);
      const productGroup = inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").productGroup;
      const engineTitle = [uploadRow?.final_title, uploadRow?.registered_title, uploadRow?.upload_title, uploadRow?.product_name, uploadRow?.title, uploadRow?.productTitle].find((value) => String(value ?? "").trim()) ?? "키워드 엔진 대기";
      const manualTitle = manualTitleOverridesByGoodsKey[goodsKey] ?? "";
      const manualKeyword = manualKeywordOverridesByGoodsKey[goodsKey] ?? "";
      const status = resolveManualTitleOverride(manualTitle, goodsKey) ? "수동" : String(engineTitle).trim() && engineTitle !== "키워드 엔진 대기" ? "엔진" : "보강 필요";
      return <tr key={goodsKey} className="bg-white"><td className="border border-slate-200 px-3 py-2 font-mono">{goodsKey}</td><td className="border border-slate-200 px-3 py-2 font-semibold">{productGroup}</td><td className="border border-slate-200 px-3 py-2">{engineTitle}</td><td className="border border-slate-200 px-3 py-2"><input value={manualTitle} onChange={(event) => onManualTitleChange(goodsKey, event.target.value)} placeholder="수동 상품명" className="w-64 rounded-lg border border-slate-300 px-3 py-2" /></td><td className="border border-slate-200 px-3 py-2"><input value={manualKeyword} onChange={(event) => onManualKeywordChange(goodsKey, normalizeManualKeywordOverride(event.target.value) || event.target.value)} placeholder="게임패드,컨트롤러" className="w-64 rounded-lg border border-slate-300 px-3 py-2" /></td><td className="border border-slate-200 px-3 py-2 font-bold">{status}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-950">{value}</p></div>;
}

function AILaunchAgentBoard({ state, productCount, mallCount, titleTargetCount, keywordWarningCount, issueCount, actualApplyDone, keywordApplyState, priceIssueState, manualCandidatesReady, onNext, initialPriceRequestId, finalPriceRequestId, finalPriceActionsResult, finalPriceActive, finalPriceDone, finalPriceFailed, finalPriceTargetCount }: { state: ReturnType<typeof buildCockpit>; productCount: number; mallCount: number; titleTargetCount: number; keywordWarningCount: number; issueCount: number; actualApplyDone: boolean; keywordApplyState: KeywordApplyState | null; priceIssueState: PriceIssueState; manualCandidatesReady: boolean; onNext: () => void; initialPriceRequestId: string; finalPriceRequestId: string; finalPriceActionsResult: PriceActionsResult | null; finalPriceActive: boolean; finalPriceDone: boolean; finalPriceFailed: boolean; finalPriceTargetCount: number }) {
  const hasCriticalPriceIssue = priceIssueState.kind === "critical";
  const realApplyStatus = keywordApplyState?.realApplyStatus ?? "idle";
  const realApplyRunning = realApplyStatus === "queued" || realApplyStatus === "running" || realApplyStatus === "waiting_artifact";
  const realApplyLabel = getKeywordApplyPhaseLabelForBoard(keywordApplyState);
  const keywordRealApplySucceeded = isKeywordRealApplySuccess(keywordApplyState);
  const finalPriceStatus = finalPriceActive ? "가격 최종 재적용 중" : finalPriceDone ? "success" : finalPriceFailed ? "failed" : "waiting";
  const boardButtonLabel = finalPriceActive ? "가격 최종 재적용 확인 중" : keywordRealApplySucceeded && !finalPriceDone ? "가격 최종 재적용 확인 중" : actualApplyDone ? "출시 결과 확인" : realApplyRunning ? "검토 결과 새로고침" : realApplyStatus === "failed" || realApplyStatus === "blocked" ? "문제 확인" : state.primaryAction === "upload" ? "상품출시 시작" : keywordApplyState?.dryRunStatus === "success" ? "승인하고 샵플링 반영 실행" : "키워드 입력 후 AI 검토 생성";
  const dryRunComplete = keywordApplyState?.dryRunStatus === "success";
  const blockedByApply = realApplyStatus === "blocked" || (keywordApplyState?.blankMallTitleBlockedCount ?? 0) > 0;
  const uploadAndPriceComplete = state.steps[0]?.state === "success" && state.steps[1]?.state === "success";
  const finalVerdict = blockedByApply ? "출시 보류 - 차단 항목 있음" : realApplyRunning ? "샵플링 실제 반영 중" : finalPriceActive ? "가격 최종 재적용 중" : finalPriceFailed ? "출시 보류 - 가격 최종 재적용 실패" : keywordRealApplySucceeded && !finalPriceDone ? "가격 최종 재적용 중" : actualApplyDone ? "출시 완료" : dryRunComplete ? "출시 보류 - 승인 대기" : uploadAndPriceComplete && !manualCandidatesReady ? "후보 입력 대기" : uploadAndPriceComplete ? "키워드 검토 준비 중" : hasCriticalPriceIssue ? "출시 보류 - 가격 확인 필요" : state.primaryAction === "wait" ? "진행 중" : "검토 준비";
  const status: string = finalVerdict;
  const progress = actualApplyDone ? 100 : Math.round((state.steps.filter((step) => step.state === "success").length / Math.max(state.steps.length, 1)) * 100);
  const stages = ["상품업로드", "가격 1차 적용", "검토 준비", "상품명/키워드 실제 반영", "가격 최종 재적용", "출시 완료"];
  return <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
    <p className="text-sm font-black text-emerald-700">AI 상품출시 에이전트</p>
    <h1 className="mt-1 text-2xl font-black text-slate-950">{actualApplyDone && !hasCriticalPriceIssue ? "출시 완료" : finalVerdict}</h1>
    {actualApplyDone ? <p className="mt-2 text-sm font-bold text-emerald-900">샵플링 상품명/검색어 반영까지 완료되었습니다.</p> : null}
    {hasCriticalPriceIssue ? <p className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-800">가격 확인 필요<br />쇼핑몰별 판매가 0원 항목이 남아 있습니다.</p> : null}
    {priceIssueState.kind === "unsupported" ? <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">가격 화면 검증 필요<br />가격 API는 실행됐지만 샵플링 화면 기준 0원 여부를 확인하지 못했습니다. 상품명 API 반영은 실행됐지만 샵플링 화면 확인이 필요합니다.</p> : null}
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <SummaryCard label="현재 상태" value={status} />
      <SummaryCard label="다음 작업" value={state.nextAction} />
      <SummaryCard label="진행률" value={`${progress}%`} />
    </div>
    <div className="mt-4 flex flex-wrap gap-2">{stages.map((stage) => <span key={stage} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">{stage}</span>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-5">
      <SummaryCard label="상품 수" value={productCount} />
      <SummaryCard label="가격설정 대상 쇼핑몰 수" value={mallCount} />
      <SummaryCard label="상품명 반영 대상 수" value={titleTargetCount} />
      <SummaryCard label="검색어 경고 수" value={keywordWarningCount} />
      <SummaryCard label="문제 수" value={issueCount} />
      <SummaryCard label="실제 반영 상태" value={realApplyLabel} />
      <SummaryCard label="최종 가격 상태" value={finalPriceStatus} />
      <SummaryCard label="최종 가격 대상 수" value={finalPriceTargetCount} />
    </div>
    {status === "상품명 일부 누락" ? <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">상품명 일부 누락</p> : null}
    {!actualApplyDone && keywordApplyState?.dryRunStatus === "success" ? <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">키워드 dry_run은 완료됐지만 실제 샵플링 반영은 아직 실행되지 않았습니다.</p> : null}
    <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-900">상품명/키워드 반영 후 가격을 마지막으로 한 번 더 적용합니다.<br />상품명 반영 과정에서 일부 쇼핑몰 가격이 0원으로 돌아가는 것을 방지하기 위한 최종 보정 단계입니다.</div>
    <details className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800"><summary className="cursor-pointer">고급 / 상세 결과 보기</summary><p className="mt-3">1차 가격 request id: <span className="font-mono">{initialPriceRequestId || "-"}</span></p><p>실제 반영 request id: <span className="font-mono">{keywordApplyState?.realApplyRequestId || "-"}</span></p><p>최종 가격 request id: <span className="font-mono">{finalPriceRequestId || finalPriceActionsResult?.requestId || "-"}</span></p><p>final price status: {finalPriceStatus}</p><p>final price target count: {finalPriceTargetCount}</p><p>dry_run request id: <span className="font-mono">{keywordApplyState?.dryRunRequestId || "-"}</span></p><p>real apply request id: <span className="font-mono">{keywordApplyState?.realApplyRequestId || "-"}</span></p><p>real apply status: {realApplyLabel}</p><p>applied count: {keywordApplyState?.appliedCount ?? 0}</p><p>failed count: {keywordApplyState?.failedCount ?? 0}</p><p>blocked blank title count: {keywordApplyState?.blankMallTitleBlockedCount ?? 0}</p></details>
    {keywordApplyState ? <div className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800"><p>상품명 반영 {keywordApplyState.failedCount === 0 ? "성공" : "실패"}</p><p>검색어 반영 {keywordApplyState.failedCount === 0 ? "성공" : "실패"}</p><p>가격 최종 재적용 {finalPriceDone ? "성공" : finalPriceFailed ? "실패" : "대기"}</p></div> : null}
    {actualApplyDone ? <div className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800"><p>반영 상품 수: {titleTargetCount}</p><p>반영 쇼핑몰 수: {mallCount}</p><p>가격 상태: {priceIssueState.label}</p><p>검색어 경고 수: {keywordWarningCount}</p><p>다음 수동 작업: 샵플링에서 마켓전송 전 최종 확인</p></div> : null}
    <button type="button" onClick={onNext} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">{boardButtonLabel}</button>
  </section>;
}

function isKeywordRealApplySuccess(state: KeywordApplyState | null) {
  const status = String(state?.realApplyStatus ?? "");
  return (status === "success" || status === "success_with_verification_warning") && (state?.appliedCount ?? 0) > 0 && (state?.failedCount ?? 0) === 0 && (state?.blankMallTitleBlockedCount ?? 0) === 0;
}

function getKeywordApplyPhaseLabelForBoard(state: KeywordApplyState | null) {
  if (!state || state.dryRunStatus === "idle") return "키워드 dry_run 대기";
  if (String(state.realApplyStatus) === "success" || String(state.realApplyStatus) === "success_with_verification_warning") return "실제 샵플링 반영 완료";
  if (state.realApplyStatus === "failed") return "실제 샵플링 반영 실패";
  if (state.realApplyStatus === "blocked") return "실제 샵플링 반영 차단됨";
  if (state.realApplyStatus === "queued" || state.realApplyStatus === "running" || state.realApplyStatus === "waiting_artifact") return "실제 샵플링 반영 실행 중";
  if (state.dryRunStatus === "success") return "실제 샵플링 반영 대기";
  return "키워드 dry_run 대기";
}

type StepState = "waiting" | "running" | "checking" | "success" | "failed" | "action";
type CockpitStep = { name: string; state: StepState; action: string; message: string; count?: string };

function LaunchCockpit({ steps, currentStage, nextAction, primaryAction, onNext, rowExpression, onRowExpressionChange, uploadBusy, priceBusy, keywordBusy, autoPilotEnabled, onAutoPilotChange, autoActualApplyEnabled, onAutoActualApplyEnabledChange, currentRequestId, previousRequestId, lastCheckedAt, autoPollStatus, actionsUrl, counts, uploadProgress }: { steps: CockpitStep[]; currentStage: string; nextAction: string; primaryAction: string; onNext: () => void; rowExpression: string; onRowExpressionChange: (value: string) => void; uploadBusy: boolean; priceBusy: boolean; keywordBusy: boolean; autoPilotEnabled: boolean; onAutoPilotChange: (value: boolean) => void; autoActualApplyEnabled: boolean; onAutoActualApplyEnabledChange: (value: boolean) => void; currentRequestId: string; previousRequestId: string; lastCheckedAt: Date | null; autoPollStatus: string; actionsUrl?: string; counts: { upload: Record<string, number>; price: Record<string, number>; keyword: { targetCount: number; artifactState: string; reviewPendingCount: number; failureReason: string; artifact?: KeywordArtifact } }; uploadProgress: { active: boolean; phase: string; elapsedSeconds: number; pollCount: number; lastCheckedAt: Date | null; nextCheckIn: number; requestId: string; actionsUrl?: string; onCheckNow: () => void; checking: boolean } }) {
  const rowIsValid = rowExpression.trim().length > 0;
  const primaryLabel = getPrimaryActionLabel(primaryAction, uploadBusy, priceBusy, keywordBusy, currentStage);
  const disabled = primaryAction === "upload" ? !rowIsValid || uploadBusy : primaryAction === "wait" || primaryAction === "failed" || priceBusy || keywordBusy;
  const handleAutoActualApplyChange = (checked: boolean) => {
    if (!checked) {
      onAutoActualApplyEnabledChange(false);
      return;
    }
    const confirmed = window.confirm("실제 샵플링 상품명/검색어 반영까지 자동 실행합니다. 계속하시겠습니까?");
    onAutoActualApplyEnabledChange(confirmed);
  };
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">운영 집중 모드</p><h1 className="text-2xl font-black text-slate-950">상품 출시 플로우</h1><p className="mt-1 text-sm text-slate-600">행 번호를 입력하면 상품업로드부터 순서대로 진행합니다.</p></div></div>
    {primaryAction === "upload" ? <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5"><h2 className="text-lg font-black text-slate-950">먼저 실재고 시트 행 번호를 입력하세요</h2><label className="mt-4 block text-sm font-semibold text-slate-800">실재고 시트 행 번호<input value={rowExpression} onChange={(event) => onRowExpressionChange(event.target.value)} placeholder="예: 950 또는 950-955" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><p className="mt-2 text-sm text-slate-700">상품을 업로드할 실재고 시트의 행 번호입니다. 처음에는 행 번호만 입력하면 됩니다.</p>{!rowIsValid ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-blue-800">행 번호를 입력하면 상품업로드를 시작할 수 있습니다.</p> : null}<button type="button" onClick={onNext} disabled={disabled} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300">{rowIsValid ? primaryLabel : "행 번호 입력 후 시작"}</button></div> : <div className="mt-5"><button type="button" onClick={onNext} disabled={disabled} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300">{primaryLabel}</button></div>}

    {uploadProgress.active ? <div className="mt-5 rounded-2xl border border-blue-300 bg-blue-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-lg font-black text-blue-950"><span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-800" />상품업로드 진행 중<span className="inline-flex gap-1"><span className="animate-pulse">.</span><span className="animate-pulse delay-150">.</span><span className="animate-pulse delay-300">.</span></span></p>
          <p className="mt-2 text-sm font-semibold text-blue-900">GitHub Actions에서 상품업로드가 실행 중입니다. 완료되면 자동으로 결과를 확인합니다.</p>
        </div>
        <GithubActionsShortcutButton href={uploadProgress.actionsUrl} />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-blue-950 md:grid-cols-2 lg:grid-cols-4">
        <ResultRow label="현재 phase" value={uploadProgress.phase} />
        <ResultRow label="경과 시간" value={formatElapsed(uploadProgress.elapsedSeconds)} />
        <ResultRow label="자동 확인" value={`업로드 ${uploadProgress.pollCount}회`} />
        <ResultRow label="마지막 확인" value={uploadProgress.lastCheckedAt ? uploadProgress.lastCheckedAt.toLocaleTimeString("ko-KR") : "-"} />
        <ResultRow label="다음 확인" value={uploadProgress.nextCheckIn > 0 ? `${uploadProgress.nextCheckIn}초 후` : "곧 확인"} />
        <ResultRow label="현재 요청 ID" value={uploadProgress.requestId || "아직 없음"} mono />
      </div>
      <button type="button" onClick={uploadProgress.onCheckNow} disabled={uploadProgress.checking} className="mt-4 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 disabled:bg-slate-100">지금 다시 확인</button>
    </div> : null}
    <details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">선택 옵션 열기</summary><label className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={autoPilotEnabled} onChange={(event) => onAutoPilotChange(event.target.checked)} className="mt-1 size-4" />자동 진행 모드</label><p className="mt-2 text-xs text-slate-600">자동 진행 모드가 켜져 있습니다. 상품업로드 성공 후 가격설정과 키워드 dry_run까지 자동으로 이어집니다.</p><p className="mt-1 text-xs text-slate-600">실제 상품명/검색어 반영은 검토 화면에서 별도 승인해야 합니다.</p><label className="mt-3 flex items-start gap-2 text-sm font-semibold text-red-900"><input type="checkbox" checked={autoActualApplyEnabled} onChange={(event) => handleAutoActualApplyChange(event.target.checked)} className="mt-1 size-4" />실제 반영까지 자동 실행</label><p className="mt-2 text-xs text-red-800">켜면 상품업로드, 가격설정, 키워드 dry_run, 상품명 준비, 실제 샵플링 반영까지 자동으로 진행합니다.</p><p className="mt-1 text-xs text-red-700">실제 반영은 되돌리기 어려우므로 처음 켤 때 한 번 확인합니다.</p>{!currentRequestId && actionsUrl ? <div className="mt-3"><GithubActionsShortcutButton href={actionsUrl} /></div> : null}</details>
    <div className="mt-5 grid gap-3 lg:grid-cols-5">{steps.map((step, index) => <article key={step.name} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{index + 1}. {step.name}</h3><StateBadge state={step.state} /></div><p className="mt-3 text-sm font-semibold text-slate-800">{step.action}</p><p className="mt-1 text-xs text-slate-600">{step.message}</p>{primaryAction === "review" && index === 3 ? <button type="button" onClick={onNext} className="mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">키워드 검토 시작</button> : null}{step.count ? <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs font-semibold text-slate-700">{step.count}</p> : null}</article>)}</div>
    <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm md:grid-cols-2 lg:grid-cols-3"><ResultRow label="현재 단계" value={currentStage} /><ResultRow label="지금 할 일" value={nextAction} /><ResultRow label="현재 입력 행" value={rowExpression || "아직 없음"} /><ResultRow label="현재 요청 ID" value={currentRequestId || "아직 없음"} mono /><ResultRow label="마지막 확인 시각" value={lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"} /><ResultRow label="자동 확인" value={autoPollStatus} />{currentRequestId && actionsUrl ? <div><GithubActionsShortcutButton href={actionsUrl} /></div> : null}</div>
    <details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">이전 실행 기록 보기</summary><ResultRow label="이전 요청 ID" value={previousRequestId} mono /></details>
    <div className="mt-4 grid gap-2 text-xs text-slate-700 md:grid-cols-3"><p>업로드: 대상 행 {counts.upload.targetRows} · 생성 goods_key 수 {counts.upload.goodsKeyCount} · 실패 행 수 {counts.upload.failedRows} · 중복 자사상품코드 수 {counts.upload.duplicateRows}</p><p>가격: 대상 goods_key 수 {counts.price.targetGoodsKeys} · 성공 수 {counts.price.okCount} · 실패 수 {counts.price.failCount}</p><p>키워드: 대상 goods_key 수 {counts.keyword.targetCount} · artifact 상태 {counts.keyword.artifactState} · 검토 대기 수 {counts.keyword.reviewPendingCount} · 실패 원인 {counts.keyword.failureReason}</p></div>
  </section>;
}
function getPrimaryActionLabel(primaryAction: string, uploadBusy: boolean, priceBusy: boolean, keywordBusy: boolean, currentStage: string) {
  if (uploadBusy || priceBusy || keywordBusy) return "준비 중입니다...";
  if (primaryAction === "upload") return "상품출시 준비 시작";
  if (primaryAction === "price") return "가격설정 시작";
  if (primaryAction === "keyword") return "키워드 dry_run 시작";
  if (primaryAction === "review") return "AI가 상품명 반영 준비";
  if (primaryAction === "failed") return "실패 원인 보기";
  if (currentStage === "가격설정") return "가격설정 결과 확인 중...";
  if (currentStage === "키워드 결과 검토") return "AI가 상품명 반영 준비";
  if (currentStage === "키워드/상품명 준비") return "키워드 결과 확인 중...";
  return "상품업로드 결과 확인 중...";
}
function StateBadge({ state }: { state: StepState }) { const map = { waiting: ["대기", "bg-slate-100 text-slate-700"], running: ["실행 중", "bg-blue-100 text-blue-800"], checking: ["결과 확인 중", "bg-blue-100 text-blue-800"], success: ["성공", "bg-emerald-100 text-emerald-800"], failed: ["실패", "bg-red-100 text-red-800"], action: ["확인 필요", "bg-amber-100 text-amber-900"] } as const; const [label, cls] = map[state]; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${cls}`}>{state === "running" || state === "checking" ? <span className="size-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" /> : null}{label}</span>; }
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

function getUploadPhaseLabel(result: UploadActionsResult | null, running: boolean, fetching: boolean, polling: boolean) {
  if (running || result?.phase === "request_sent") return "요청 전송";
  if (result?.phase === "queued" || result?.phase === "running" || result?.runStatus === "queued" || result?.runStatus === "in_progress") return "GitHub Actions 실행 중";
  if (result?.phase === "waiting_artifact" || result?.phase === "completed_no_artifact" || polling) return "결과 파일 확인 중";
  if (fetching || result?.status === "success") return "OPS Center 결과 반영 중";
  return "요청 전송";
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

function PriceSection({ title = "Step 2. 가격설정", goodsKeyCount, result, actionsResult, requestId, running, fetching, onRun, onFetch, finalPass = false }: { title?: string; goodsKeyCount: number; result: RunResult | null; actionsResult: PriceActionsResult | null; requestId: string; running: boolean; fetching: boolean; onRun: () => void; onFetch: () => void; finalPass?: boolean }) {
  const summary = actionsResult?.summary;
  const errors = Array.isArray(summary?.errors) ? summary.errors : [];
  const notApplied = Number(summary?.not_applied_count ?? 0);
  const blankRisk = Number(summary?.blank_risk_count ?? 0);
  const failed = Number(summary?.failed_count ?? summary?.fail_count ?? 0);
  const affectedMalls = Array.isArray(summary?.affected_malls) ? summary.affected_malls.join(", ") : [...new Set(errors.map((error) => error.mall).filter(Boolean))].join(", ");
  const hasCoverageRisk = notApplied > 0 || blankRisk > 0 || failed > 0;
  const expectedUpdateCount = goodsKeyCount * FULL_PRICE_POLICY_MALL_COUNT;
  const confirmedAll = actionsResult && !hasCoverageRisk && Number(summary?.estimated_mall_update_count ?? 0) >= expectedUpdateCount;
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">{title}</h2>{finalPass ? <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-900">상품명/키워드 반영 후 가격을 마지막으로 한 번 더 적용합니다.<br />상품명 반영 과정에서 일부 쇼핑몰 가격이 0원으로 돌아가는 것을 방지하기 위한 최종 보정 단계입니다.</p> : null}<p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeyCount}</strong></p><p className="mt-1 text-sm font-bold text-slate-800">가격 정책: 전체 쇼핑몰 가격 일괄 적용</p><p className="mt-1 text-sm text-slate-700">상품명/검색어는 상품그룹별로 다르게 반영하고, 가격은 모든 쇼핑몰에 동일 정책으로 채웁니다.</p><p className="mt-1 text-sm text-slate-700">예상 쇼핑몰 가격설정 대상 수: <strong>{expectedUpdateCount}</strong></p><p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600">가격설정 대상 쇼핑몰 수 = goods_key 수 × {FULL_PRICE_POLICY_MALL_COUNT}</p><button type="button" onClick={onRun} disabled={running} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{running ? "실행 요청 중..." : finalPass ? "가격 최종 재적용 실행" : "가격설정 실행"}</button><button type="button" onClick={onFetch} disabled={fetching} className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{fetching ? "가져오는 중..." : finalPass ? "가격 최종 재적용 결과 가져오기" : "가격설정 결과 가져오기"}</button><StatusBlock result={result} requestId={requestId} />{hasCoverageRisk ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950"><h3 className="font-black">가격이 비어 있을 수 있는 쇼핑몰이 있습니다.</h3><p className="mt-2">영향 쇼핑몰: {affectedMalls || "확인 필요"}</p><p>영향 goods_key 수: {String(summary?.goods_key_count ?? goodsKeyCount)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onRun} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">가격설정 재실행</button><GithubActionsShortcutButton href={actionsResult?.runUrl} /><button type="button" className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-800">상세 결과 보기</button></div></div> : confirmedAll ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-800">모든 필수 쇼핑몰 가격 반영을 확인했습니다.</p> : null}{actionsResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="status" value={String(summary?.status ?? actionsResult.status ?? "-")} /><ResultRow label="exit_code" value={String(summary?.exit_code ?? "-")} /><ResultRow label="goods_key_count" value={String(summary?.goods_key_count ?? "-")} /><ResultRow label="estimated_mall_update_count" value={String(summary?.estimated_mall_update_count ?? "-")} /><ResultRow label="policy_override_count" value={String(summary?.policy_override_count ?? 0)} /><ResultRow label="성공 수" value={String(summary?.ok_count ?? "-")} /><ResultRow label="실패 수" value={String(summary?.fail_count ?? "-")} /></dl> : null}<ErrorsTable errors={errors} /></section>;
}


function KeywordPrepSection({ rows, goodsKeys, seedKeyword, onSeedKeywordChange, preview, dispatchResult, runsResult, importMessage, busy, onPreview, onDispatch, onFetchRuns, onImport }: { rows: ProductLaunchUploadRow[]; goodsKeys: string[]; seedKeyword: string; onSeedKeywordChange: (value: string) => void; preview: unknown; dispatchResult: KeywordDispatchResult | null; runsResult: KeywordRunsResult | null; importMessage: string; busy: string; onPreview: () => void; onDispatch: () => void; onFetchRuns: () => void; onImport: (run: KeywordRun, artifact: KeywordArtifact) => void }) {
  const latestRunWithArtifact = runsResult?.runs?.find((run) => run.artifacts?.some((artifact) => artifact.expected && !artifact.expired));
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-950">Step 3. 상품명/키워드 실행 및 검토</h2><p className="mt-3 text-sm text-slate-700">현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용하는 기준으로 준비합니다.</p><p className="mt-1 text-sm text-slate-700">키워드 엔진은 dry_run으로만 실행되며, 결과는 키워드 결과 검토 화면에서 사람이 확인합니다.</p><p className="mt-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">키워드/상품명 결과는 샵플링에 자동 반영되지 않습니다. 검토 화면에서 확인 후 별도 승인해야 합니다.</p><p className="mt-3 text-sm text-slate-700">대상 goods_key 수: <strong>{goodsKeys.length}</strong></p><p className="mt-1 break-all font-mono text-xs text-slate-700">goods_key CSV preview: {goodsKeys.join(",")}</p><label className="mt-4 block text-sm font-semibold text-slate-800">시드 키워드<input value={seedKeyword} onChange={(event) => onSeedKeywordChange(event.target.value)} placeholder="예: 욕실 수납, 주방 정리, 차량용 수납" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><p className="mt-1 text-xs text-slate-600">비워두면 goods_key 기준으로 키워드 엔진이 자동 진행합니다.</p><UploadRowsTable rows={rows} /><div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={onPreview} disabled={!!busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 입력값 확인</button><button type="button" onClick={onDispatch} disabled={!!busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">키워드 엔진 실행</button><button type="button" onClick={onFetchRuns} disabled={!!busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100">키워드 실행 결과 확인</button></div>{preview ? <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">상세 실행 정보 열기</summary><pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{JSON.stringify(preview, null, 2)}</pre></details> : null}{dispatchResult ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="repo" value={dispatchResult.repo ?? "-"} /><ResultRow label="workflowFile" value={dispatchResult.workflowFile ?? "-"} /><ResultRow label="actionsUrl" value={dispatchResult.actionsUrl ?? "-"} /><ResultRow label="expectedArtifactName" value={dispatchResult.expectedArtifactName ?? "-"} /><ResultRow label="message" value="키워드 엔진 실행을 요청했습니다. 몇 초 뒤 실행 결과 확인을 눌러주세요." /></dl> : null}{runsResult?.message ? <p className="mt-3 text-sm text-slate-600">{runsResult.message}</p> : null}{latestRunWithArtifact ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">가져올 결과물이 있는 최신 실행을 우선 표시합니다.</p> : null}<details className="mt-4"><summary className="cursor-pointer text-sm font-bold text-slate-700">이전 실행 기록 보기</summary><div className="mt-4 space-y-3">{runsResult?.runs?.map((run) => { const expectedArtifact = run.artifacts?.find((artifact) => artifact.expected); return <article key={run.id} className="rounded-lg border border-slate-200 p-4 text-sm"><div className="flex flex-wrap gap-3"><span>run id: <strong>{run.id}</strong></span><span>status: {run.status ?? "-"}</span><span>conclusion: {run.conclusion ?? "-"}</span><span>createdAt: {run.createdAt ?? "-"}</span>{run.htmlUrl ? <Link href={run.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">GitHub Actions 바로가기</Link> : null}</div><p className={expectedArtifact ? "mt-2 font-semibold text-emerald-700" : "mt-2 text-slate-600"}>{expectedArtifact ? `expected artifact exists: ${expectedArtifact.name}` : "expected artifact exists: no"}</p>{expectedArtifact ? <button type="button" onClick={() => onImport(run, expectedArtifact)} disabled={!!busy || expectedArtifact.expired} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">결과 가져오기 및 검토 시작</button> : null}</article>; })}</div></details>{importMessage ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{importMessage}</p> : null}{importMessage ? <Link href="/keyword-review-queue?from=product-launch-flow" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">개별 키워드 검토 화면에서 열기</Link> : null}</section>;
}

function FinalChecklist() { const items = ["상품업로드 결과 확인", "goods_key 6개 확인", "ptn_goods_cd suffix 기반 상품그룹 인식 확인", "가격설정 완료 확인", "상품명/키워드 단계는 MVP 기준 동일 적용 예정", "샵플링 마켓전송은 수동으로 진행"]; return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><h2 className="text-lg font-bold text-amber-950">최종 체크리스트</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{items.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold text-red-700">마켓전송은 현재 OPS Center에서 자동 실행하지 않습니다. 샵플링 관리자에서 최종 확인 후 직접 전송하세요.</p></section>; }
function ErrorsTable({ errors }: { errors: ProductLaunchPriceError[] }) { return <div className="mt-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-3 py-2">idx</th><th className="border border-slate-200 px-3 py-2">mall</th><th className="border border-slate-200 px-3 py-2">goods_key</th><th className="border border-slate-200 px-3 py-2">code</th><th className="border border-slate-200 px-3 py-2">msg</th></tr></thead><tbody>{errors.length > 0 ? errors.map((error, index) => <tr key={`${error.goods_key}-${index}`}><td className="border border-slate-200 px-3 py-2">{error.idx ?? index + 1}</td><td className="border border-slate-200 px-3 py-2">{error.mall ?? "-"}</td><td className="border border-slate-200 px-3 py-2 font-mono">{error.goods_key ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.code ?? "-"}</td><td className="border border-slate-200 px-3 py-2">{error.msg ?? "-"}</td></tr>) : <tr><td className="border border-slate-200 px-3 py-2 text-slate-500" colSpan={5}>실패 항목이 없습니다.</td></tr>}</tbody></table></div>; }
function StatusBlock({ result, requestId }: { result: RunResult | null; requestId: string }) { return result ? <dl className="mt-4 grid gap-3 text-sm"><ResultRow label="실행 상태" value={result.status === "queued" ? "GitHub Actions 실행 요청됨" : result.status ?? "-"} /><ResultRow label="요청 추적 ID" value={result.requestId ?? requestId ?? "-"} mono />{result.commandPreview ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">상세 실행 정보 열기</summary><ResultRow label="commandPreview" value={result.commandPreview} mono /></details> : null}{result.githubActionsUrl ? <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">githubActionsUrl</dt><dd><a href={result.githubActionsUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-blue-700 underline">{result.githubActionsUrl}</a></dd></div> : null}{result.message ? <ResultRow label="message" value={result.message} /> : null}</dl> : null; }
function ResultRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) { return <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]"><dt className="font-semibold text-slate-700">{label}</dt><dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value}</dd></div>; }
function getStoredValue(key: string) { if (typeof window === "undefined") return ""; return window.localStorage.getItem(key) ?? ""; }
function persistValue(key: string, value: string) { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
function currentManualOverrideStorageScope(rowExpression: string, launchRequestId: string) { return (launchRequestId || rowExpression || "draft").replace(/[^a-zA-Z0-9_.-]+/g, "_"); }
function readStoredRecord(key: string): Record<string, string> { if (typeof window === "undefined") return {}; try { const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}"); return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {}; } catch { return {}; } }
function persistRecord(key: string, value: Record<string, string>) { if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value)); }
function readProductLaunchSession(): ProductLaunchSessionV2 | null { if (typeof window === "undefined") return null; try { const parsed = JSON.parse(window.localStorage.getItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY) ?? "null"); return parsed && typeof parsed === "object" ? parsed as ProductLaunchSessionV2 : null; } catch { return null; } }
function persistProductLaunchSession(session: ProductLaunchSessionV2) { if (typeof window !== "undefined") window.localStorage.setItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY, JSON.stringify(session)); }
function clearProductLaunchSession() { if (typeof window === "undefined") return; [PRODUCT_LAUNCH_SESSION_STORAGE_KEY, UPLOAD_REQUEST_ID_STORAGE_KEY, PRICE_REQUEST_ID_STORAGE_KEY, LAST_ROW_EXPRESSION_STORAGE_KEY, KEYWORD_SEED_STORAGE_KEY].forEach((key) => window.localStorage.removeItem(key)); }
function deriveLaunchStage({ uploadActionsResult, uploadRowsCount, priceActionsResult, keywordRunsResult, keywordApplyState, finalPriceActionsResult, manualCandidatesReady }: { uploadActionsResult: UploadActionsResult | null; uploadRowsCount: number; priceActionsResult: PriceActionsResult | null; keywordRunsResult: KeywordRunsResult | null; keywordApplyState: KeywordApplyState | null; finalPriceActionsResult: PriceActionsResult | null; manualCandidatesReady?: boolean }) {
  if (!isSuccessfulUploadResult(uploadActionsResult, uploadRowsCount)) return "상품업로드";
  if (!isSuccessfulPriceResult(priceActionsResult)) return "가격설정";
  if (!isFinalKeywordRuns(keywordRunsResult) && keywordApplyState?.dryRunStatus !== "success") return manualCandidatesReady === false ? "후보 입력 대기" : "키워드 dry_run";
  if (keywordApplyState?.dryRunStatus === "success" && !isKeywordRealApplySuccess(keywordApplyState)) return "실제 반영 대기";
  if (isKeywordRealApplySuccess(keywordApplyState) && !isSuccessfulPriceResult(finalPriceActionsResult)) return "가격 최종 재적용";
  return "출시 완료";
}
function getRequestIdForStage(stage: string, ids: { uploadRequestId: string; priceRequestId: string; keywordRequestId: string; keywordDryRunRequestId: string; keywordRealApplyRequestId: string; finalPriceRequestId: string }) {
  if (stage === "상품업로드") return ids.uploadRequestId;
  if (stage === "가격설정") return ids.priceRequestId;
  if (stage === "키워드 dry_run") return ids.keywordDryRunRequestId || ids.keywordRequestId;
  if (stage === "실제 반영 대기") return ids.keywordRealApplyRequestId || ids.keywordDryRunRequestId || ids.keywordRequestId;
  if (stage === "가격 최종 재적용" || stage === "출시 완료") return ids.finalPriceRequestId;
  return "";
}

type PriceIssueState = { kind: "ok" | "critical" | "unsupported" | "unknown"; count: number; label: string };

function getPriceIssueState(result: PriceActionsResult | null): PriceIssueState {
  const summary = result?.summary;
  if (!summary) return { kind: "unknown", count: 0, label: "확인 전" };
  const visibleUnrepaired = Number(summary.visible_price_unrepaired_count ?? 0);
  const missingPrice = Number(summary.missing_price_count ?? 0);
  const count = visibleUnrepaired + missingPrice;
  if (count > 0) return { kind: "critical", count, label: "가격 확인 필요" };
  if (summary.verification_supported === false) return { kind: "unsupported", count: 0, label: "가격 화면 검증 필요" };
  return { kind: "ok", count: 0, label: "확인 완료" };
}

function getKeywordWarningCount(state: KeywordApplyState | null) {
  return state?.warningCount ?? 0;
}

function getLaunchBoardIssueCount({ priceIssueState, uploadRows, goodsKeys, titleTargetCount, keywordApplyState, cockpit }: { priceIssueState: PriceIssueState; uploadRows: ProductLaunchUploadRow[]; goodsKeys: string[]; titleTargetCount: number; keywordApplyState: KeywordApplyState | null; cockpit: ReturnType<typeof buildCockpit> }) {
  const missingProductGroupCount = Object.values(buildGoodsKeyGroupMap(uploadRows)).filter((metadata) => metadata.product_group_status !== "registered").length;
  const titleCoverageMissingCount = Math.max(0, expectedLaunchApplyCount(goodsKeys, buildGoodsKeyGroupMap(uploadRows)) - titleTargetCount);
  const failedDryRunOrApplyCount = [keywordApplyState?.dryRunStatus, keywordApplyState?.realApplyStatus].filter((status) => status === "failed").length;
  const actualApplyFailedCount = keywordApplyState?.failedCount ?? 0;
  return priceIssueState.count + missingProductGroupCount + titleCoverageMissingCount + failedDryRunOrApplyCount + actualApplyFailedCount + (cockpit.primaryAction === "failed" ? 1 : 0) + (keywordApplyState?.warningCount ?? 0);
}

function getUploadCounts(result: UploadActionsResult | null, rows: ProductLaunchUploadRow[], rowsWithGoodsKey: ProductLaunchUploadRow[]) {
  return { targetRows: rows.length, goodsKeyCount: rowsWithGoodsKey.length, failedRows: rows.filter(isFailedUploadRow).length, duplicateRows: rows.filter(isDuplicatePtnGoodsCdError).length };
}
function getPriceCounts(result: PriceActionsResult | null, targetGoodsKeys: number) { const summary = result?.summary; return { targetGoodsKeys, okCount: Number(summary?.ok_count ?? 0), failCount: Number(summary?.failed_count ?? summary?.fail_count ?? 0) }; }
function getKeywordSummary(result: KeywordRunsResult | null, targetCount: number) { const latest = result?.runs?.[0]; const artifact = latest?.artifacts?.find((item) => item.expected && !item.expired); const failed = hasKeywordFailure(result); return { targetCount, artifact, artifactState: artifact ? "ready" : latest?.status === "queued" || latest?.status === "in_progress" ? "waiting" : failed ? "missing" : "not checked", reviewPendingCount: artifact ? 1 : 0, failureReason: failed && !artifact ? "키워드 결과 파일이 아직 없습니다. 실행 중이거나 실패했을 수 있습니다." : "-" }; }
function isFinalPriceResult(result: PriceActionsResult | null) { if (!result) return false; const status = String(result.summary?.status ?? result.status ?? "").toLowerCase(); const conclusion = String(result.runConclusion ?? "").toLowerCase(); return ["success", "failed", "failure", "error"].includes(status) || ["success", "failure", "cancelled", "timed_out"].includes(conclusion); }
function isSuccessfulPriceResult(result: PriceActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return status === "success" || conclusion === "success"; }
function isAutopilotSafePriceResult(result: PriceActionsResult | null) {
  if (!result) return false;
  const summary = result.summary;
  const status = String(summary?.status ?? result.status ?? "").toLowerCase();
  const conclusion = String(result.runConclusion ?? "").toLowerCase();
  const failedCount = Number(summary?.failed_count ?? summary?.fail_count ?? 0);
  const missingPriceCount = Number(summary?.missing_price_count ?? 0);
  const missingMallRowCount = Number(summary?.missing_mall_row_count ?? 0);
  const mismatchCount = Number(summary?.mismatch_count ?? 0);
  if (["failed", "partial_failure", "failure", "error"].includes(status) || ["failure", "cancelled", "timed_out"].includes(conclusion)) return false;
  if (missingPriceCount > 0 || missingMallRowCount > 0 || mismatchCount > 0 || failedCount > 0) return false;
  const verificationUnavailableButApiComplete = status === "success" && summary?.verification_supported === false && Number(summary?.api_success_count ?? 0) === Number(summary?.required_update_count ?? -1);
  return status === "success" || conclusion === "success" || verificationUnavailableButApiComplete;
}
function hasPriceFailure(result: PriceActionsResult | null) { const status = String(result?.summary?.status ?? result?.status ?? "").toLowerCase(); const conclusion = String(result?.runConclusion ?? "").toLowerCase(); return ["failed", "partial_failure", "failure", "error"].includes(status) || ["failure", "cancelled", "timed_out"].includes(conclusion); }
function isSuccessfulUploadResult(result: UploadActionsResult | null, rowsWithGoodsKeyCount: number) { return isFinalUploadPollingResult(result, rowsWithGoodsKeyCount) && !hasUploadFailure(result) && rowsWithGoodsKeyCount > 0; }
function hasUploadFailure(result: UploadActionsResult | null) { return isConfirmedUploadFailure(result) || getUploadSummaryStatus(result) === "failed" || getUploadSummaryStatus(result) === "partial_failure"; }
function isKeywordRunning(result: KeywordRunsResult | null) { const status = result?.runs?.[0]?.status; return status === "queued" || status === "in_progress"; }
function hasKeywordFailure(result: KeywordRunsResult | null) { const run = result?.runs?.[0]; return run?.status === "completed" && ["failure", "cancelled", "timed_out"].includes(String(run.conclusion ?? "")) && !run.artifacts?.some((artifact) => artifact.expected && !artifact.expired); }
function isFinalKeywordRuns(result: KeywordRunsResult | null) { const run = result?.runs?.[0]; return !!run && (hasKeywordFailure(result) || !!run.artifacts?.some((artifact) => artifact.expected && !artifact.expired)); }
function buildCockpit(state: { hasUploadRequest: boolean; uploadActive: boolean; uploadSuccess: boolean; uploadFailed: boolean; priceActive: boolean; priceSuccess: boolean; priceFailed: boolean; keywordActive: boolean; keywordSuccess: boolean; keywordFailed: boolean }) {
  const steps: CockpitStep[] = [
    { name: "상품업로드", state: state.uploadFailed ? "failed" : state.uploadActive ? "checking" : state.uploadSuccess ? "success" : "waiting", action: state.uploadSuccess ? "가격설정 시작" : state.uploadActive ? "상품업로드 결과 확인 중..." : "상품업로드 시작", message: state.uploadSuccess ? "goods_key가 준비되었습니다." : state.uploadActive ? "중복 클릭 없이 자동 확인합니다." : "행 번호 입력 후 시작하세요." },
    { name: "가격설정", state: state.priceFailed ? "failed" : state.priceActive ? "checking" : state.priceSuccess ? "success" : state.uploadSuccess ? "action" : "waiting", action: state.priceSuccess ? "키워드 dry_run 시작" : state.priceActive ? "가격설정 결과 확인 중..." : "가격설정 시작", message: state.uploadSuccess ? "업로드 성공 후 실행할 수 있습니다." : "업로드 완료 후 활성화됩니다." },
    { name: "키워드/상품명 준비", state: state.keywordFailed ? "failed" : state.keywordActive ? "running" : state.keywordSuccess ? "action" : state.priceSuccess ? "action" : "waiting", action: state.keywordSuccess ? "키워드 검토 시작" : state.keywordActive ? "키워드 결과 확인 중..." : "키워드 dry_run 시작", message: state.keywordSuccess ? "검토 진행 중 · 승인된 행이 있으면 적용 계획 생성으로 이동" : state.keywordActive ? "키워드 엔진이 실행 중입니다. 결과 파일이 생성되면 자동으로 표시됩니다." : state.keywordFailed ? "키워드 엔진 실행이 실패했습니다." : "dry_run 결과만 준비합니다." },
    { name: "키워드 결과 검토", state: state.keywordSuccess ? "action" : "waiting", action: state.keywordSuccess ? "키워드 검토 시작" : "artifact 생성 후 열 수 있습니다.", message: state.keywordSuccess ? "검토 진행 중 · 승인된 행이 있으면 적용 계획 생성으로 이동" : "artifact 생성 후 열 수 있습니다." },
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
  const nextAction = primaryAction === "failed" ? "문제가 발생했습니다. 실패 원인을 확인하세요." : state.uploadActive ? "상품업로드 결과를 확인하는 중입니다. 잠시만 기다려주세요." : state.priceActive ? "진행 중입니다. 현재 단계: 가격설정. 자동으로 다음 단계로 이동합니다. 가격설정 결과 확인 중..." : state.keywordActive ? "진행 중입니다. 현재 단계: 키워드/상품명 준비. 자동으로 다음 단계로 이동합니다. 키워드 dry_run 결과 확인 중..." : primaryAction === "upload" ? "행 번호를 입력하고 상품업로드를 시작하세요." : primaryAction === "price" ? "상품업로드가 완료되었습니다. 이제 가격설정을 시작하세요." : primaryAction === "keyword" ? "가격설정이 완료되었습니다. 이제 키워드 dry_run을 시작하세요." : primaryAction === "review" ? "키워드 결과가 준비되었습니다. 검토 화면에서 확인하세요." : steps.find((step) => step.name === currentStage)?.action ?? "상품업로드 시작";
  return { steps, primaryAction, currentStage, nextAction };
}
