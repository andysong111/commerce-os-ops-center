"use client";

import Link from "next/link";
import type { KeywordApplyState } from "@/components/keyword-review/KeywordReviewWorkspace";
import {
  createReviewedRows,
  type KeywordReviewRow,
} from "@/lib/keywordReviewQueue";
import {
  buildKeywordShoplingPayloadPreview,
  type KeywordPayloadPreviewResult,
} from "@/lib/keywordReviewPayloadPreview";
import {
  buildCompactKeywordApplyExecutionPlan,
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  formatKeywordExecutionPreflightLabels,
  type KeywordExecutionPreflightResult,
} from "@/lib/keywordReviewExecutionPreflight";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildGoodsKeyGroupJson,
  buildGoodsKeyGroupMap,
  buildGoodsKeyProductGroupMap,
  buildKeywordEngineDispatchPayload,
  buildLaunchSourceRowGroups,
  expandSeedKeywordsBySourceRowToGoodsKeys,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  expectedLaunchApplyCount,
  expectedPriceModifyUpdateCount,
  FULL_PRICE_POLICY_MALL_COUNT,
  extractUploadRows,
  inferProductGroupFromPtnGoodsCd,
  normalizeManualKeywordOverride,
  parseManualCandidateList,
  resolveManualTitleOverride,
  isGithubCredentialError,
  type ProductLaunchPriceError,
  type ProductLaunchUploadRow,
} from "@/lib/productLaunchFlow";
import { buildManualMallPreviewRows } from "@/lib/manualMallPreviewRows";
import { getMarketsForProductGroup } from "@/lib/productGroupMarketRegistry";

const PRODUCT_LAUNCH_SESSION_STORAGE_KEY = "productLaunchFlow.session.v2";
const UPLOAD_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.uploadRequestId";
const PRICE_REQUEST_ID_STORAGE_KEY = "productLaunchFlow.priceRequestId";
const LAST_ROW_EXPRESSION_STORAGE_KEY = "productLaunchFlow.lastRowExpression";
const KEYWORD_SEED_STORAGE_KEY = "productLaunchFlow.keywordSeed";
const SEED_KEYWORDS_STORAGE_PREFIX =
  "productLaunchFlow.seedKeywordsBySourceRow";
const MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX =
  "productLaunchFlow.manualTitleOverrides";
const MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX =
  "productLaunchFlow.manualKeywordOverrides";
const MANUAL_WIZARD_STORAGE_KEY = "productLaunchFlow.manualWizard.v1";
const MANUAL_CANDIDATES_STORAGE_KEY =
  "productLaunchFlow.manualCandidatesBySourceRow";
const KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY =
  "opsCenter.keywordEngine.importedArtifact.v1";
const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_MAX_POLLS = 24;
const ACTIVE_POLL_INTERVAL_MS = 5_000;
const ACTIVE_MAX_POLLS = 24;
const APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING";

const PRODUCT_LAUNCH_INLINE_REVIEW_COPY = [APPLY_CONFIRMATION_TEXT] as const;

type RunResult = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  commandPreview?: string;
};
type UploadSummary = {
  status?: unknown;
  rows?: ProductLaunchUploadRow[];
  goods_keys?: ProductLaunchUploadRow[];
};
type UploadActionsResult = {
  status?: string;
  phase?: string;
  message?: string;
  requestId?: string;
  runId?: number;
  runStatus?: string;
  runConclusion?: string | null;
  runUrl?: string;
  summary?: UploadSummary | unknown;
};
type PriceActionsResult = {
  status?: string;
  message?: string;
  requestId?: string;
  runStatus?: string;
  runConclusion?: string | null;
  runUrl?: string;
  summary?: {
    status?: unknown;
    exit_code?: unknown;
    goods_key_count?: unknown;
    estimated_mall_update_count?: unknown;
    policy_override_count?: unknown;
    ok_count?: unknown;
    fail_count?: unknown;
    failed_count?: unknown;
    not_applied_count?: unknown;
    blank_risk_count?: unknown;
    affected_malls?: unknown;
    errors?: ProductLaunchPriceError[];
    verification_supported?: unknown;
    api_success_count?: unknown;
    required_update_count?: unknown;
    missing_price_count?: unknown;
    missing_mall_row_count?: unknown;
    mismatch_count?: unknown;
    visible_price_unrepaired_count?: unknown;
  };
};
type KeywordArtifact = {
  id: number;
  name: string;
  expired?: boolean;
  expected?: boolean;
};
type KeywordRun = {
  id: number;
  status?: string | null;
  conclusion?: string | null;
  createdAt?: string;
  htmlUrl?: string;
  artifacts?: KeywordArtifact[];
};
type KeywordRunsResult = {
  status?: string;
  message?: string;
  actionsUrl?: string;
  expectedArtifactName?: string;
  outputReviewRoute?: string;
  runs?: KeywordRun[];
};
type ManualApplyActionsResult = {
  status?: string;
  phase?: string;
  message?: string;
  requestId?: string;
  runUrl?: string;
  githubActionsUrl?: string;
  summary?: Record<string, unknown>;
  applyResults?: Array<Record<string, unknown>>;
  verifyResults?: Array<Record<string, unknown>>;
  blockedItems?: Array<Record<string, unknown>>;
  errors?: unknown;
  warnings?: unknown;
};
type KeywordDispatchResult = {
  repo?: string;
  workflowFile?: string;
  actionsUrl?: string;
  expectedArtifactName?: string;
  message?: string;
};
type ProductLaunchSessionV2 = {
  rowExpression?: string;
  startedAt?: string;
  updatedAt?: string;
  uploadRequestId?: string;
  priceRequestId?: string;
  keywordRequestId?: string;
  keywordRunId?: string;
  keywordDryRunRequestId?: string;
  keywordRealApplyRequestId?: string;
  finalPriceRequestId?: string;
  uploadResult?: UploadActionsResult | null;
  priceResult?: PriceActionsResult | null;
  keywordResult?: KeywordRunsResult | null;
  finalPriceResult?: PriceActionsResult | null;
  seedKeywordsBySourceRow?: Record<string, string>;
  stage?: string;
};

export function ProductLaunchFlow() {
  void PRODUCT_LAUNCH_INLINE_REVIEW_COPY;
  const restoredSession = useMemo(() => readProductLaunchSession(), []);
  const [sessionRestored, setSessionRestored] = useState(
    () => !!restoredSession,
  );
  const [uploadRecovered, setUploadRecovered] = useState(false);
  const [rowExpression, setRowExpression] = useState(
    () =>
      restoredSession?.rowExpression ??
      getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY),
  );
  const [lastStartedRowExpression, setLastStartedRowExpression] = useState(
    () =>
      restoredSession?.rowExpression ??
      getStoredValue(LAST_ROW_EXPRESSION_STORAGE_KEY),
  );
  const [uploadRequestId, setUploadRequestId] = useState(
    () =>
      restoredSession?.uploadRequestId ??
      getStoredValue(UPLOAD_REQUEST_ID_STORAGE_KEY),
  );
  const [priceRequestId, setPriceRequestId] = useState(
    () =>
      restoredSession?.priceRequestId ??
      getStoredValue(PRICE_REQUEST_ID_STORAGE_KEY),
  );
  const [uploadRunning, setUploadRunning] = useState(false);
  const [uploadFetching, setUploadFetching] = useState(false);
  const [priceRunning, setPriceRunning] = useState(false);
  const [priceFetching, setPriceFetching] = useState(false);
  const [uploadRunResult, setUploadRunResult] = useState<RunResult | null>(
    null,
  );
  const [uploadActionsResult, setUploadActionsResult] =
    useState<UploadActionsResult | null>(restoredSession?.uploadResult ?? null);
  const [uploadPolling, setUploadPolling] = useState(false);
  const [uploadPollStartedAt, setUploadPollStartedAt] = useState<number | null>(
    null,
  );
  const [uploadLastCheckedAt, setUploadLastCheckedAt] = useState<Date | null>(
    null,
  );
  const [uploadPollCount, setUploadPollCount] = useState(0);
  const [uploadNextCheckIn, setUploadNextCheckIn] = useState(0);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const uploadPollCountRef = useRef(0);
  const [priceRunResult, setPriceRunResult] = useState<RunResult | null>(null);
  const [priceActionsResult, setPriceActionsResult] =
    useState<PriceActionsResult | null>(restoredSession?.priceResult ?? null);
  const [pricePolling, setPricePolling] = useState(false);
  const [pricePollCount, setPricePollCount] = useState(0);
  const [priceLastCheckedAt, setPriceLastCheckedAt] = useState<Date | null>(
    null,
  );
  const [finalPriceRequestId, setFinalPriceRequestId] = useState(
    restoredSession?.finalPriceRequestId ?? "",
  );
  const [finalPriceRunResult, setFinalPriceRunResult] =
    useState<RunResult | null>(null);
  const [finalPriceActionsResult, setFinalPriceActionsResult] =
    useState<PriceActionsResult | null>(
      restoredSession?.finalPriceResult ?? null,
    );
  const [finalPriceRunning, setFinalPriceRunning] = useState(false);
  const [finalPriceFetching, setFinalPriceFetching] = useState(false);
  const [finalPricePolling, setFinalPricePolling] = useState(false);
  const [finalPricePollCount, setFinalPricePollCount] = useState(0);
  const [finalPriceLastCheckedAt, setFinalPriceLastCheckedAt] =
    useState<Date | null>(null);
  const [keywordSeed, setKeywordSeed] = useState(() =>
    getStoredValue(KEYWORD_SEED_STORAGE_KEY),
  );
  const [seedKeywordsBySourceRow, setSeedKeywordsBySourceRow] = useState<
    Record<string, string>
  >(restoredSession?.seedKeywordsBySourceRow ?? {});
  const [manualTitleOverridesByGoodsKey, setManualTitleOverridesByGoodsKey] =
    useState<Record<string, string>>({});
  const [
    manualKeywordOverridesByGoodsKey,
    setManualKeywordOverridesByGoodsKey,
  ] = useState<Record<string, string>>({});
  const [keywordPreview, setKeywordPreview] = useState<unknown>(null);
  const [keywordDispatchResult, setKeywordDispatchResult] =
    useState<KeywordDispatchResult | null>(null);
  const [keywordRunsResult, setKeywordRunsResult] =
    useState<KeywordRunsResult | null>(restoredSession?.keywordResult ?? null);
  const [keywordImportMessage, setKeywordImportMessage] = useState<string>("");
  const [, setEmbeddedReviewOpen] = useState(false);
  const [, setKeywordImportedAt] = useState("");
  const [keywordBusy, setKeywordBusy] = useState<string>("");
  const [keywordPolling, setKeywordPolling] = useState(false);
  const [keywordPollCount, setKeywordPollCount] = useState(0);
  const [keywordLastCheckedAt, setKeywordLastCheckedAt] = useState<Date | null>(
    null,
  );
  const [skipIfGoodsKey, setSkipIfGoodsKey] = useState(true);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [autoActualApplyEnabled, setAutoActualApplyEnabled] = useState(false);
  const [keywordApplyState, setKeywordApplyState] =
    useState<KeywordApplyState | null>(null);
  const [manualPreviewStatus, setManualPreviewStatus] = useState("");
  const [manualPreviewResult, setManualPreviewResult] =
    useState<KeywordPayloadPreviewResult | null>(null);
  const [manualPreflightResult, setManualPreflightResult] =
    useState<KeywordExecutionPreflightResult | null>(null);
  const [manualApplyBusy, setManualApplyBusy] = useState(false);
  const [manualApplyRequestId, setManualApplyRequestId] = useState(
    restoredSession?.keywordRealApplyRequestId ?? "",
  );
  const [manualApplyActionsUrl, setManualApplyActionsUrl] = useState("");
  const [manualApplyRunUrl, setManualApplyRunUrl] = useState("");
  const [manualApplyCommandPreview, setManualApplyCommandPreview] =
    useState("");
  const [manualApplyResult, setManualApplyResult] =
    useState<ManualApplyActionsResult | null>(null);
  const [manualApplyPolling, setManualApplyPolling] = useState(false);
  const [manualApplyPollCount, setManualApplyPollCount] = useState(0);
  const [manualApplyLastCheckedAt, setManualApplyLastCheckedAt] =
    useState<Date | null>(null);
  const [manualApplyNextCheckIn, setManualApplyNextCheckIn] = useState(0);
  const [manualApplyErrorMessage, setManualApplyErrorMessage] = useState("");
  const autoPriceStartedForUploadRequestRef = useRef<string>("");
  const autoKeywordStartedForPriceRequestRef = useRef<string>("");
  const autoKeywordImportedArtifactRef = useRef<string>("");
  const finalPriceStartedForRealApplyRequestRef = useRef<string>("");

  const uploadResultRows = useMemo(
    () => extractUploadRows(uploadActionsResult),
    [uploadActionsResult],
  );
  const uploadRows = useMemo(
    () => extractRowsWithGoodsKey(uploadActionsResult),
    [uploadActionsResult],
  );
  const goodsKeys = useMemo(
    () => dedupeGoodsKeysForPriceModify(uploadRows),
    [uploadRows],
  );
  const goodsKeyProductGroupMap = useMemo(
    () => buildGoodsKeyProductGroupMap(uploadRows),
    [uploadRows],
  );
  const manualMallPreviewRows = useMemo(
    () =>
      buildManualMallPreviewRows({
        previewResult: manualPreviewResult,
        preflightResult: manualPreflightResult,
        applyResults: Array.isArray(manualApplyResult?.applyResults)
          ? manualApplyResult.applyResults
          : [],
        verifyResults: Array.isArray(manualApplyResult?.verifyResults)
          ? manualApplyResult.verifyResults
          : [],
      }),
    [manualPreviewResult, manualPreflightResult, manualApplyResult],
  );
  const uploadPollingFinal = isFinalUploadPollingResult(
    uploadActionsResult,
    uploadRows.length,
  );
  const manualOverrideStorageScope = currentManualOverrideStorageScope(
    rowExpression,
    uploadRequestId,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeedKeywordsBySourceRow(
      readStoredRecord(
        `${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      ),
    );
  }, [manualOverrideStorageScope]);

  useEffect(() => {
    persistRecord(
      `${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      seedKeywordsBySourceRow,
    );
  }, [manualOverrideStorageScope, seedKeywordsBySourceRow]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualTitleOverridesByGoodsKey(
      readStoredRecord(
        `${MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      ),
    );
    setManualKeywordOverridesByGoodsKey(
      readStoredRecord(
        `${MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      ),
    );
  }, [manualOverrideStorageScope]);

  useEffect(() => {
    persistRecord(
      `${MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      manualTitleOverridesByGoodsKey,
    );
  }, [manualOverrideStorageScope, manualTitleOverridesByGoodsKey]);

  useEffect(() => {
    persistRecord(
      `${MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
      manualKeywordOverridesByGoodsKey,
    );
  }, [manualOverrideStorageScope, manualKeywordOverridesByGoodsKey]);

  const pollUploadResult = useCallback(
    async (reset: boolean, requestIdOverride?: string) => {
      const effectiveRequestId = requestIdOverride || uploadRequestId;
      if (uploadFetching) return;
      if (reset) {
        uploadPollCountRef.current = 0;
        setUploadPollCount(0);
        setUploadElapsedSeconds(0);
        setUploadPollStartedAt(Date.now());
        setUploadPolling(true);
        setUploadNextCheckIn(0);
        setUploadActionsResult({
          status: "pending",
          phase: "request_sent",
          requestId: effectiveRequestId,
          message:
            "상품업로드 실행을 확인하는 중입니다. 결과가 준비되면 자동으로 다음 단계로 이동합니다.",
        });
      }
      uploadPollCountRef.current += 1;
      setUploadPollCount(uploadPollCountRef.current);
      setUploadFetching(true);
      try {
        const url = effectiveRequestId
          ? `/api/shopling-product-upload/actions-result?request_id=${encodeURIComponent(effectiveRequestId)}`
          : "/api/shopling-product-upload/actions-result";
        const data = await (await fetch(url)).json();
        setUploadActionsResult(data);
        const rows = extractRowsWithGoodsKey(data);
        if (isSuccessfulUploadResult(data, rows.length))
          setUploadRecovered(true);
        const final = isFinalUploadPollingResult(data, rows.length);
        if (final || uploadPollCountRef.current >= UPLOAD_MAX_POLLS) {
          setUploadPolling(false);
          setUploadNextCheckIn(0);
        } else {
          setUploadNextCheckIn(UPLOAD_POLL_INTERVAL_MS / 1_000);
        }
      } catch (error) {
        setUploadActionsResult({
          status: "error",
          phase: "unknown",
          requestId: effectiveRequestId,
          message:
            error instanceof Error
              ? error.message
              : "상품업로드 결과를 가져오는 중 오류가 발생했습니다.",
        });
        setUploadPolling(false);
        setUploadNextCheckIn(0);
      } finally {
        setUploadLastCheckedAt(new Date());
        setUploadFetching(false);
      }
    },
    [uploadFetching, uploadRequestId],
  );

  const startUploadPolling = useCallback(
    (requestId: string) => {
      uploadPollCountRef.current = 0;
      setUploadPollCount(0);
      setUploadElapsedSeconds(0);
      setUploadPollStartedAt(Date.now());
      setUploadPolling(true);
      setUploadNextCheckIn(0);
      setUploadActionsResult({
        status: "pending",
        phase: "request_sent",
        requestId,
        message:
          "상품업로드 실행을 확인하는 중입니다. 결과가 준비되면 자동으로 다음 단계로 이동합니다.",
      });
      void pollUploadResult(false, requestId);
    },
    [pollUploadResult],
  );

  useEffect(() => {
    if (!uploadPolling || uploadPollingFinal) return;
    const timer = window.setInterval(() => {
      setUploadNextCheckIn((current) => Math.max(0, current - 1));
      if (uploadPollStartedAt)
        setUploadElapsedSeconds(
          Math.max(0, Math.floor((Date.now() - uploadPollStartedAt) / 1_000)),
        );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [uploadPolling, uploadPollingFinal, uploadPollStartedAt]);

  useEffect(() => {
    if (!uploadPolling || uploadPollingFinal) return;
    if (
      uploadPollCount === 0 ||
      uploadPollCount >= UPLOAD_MAX_POLLS ||
      uploadFetching
    )
      return;
    const timer = window.setTimeout(() => {
      void pollUploadResult(false, uploadRequestId);
    }, UPLOAD_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [
    uploadPolling,
    uploadPollCount,
    uploadPollingFinal,
    uploadFetching,
    pollUploadResult,
    uploadRequestId,
  ]);

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
        body: JSON.stringify({
          rowExpression,
          channel: "",
          skip_if_goods_key: skipIfGoodsKey,
          dump: false,
          sleep: "1.2",
        }),
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
      setUploadRunResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "상품업로드 실행 요청 중 오류가 발생했습니다.",
      });
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
        body: JSON.stringify({
          goods_key: goodsKeys.join(","),
          goods_key_group_json: buildGoodsKeyGroupJson(uploadRows),
          policy_overrides: [],
        }),
      });
      const data = await response.json();
      setPriceRunResult(data);
      if (typeof data.requestId === "string" && data.requestId) {
        setPriceRequestId(data.requestId);
        persistValue(PRICE_REQUEST_ID_STORAGE_KEY, data.requestId);
      }
    } catch (error) {
      setPriceRunResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "가격설정 실행 요청 중 오류가 발생했습니다.",
      });
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
      const url = priceRequestId
        ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(priceRequestId)}`
        : "/api/shopling-price-modify/actions-result";
      const data = await (await fetch(url)).json();
      setPriceActionsResult(data);
      setPriceLastCheckedAt(new Date());
      if (isFinalPriceResult(data)) setPricePolling(false);
    } catch (error) {
      setPriceActionsResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "가격설정 결과를 가져오는 중 오류가 발생했습니다.",
      });
    } finally {
      setPriceFetching(false);
    }
  }, [priceFetching, priceRequestId]);

  useEffect(() => {
    if (!pricePolling || priceFetching) return;
    if (
      pricePollCount >= ACTIVE_MAX_POLLS ||
      isFinalPriceResult(priceActionsResult)
    )
      return;
    const timer = window.setTimeout(
      () => {
        setPricePollCount((count) => {
          const next = count + 1;
          if (next >= ACTIVE_MAX_POLLS) setPricePolling(false);
          return next;
        });
        void fetchPriceResult();
      },
      pricePollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    pricePolling,
    priceFetching,
    pricePollCount,
    priceActionsResult,
    fetchPriceResult,
  ]);

  const runFinalPriceModify = useCallback(async () => {
    if (finalPriceRunning || goodsKeys.length === 0) return;
    setFinalPriceRunning(true);
    setFinalPriceRunResult(null);
    setFinalPriceActionsResult(null);
    try {
      const response = await fetch("/api/shopling-price-modify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goods_key: goodsKeys.join(","),
          goods_key_group_json: buildGoodsKeyGroupJson(uploadRows),
          policy_overrides: [],
          reason: "finalize_after_keyword_apply",
        }),
      });
      const data = await response.json();
      setFinalPriceRunResult(data);
      if (typeof data.requestId === "string" && data.requestId)
        setFinalPriceRequestId(data.requestId);
    } catch (error) {
      setFinalPriceRunResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "가격 최종 재적용 실행 요청 중 오류가 발생했습니다.",
      });
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
      const url = finalPriceRequestId
        ? `/api/shopling-price-modify/actions-result?request_id=${encodeURIComponent(finalPriceRequestId)}`
        : "/api/shopling-price-modify/actions-result";
      const data = await (await fetch(url)).json();
      setFinalPriceActionsResult(data);
      setFinalPriceLastCheckedAt(new Date());
      if (isFinalPriceResult(data)) setFinalPricePolling(false);
    } catch (error) {
      setFinalPriceActionsResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "가격 최종 재적용 결과를 가져오는 중 오류가 발생했습니다.",
      });
    } finally {
      setFinalPriceFetching(false);
    }
  }, [finalPriceFetching, finalPriceRequestId]);

  useEffect(() => {
    if (!finalPricePolling || finalPriceFetching) return;
    if (
      finalPricePollCount >= ACTIVE_MAX_POLLS ||
      isFinalPriceResult(finalPriceActionsResult)
    )
      return;
    const timer = window.setTimeout(
      () => {
        setFinalPricePollCount((count) => {
          const next = count + 1;
          if (next >= ACTIVE_MAX_POLLS) setFinalPricePolling(false);
          return next;
        });
        void fetchFinalPriceResult();
      },
      finalPricePollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    finalPricePolling,
    finalPriceFetching,
    finalPricePollCount,
    finalPriceActionsResult,
    fetchFinalPriceResult,
  ]);

  const sourceRowGroups = useMemo(
    () =>
      buildLaunchSourceRowGroups(
        uploadRows,
        lastStartedRowExpression || rowExpression,
      ),
    [lastStartedRowExpression, rowExpression, uploadRows],
  );
  const seedKeywordsByGoodsKey = useMemo(
    () =>
      expandSeedKeywordsBySourceRowToGoodsKeys(
        seedKeywordsBySourceRow,
        sourceRowGroups,
      ),
    [seedKeywordsBySourceRow, sourceRowGroups],
  );
  const keywordPayload = useCallback(
    () =>
      buildKeywordEngineDispatchPayload(
        uploadRows,
        keywordSeed,
        seedKeywordsByGoodsKey,
      ),
    [keywordSeed, seedKeywordsByGoodsKey, uploadRows],
  );
  const manualCandidatesReady = hasManualCandidatesForAllSourceRows(
    sourceRowGroups,
    manualTitleOverridesByGoodsKey,
    manualKeywordOverridesByGoodsKey,
  );

  const previewKeywordDispatch = async () => {
    if (keywordBusy) return;
    setKeywordBusy("preview");
    setKeywordPreview(null);
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      persistRecord(
        `${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
        seedKeywordsBySourceRow,
      );
      const response = await fetch("/api/engine-runners/dispatch-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keywordPayload()),
      });
      setKeywordPreview(await response.json());
    } catch (error) {
      setKeywordPreview({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "키워드 엔진 입력값 확인 중 오류가 발생했습니다.",
      });
    } finally {
      setKeywordBusy("");
    }
  };

  const dispatchKeywordEngine = useCallback(async () => {
    if (keywordBusy) return;
    setKeywordBusy("dispatch");
    try {
      persistValue(KEYWORD_SEED_STORAGE_KEY, keywordSeed);
      persistRecord(
        `${SEED_KEYWORDS_STORAGE_PREFIX}.${manualOverrideStorageScope}`,
        seedKeywordsBySourceRow,
      );
      const response = await fetch("/api/engine-runners/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keywordPayload()),
      });
      setKeywordDispatchResult(await response.json());
      setKeywordPolling(true);
      setKeywordPollCount(0);
    } catch (error) {
      setKeywordDispatchResult({
        message:
          error instanceof Error
            ? error.message
            : "키워드 엔진 실행 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setKeywordBusy("");
    }
  }, [
    keywordBusy,
    keywordPayload,
    keywordSeed,
    manualOverrideStorageScope,
    seedKeywordsBySourceRow,
  ]);

  const fetchKeywordRuns = useCallback(async () => {
    if (keywordBusy) return;
    setKeywordBusy("runs");
    try {
      const data = await (
        await fetch("/api/engine-runners/runs?kind=keyword_engine")
      ).json();
      setKeywordRunsResult(data);
      setKeywordLastCheckedAt(new Date());
      if (isFinalKeywordRuns(data)) setKeywordPolling(false);
    } catch (error) {
      setKeywordRunsResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "키워드 실행 결과 확인 중 오류가 발생했습니다.",
      });
    } finally {
      setKeywordBusy("");
    }
  }, [keywordBusy]);

  useEffect(() => {
    if (!keywordPolling || keywordBusy) return;
    if (
      keywordPollCount >= ACTIVE_MAX_POLLS ||
      isFinalKeywordRuns(keywordRunsResult)
    )
      return;
    const timer = window.setTimeout(
      () => {
        setKeywordPollCount((count) => {
          const next = count + 1;
          if (next >= ACTIVE_MAX_POLLS) setKeywordPolling(false);
          return next;
        });
        void fetchKeywordRuns();
      },
      keywordPollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    keywordPolling,
    keywordBusy,
    keywordPollCount,
    keywordRunsResult,
    fetchKeywordRuns,
  ]);

  const importKeywordArtifact = async (
    run: KeywordRun,
    artifact: KeywordArtifact,
  ) => {
    if (keywordBusy) return;
    setKeywordBusy(`import-${artifact.id}`);
    setKeywordImportMessage("");
    try {
      const response = await fetch(
        "/api/engine-runners/artifacts/import-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "keyword_engine",
            runId: run.id,
            artifactId: artifact.id,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.message ?? "키워드 결과 가져오기에 실패했습니다.");
      const importedAt = new Date().toISOString();
      window.sessionStorage.setItem(
        KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY,
        JSON.stringify({
          kind: data.kind,
          source: data.source,
          files: data.files,
          generatedSourceFiles: data.generatedSourceFiles,
          goodsKeyGroupMap: buildGoodsKeyGroupMap(uploadRows),
          importedAt,
          artifactName: artifact.name,
          notAppliedToShopling: true,
          notPublished: true,
          requiresHumanReview: true,
        }),
      );
      setKeywordImportedAt(importedAt);
      setEmbeddedReviewOpen(true);
      setKeywordImportMessage(
        "키워드 결과 파일이 준비되었습니다. 이 화면에서 상품명 후보 선택부터 실제 반영 전 dry_run까지 이어서 진행합니다.",
      );
    } catch (error) {
      setKeywordImportMessage(
        error instanceof Error
          ? error.message
          : "키워드 결과 가져오기에 실패했습니다.",
      );
    } finally {
      setKeywordBusy("");
    }
  };

  const openInlineKeywordReview = async () => {
    const artifact = keywordSummary.artifact;
    const run = keywordRunsResult?.runs?.find((item) =>
      item.artifacts?.some((candidate) => candidate.id === artifact?.id),
    );
    if (artifact && run) {
      await importKeywordArtifact(run, artifact);
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY)
    ) {
      setEmbeddedReviewOpen(true);
      return;
    }
    setKeywordImportMessage(
      "키워드 결과 파일은 불러왔지만 검토할 후보가 없습니다. GitHub Actions 로그 또는 artifact 파일을 확인하세요.",
    );
  };

  const buildManualReviewedRows = useCallback(() => {
    const rows: KeywordReviewRow[] = uploadRows.map((row, index) => {
      const goodsKey = String(row.goods_key ?? "").trim();
      return {
        goodsKey,
        mallKey: "",
        originalTitle: String(
          row.title ??
            row.product_name ??
            row.productTitle ??
            row.upload_title ??
            row.registered_title ??
            row.final_title ??
            "",
        ),
        recommendedTitle: resolveManualTitleOverride(
          manualTitleOverridesByGoodsKey[goodsKey],
          goodsKey,
        ),
        originalSiteSrch: "",
        recommendedSiteSrch: normalizeManualKeywordOverride(
          manualKeywordOverridesByGoodsKey[goodsKey],
        ),
        siteSrchKeywordCount: null,
        verifiedKeywordCount: null,
        qualityStatus: "manual",
        confidenceStatus: "manual",
        blockReason: "",
        warningFlags: "",
        reviewReason: "manual product launch candidate confirmation",
        payloadStatus: "",
        approvalStatus: "approved",
        manualCandidateKeywords: normalizeManualKeywordOverride(
          manualKeywordOverridesByGoodsKey[goodsKey],
        ),
        sourceRowIndex: index + 2,
        raw: {},
        classification: "auto_apply_candidate",
      };
    });
    return createReviewedRows(rows, buildGoodsKeyGroupMap(uploadRows)).map(
      (row) => ({ ...row, reviewStatus: "approved" as const }),
    );
  }, [
    manualKeywordOverridesByGoodsKey,
    manualTitleOverridesByGoodsKey,
    uploadRows,
  ]);

  const confirmManualCandidates = useCallback(() => {
    if (!manualCandidatesReady || keywordBusy || manualApplyBusy) return;
    setManualPreviewStatus("checking");
    const previewResult = buildKeywordShoplingPayloadPreview(
      buildManualReviewedRows(),
      {
        expandProductGroupMarkets: true,
        manualTitleOverridesByGoodsKey,
        manualKeywordOverridesByGoodsKey,
        seedKeywordsByGoodsKey,
      },
    );
    const preflightResult = buildKeywordExecutionPreflight(
      { previewResult, finalConfirmationText: "" },
      {
        ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
        maxRows: 100,
        confirmationText: APPLY_CONFIRMATION_TEXT,
      },
    );
    setManualPreviewResult(previewResult);
    setManualPreflightResult(preflightResult);
    setManualPreviewStatus("");
  }, [
    buildManualReviewedRows,
    keywordBusy,
    manualApplyBusy,
    manualCandidatesReady,
    manualKeywordOverridesByGoodsKey,
    manualTitleOverridesByGoodsKey,
    seedKeywordsByGoodsKey,
  ]);

  const fetchManualApplyResult = useCallback(
    async (requestIdOverride?: string) => {
      const requestId = requestIdOverride || manualApplyRequestId;
      if (!requestId) return;
      setManualApplyErrorMessage("");
      try {
        const data = await (
          await fetch(
            `/api/keyword-shopling-apply/actions-result?request_id=${encodeURIComponent(requestId)}&mode=apply`,
          )
        ).json();
        setManualApplyResult(data);
        setManualApplyRunUrl(
          String(
            data.runUrl || data.githubActionsUrl || manualApplyRunUrl || "",
          ),
        );
        setManualApplyLastCheckedAt(new Date());
        if (isFinalManualApplyResult(data)) {
          setManualApplyPolling(false);
          setManualApplyNextCheckIn(0);
          const summary = summarizeManualApplyResult(data);
          setKeywordApplyState({
            dryRunStatus: "success",
            realApplyStatus: summary.overallSuccess
              ? "success"
              : summary.blockedCount > 0
                ? "blocked"
                : summary.failedCount > 0
                  ? "failed"
                  : "waiting_artifact",
            appliedCount: summary.appliedItemCount,
            failedCount: summary.failedCount,
            warningCount: summary.warningCount,
            requestId,
            dryRunRequestId: "",
            realApplyRequestId: requestId,
            blankMallTitleBlockedCount:
              summary.titleNotAppliedCount + summary.titleFailedCount,
            lastUpdatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        setManualApplyErrorMessage(
          error instanceof Error
            ? error.message
            : "실제 반영 결과를 가져오는 중 오류가 발생했습니다.",
        );
        setManualApplyPolling(false);
        setManualApplyNextCheckIn(0);
      }
    },
    [manualApplyRequestId, manualApplyRunUrl],
  );

  useEffect(() => {
    if (!manualApplyPolling) return;
    const timer = window.setInterval(
      () => setManualApplyNextCheckIn((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [manualApplyPolling]);

  useEffect(() => {
    if (!manualApplyPolling) return;
    if (
      manualApplyPollCount >= ACTIVE_MAX_POLLS ||
      isFinalManualApplyResult(manualApplyResult)
    )
      return;
    const timer = window.setTimeout(
      () => {
        setManualApplyPollCount((count) => {
          const next = count + 1;
          if (next >= ACTIVE_MAX_POLLS) {
            setManualApplyPolling(false);
            setManualApplyNextCheckIn(0);
          } else {
            setManualApplyNextCheckIn(ACTIVE_POLL_INTERVAL_MS / 1_000);
          }
          return next;
        });
        void fetchManualApplyResult();
      },
      manualApplyPollCount === 0 ? 0 : ACTIVE_POLL_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    fetchManualApplyResult,
    manualApplyPollCount,
    manualApplyPolling,
    manualApplyResult,
  ]);

  const applyManualCandidates = useCallback(async () => {
    if (!manualPreflightResult || manualApplyBusy) return;
    setManualApplyBusy(true);
    try {
      const response = await fetch("/api/keyword-shopling-apply/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution_plan_json: buildCompactKeywordApplyExecutionPlan(
            manualPreflightResult,
          ),
          mode: "apply",
          confirmation_text: APPLY_CONFIRMATION_TEXT,
          max_items: 100,
        }),
      });
      const json = await response.json();
      const requestId = String(json.requestId || "");
      setManualApplyRequestId(requestId);
      setManualApplyActionsUrl(
        String(json.githubActionsUrl || json.runUrl || ""),
      );
      setManualApplyRunUrl(String(json.runUrl || json.githubActionsUrl || ""));
      setManualApplyCommandPreview(String(json.commandPreview || ""));
      setManualApplyResult({
        status: json.status === "error" ? "error" : "pending",
        phase: json.phase || "queued",
        requestId,
        runUrl: json.runUrl || json.githubActionsUrl,
        githubActionsUrl: json.githubActionsUrl,
        message:
          json.status === "error"
            ? json.message
            : "실제 반영 요청 전송 완료\nGitHub Actions에서 쇼핑몰별 상품명/검색어 반영을 실행 중입니다.",
      });
      setKeywordApplyState({
        dryRunStatus: "success",
        realApplyStatus: json.status === "error" ? "failed" : "queued",
        appliedCount: 0,
        failedCount: 0,
        warningCount: manualPreflightResult.warnings.length,
        requestId,
        dryRunRequestId: "",
        realApplyRequestId: requestId,
        blankMallTitleBlockedCount: 0,
        lastUpdatedAt: new Date().toISOString(),
      });
      if (requestId && json.status !== "error") {
        setManualApplyPollCount(0);
        setManualApplyLastCheckedAt(null);
        setManualApplyNextCheckIn(0);
        setManualApplyPolling(true);
      }
    } finally {
      setManualApplyBusy(false);
    }
  }, [manualApplyBusy, manualPreflightResult]);

  void openInlineKeywordReview;

  const rowMatchesCurrentRun = rowExpression === lastStartedRowExpression;
  const currentUploadRequestId = rowMatchesCurrentRun ? uploadRequestId : "";
  const uploadGithubActionsUrl = currentUploadRequestId
    ? (uploadActionsResult?.runUrl ?? uploadRunResult?.githubActionsUrl)
    : undefined;
  const priceGithubActionsUrl =
    finalPriceRunResult?.githubActionsUrl ?? priceRunResult?.githubActionsUrl;
  const keywordGithubActionsUrl =
    keywordRunsResult?.runs?.[0]?.htmlUrl ??
    keywordDispatchResult?.actionsUrl ??
    keywordRunsResult?.actionsUrl;
  const uploadCounts = getUploadCounts(
    uploadActionsResult,
    uploadResultRows,
    uploadRows,
  );
  const priceCounts = getPriceCounts(
    finalPriceActionsResult ?? priceActionsResult,
    goodsKeys.length,
  );
  const keywordSummary = getKeywordSummary(keywordRunsResult, goodsKeys.length);
  const cockpit = buildCockpit({
    hasUploadRequest: !!uploadRequestId || !!uploadRunResult,
    uploadActive: uploadRunning || uploadFetching || uploadPolling,
    uploadSuccess: goodsKeys.length > 0,
    uploadFailed: hasUploadFailure(uploadActionsResult),
    priceActive: priceRunning || priceFetching || pricePolling,
    priceSuccess: isSuccessfulPriceResult(priceActionsResult),
    priceFailed: hasPriceFailure(priceActionsResult),
    keywordActive:
      keywordBusy === "dispatch" ||
      keywordBusy === "runs" ||
      keywordPolling ||
      isKeywordRunning(keywordRunsResult),
    keywordSuccess: !!keywordSummary.artifact,
    keywordFailed: hasKeywordFailure(keywordRunsResult),
  });
  const boardMallCount = expectedPriceModifyUpdateCount(
    goodsKeyProductGroupMap,
  );
  const titleTargetCount = expectedLaunchApplyCount(
    goodsKeys,
    buildGoodsKeyGroupMap(uploadRows),
  );
  const keywordRealApplySucceeded =
    isKeywordRealApplySuccess(keywordApplyState);
  const manualApplyReadyForFinalPrice =
    keywordRealApplySucceeded ||
    isManualApplyReadyForFinalPrice(manualApplyResult);
  const finalPriceDone =
    isSuccessfulPriceResult(finalPriceActionsResult) &&
    getPriceCounts(finalPriceActionsResult, goodsKeys.length).failCount === 0;
  const finalPriceFailed =
    hasPriceFailure(finalPriceActionsResult) ||
    getPriceCounts(finalPriceActionsResult, goodsKeys.length).failCount > 0;
  const finalPriceActive =
    finalPriceRunning || finalPriceFetching || finalPricePolling;
  const actualApplyDone =
    (isSuccessfulPriceResult(priceActionsResult) || finalPriceDone) &&
    keywordRealApplySucceeded &&
    finalPriceDone;
  const priceIssueState = getPriceIssueState(
    finalPriceActionsResult ?? priceActionsResult,
  );
  const keywordWarningCount = getKeywordWarningCount(keywordApplyState);
  const issueCount = getLaunchBoardIssueCount({
    priceIssueState,
    uploadRows,
    goodsKeys,
    titleTargetCount,
    keywordApplyState,
    cockpit,
  });
  const derivedStage = deriveLaunchStage({
    uploadActionsResult,
    uploadRowsCount: uploadRows.length,
    priceActionsResult,
    keywordRunsResult,
    keywordApplyState,
    finalPriceActionsResult,
    manualCandidatesReady,
  });
  const currentRequestId = getRequestIdForStage(derivedStage, {
    uploadRequestId: currentUploadRequestId || uploadRequestId,
    priceRequestId,
    keywordRequestId:
      keywordDispatchResult?.expectedArtifactName ??
      String(
        keywordRunsResult?.runs?.[0]?.id ??
          restoredSession?.keywordRequestId ??
          restoredSession?.keywordRunId ??
          "",
      ),
    keywordDryRunRequestId:
      keywordApplyState?.dryRunRequestId ??
      restoredSession?.keywordDryRunRequestId ??
      "",
    keywordRealApplyRequestId:
      keywordApplyState?.realApplyRequestId ??
      restoredSession?.keywordRealApplyRequestId ??
      "",
    finalPriceRequestId,
  });
  const previousRequestId =
    finalPriceRequestId ||
    keywordApplyState?.realApplyRequestId ||
    keywordApplyState?.dryRunRequestId ||
    priceRequestId ||
    uploadRequestId ||
    keywordDispatchResult?.expectedArtifactName ||
    "-";
  const failureActionsDisabled =
    uploadRunning ||
    uploadFetching ||
    uploadPolling ||
    priceRunning ||
    priceFetching ||
    pricePolling ||
    finalPriceRunning ||
    finalPriceFetching ||
    finalPricePolling ||
    !!keywordBusy ||
    keywordPolling;
  const lastCheckedAt =
    finalPriceLastCheckedAt ??
    keywordLastCheckedAt ??
    priceLastCheckedAt ??
    uploadLastCheckedAt;

  useEffect(() => {
    const hasPersistableProductLaunchState =
      !!rowExpression.trim() ||
      !!uploadRequestId ||
      !!priceRequestId ||
      !!finalPriceRequestId ||
      !!uploadActionsResult ||
      !!priceActionsResult ||
      !!keywordRunsResult ||
      !!finalPriceActionsResult ||
      Object.keys(seedKeywordsBySourceRow).length > 0;
    if (!hasPersistableProductLaunchState) {
      clearProductLaunchSession();
      return;
    }
    const nextSession: ProductLaunchSessionV2 = {
      rowExpression,
      startedAt: restoredSession?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uploadRequestId,
      priceRequestId,
      keywordRequestId:
        keywordDispatchResult?.expectedArtifactName ??
        restoredSession?.keywordRequestId ??
        "",
      keywordRunId: String(
        keywordRunsResult?.runs?.[0]?.id ?? restoredSession?.keywordRunId ?? "",
      ),
      keywordDryRunRequestId:
        keywordApplyState?.dryRunRequestId ??
        restoredSession?.keywordDryRunRequestId ??
        "",
      keywordRealApplyRequestId:
        keywordApplyState?.realApplyRequestId ??
        restoredSession?.keywordRealApplyRequestId ??
        "",
      finalPriceRequestId,
      uploadResult: uploadActionsResult,
      priceResult: priceActionsResult,
      keywordResult: keywordRunsResult,
      finalPriceResult: finalPriceActionsResult,
      seedKeywordsBySourceRow,
      stage: derivedStage,
    };
    persistProductLaunchSession(nextSession);
  }, [
    derivedStage,
    finalPriceActionsResult,
    finalPriceRequestId,
    keywordApplyState?.dryRunRequestId,
    keywordApplyState?.realApplyRequestId,
    keywordDispatchResult?.expectedArtifactName,
    keywordRunsResult,
    priceActionsResult,
    priceRequestId,
    restoredSession,
    rowExpression,
    seedKeywordsBySourceRow,
    uploadActionsResult,
    uploadRequestId,
  ]);

  useEffect(() => {
    if (!restoredSession) return;
    const timer = window.setTimeout(() => {
      if (
        restoredSession.uploadRequestId &&
        !isSuccessfulUploadResult(
          restoredSession.uploadResult ?? null,
          extractRowsWithGoodsKey(restoredSession.uploadResult ?? null).length,
        )
      ) {
        setUploadPolling(true);
        void pollUploadResult(true, restoredSession.uploadRequestId);
      }
      if (restoredSession.priceRequestId && !restoredSession.priceResult) {
        setPricePolling(true);
        void fetchPriceResult();
      }
      if (
        (restoredSession.keywordRequestId || restoredSession.keywordRunId) &&
        !restoredSession.keywordResult
      ) {
        setKeywordPolling(true);
        void fetchKeywordRuns();
      }
      if (
        restoredSession.finalPriceRequestId &&
        !restoredSession.finalPriceResult
      ) {
        setFinalPricePolling(true);
        void fetchFinalPriceResult();
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // run once on mount; persisted request IDs are intentionally recovered after a Vercel-style remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearProductLaunchFailureState = (options: {
    keepRowExpression: boolean;
  }) => {
    const preservedRowExpression = rowExpression;
    clearProductLaunchSession();
    setSessionRestored(false);
    setUploadRecovered(false);
    setRowExpression(options.keepRowExpression ? preservedRowExpression : "");
    setLastStartedRowExpression(
      options.keepRowExpression ? preservedRowExpression : "",
    );
    setUploadRequestId("");
    setPriceRequestId("");
    setFinalPriceRequestId("");
    setUploadRunResult(null);
    setUploadActionsResult(null);
    setPriceRunResult(null);
    setPriceActionsResult(null);
    setKeywordPreview(null);
    setKeywordDispatchResult(null);
    setKeywordRunsResult(null);
    setKeywordImportMessage("");
    setKeywordBusy("");
    setKeywordPolling(false);
    setKeywordPollCount(0);
    setKeywordLastCheckedAt(null);
    setKeywordApplyState(null);
    setFinalPriceRunResult(null);
    setFinalPriceActionsResult(null);
    setUploadRunning(false);
    setUploadFetching(false);
    setUploadPolling(false);
    setUploadPollCount(0);
    setUploadNextCheckIn(0);
    setUploadElapsedSeconds(0);
    setUploadLastCheckedAt(null);
    setPriceRunning(false);
    setPriceFetching(false);
    setPricePolling(false);
    setPricePollCount(0);
    setPriceLastCheckedAt(null);
    setFinalPriceRunning(false);
    setFinalPriceFetching(false);
    setFinalPricePolling(false);
    setFinalPricePollCount(0);
    setFinalPriceLastCheckedAt(null);
    setSeedKeywordsBySourceRow({});
    setManualTitleOverridesByGoodsKey({});
    setManualKeywordOverridesByGoodsKey({});
    autoPriceStartedForUploadRequestRef.current = "";
    autoKeywordStartedForPriceRequestRef.current = "";
    autoKeywordImportedArtifactRef.current = "";
    finalPriceStartedForRealApplyRequestRef.current = "";
  };
  const resetProductLaunchSession = () =>
    clearProductLaunchFailureState({ keepRowExpression: false });
  const retryProductLaunchSession = () =>
    clearProductLaunchFailureState({ keepRowExpression: true });
  useEffect(() => {
    const artifact = keywordSummary.artifact;
    const run = keywordRunsResult?.runs?.find((item) =>
      item.artifacts?.some((candidate) => candidate.id === artifact?.id),
    );
    const importKey =
      artifact && run ? `${run.id}:${artifact.name}:${artifact.id}` : "";
    if (!autopilotEnabled || !artifact || !run || !importKey) return;
    if (autoKeywordImportedArtifactRef.current === importKey) return;
    autoKeywordImportedArtifactRef.current = importKey;
    void importKeywordArtifact(run, artifact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotEnabled, keywordRunsResult, keywordSummary.artifact]);

  const handleProductLaunchPrimaryAction = () => {
    if (cockpit.primaryAction === "upload") void runUploadRequest();
    else if (cockpit.primaryAction === "price") void runPriceModify();
    else if (cockpit.primaryAction === "wait") return;
    else if (cockpit.primaryAction === "failed") return;
    else if (
      manualPreflightResult &&
      manualPreflightResult.summary.eligibleCount > 0 &&
      manualPreflightResult.summary.blockedCount === 0
    )
      void applyManualCandidates();
    else confirmManualCandidates();
  };

  useEffect(() => {
    if (!autopilotEnabled) return;
    if (
      !isSuccessfulUploadResult(uploadActionsResult, uploadRows.length) ||
      goodsKeys.length === 0 ||
      !currentUploadRequestId
    )
      return;
    if (
      priceRunning ||
      priceFetching ||
      pricePolling ||
      priceRunResult ||
      priceActionsResult
    )
      return;
    if (autoPriceStartedForUploadRequestRef.current === currentUploadRequestId)
      return;
    autoPriceStartedForUploadRequestRef.current = currentUploadRequestId;
    const timer = window.setTimeout(() => {
      void runPriceModify();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    autopilotEnabled,
    currentUploadRequestId,
    goodsKeys.length,
    priceActionsResult,
    priceFetching,
    pricePolling,
    priceRunResult,
    priceRunning,
    runPriceModify,
    uploadActionsResult,
    uploadRows.length,
  ]);

  useEffect(() => {
    if (!autopilotEnabled) return;
    if (
      !priceRequestId ||
      !isAutopilotSafePriceResult(priceActionsResult) ||
      goodsKeys.length === 0
    )
      return;
    if (
      keywordBusy ||
      keywordPolling ||
      keywordDispatchResult ||
      keywordSummary.artifact
    )
      return;
    if (autoKeywordStartedForPriceRequestRef.current === priceRequestId) return;
    autoKeywordStartedForPriceRequestRef.current = priceRequestId;
    const timer = window.setTimeout(() => {
      void dispatchKeywordEngine();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    autopilotEnabled,
    dispatchKeywordEngine,
    goodsKeys.length,
    keywordBusy,
    keywordDispatchResult,
    keywordPolling,
    keywordSummary.artifact,
    priceActionsResult,
    priceRequestId,
  ]);

  useEffect(() => {
    const realApplyRequestId = keywordApplyState?.realApplyRequestId ?? "";
    if (!autopilotEnabled) return;
    if (
      !manualApplyReadyForFinalPrice ||
      goodsKeys.length === 0 ||
      !realApplyRequestId
    )
      return;
    if (finalPriceActive || finalPriceRunResult || finalPriceActionsResult)
      return;
    if (finalPriceStartedForRealApplyRequestRef.current === realApplyRequestId)
      return;
    finalPriceStartedForRealApplyRequestRef.current = realApplyRequestId;
    const timer = window.setTimeout(() => {
      void runFinalPriceModify();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    autopilotEnabled,
    finalPriceActionsResult,
    finalPriceActive,
    finalPriceRunResult,
    goodsKeys.length,
    keywordApplyState?.realApplyRequestId,
    manualApplyReadyForFinalPrice,
    runFinalPriceModify,
  ]);

  return (
    <div className="space-y-6">
      {sessionRestored ? (
        <RecoveryBanner
          uploadRecovered={
            uploadRecovered ||
            isSuccessfulUploadResult(uploadActionsResult, uploadRows.length)
          }
        />
      ) : null}
      <OperatorLaunchStatusBoard
        state={cockpit}
        productCount={goodsKeys.length}
        mallCount={boardMallCount}
        titleTargetCount={titleTargetCount}
        keywordWarningCount={keywordWarningCount}
        issueCount={issueCount}
        actualApplyDone={actualApplyDone}
        keywordApplyState={keywordApplyState}
        priceIssueState={priceIssueState}
        manualCandidatesReady={manualCandidatesReady}
        onNext={
          manualApplyReadyForFinalPrice && !finalPriceDone
            ? runFinalPriceModify
            : handleProductLaunchPrimaryAction
        }
        initialPriceRequestId={priceRequestId}
        finalPriceRequestId={finalPriceRequestId}
        finalPriceActionsResult={finalPriceActionsResult}
        finalPriceActive={finalPriceActive}
        finalPriceDone={finalPriceDone}
        finalPriceFailed={finalPriceFailed}
        finalPriceTargetCount={goodsKeys.length * FULL_PRICE_POLICY_MALL_COUNT}
      />
      <ManualOverrideSection
        goodsKeys={goodsKeys}
        uploadRows={uploadRows}
        manualTitleOverridesByGoodsKey={manualTitleOverridesByGoodsKey}
        manualKeywordOverridesByGoodsKey={manualKeywordOverridesByGoodsKey}
        onManualTitleChange={(goodsKey, value) =>
          setManualTitleOverridesByGoodsKey((current) => ({
            ...current,
            [goodsKey]: value,
          }))
        }
        onManualKeywordChange={(goodsKey, value) =>
          setManualKeywordOverridesByGoodsKey((current) => ({
            ...current,
            [goodsKey]: value,
          }))
        }
      />
      <RepresentativePreviewCard
        uploadRows={uploadRows}
        goodsKeys={goodsKeys}
        manualTitleOverridesByGoodsKey={manualTitleOverridesByGoodsKey}
        manualKeywordOverridesByGoodsKey={manualKeywordOverridesByGoodsKey}
      />
      <ManualPreviewReviewSection
        manualMallPreviewRows={manualMallPreviewRows}
        manualPreflightResult={manualPreflightResult}
      />
      <ManualApplyStatusCard
        requestId={manualApplyRequestId}
        actionsUrl={manualApplyActionsUrl}
        runUrl={manualApplyRunUrl}
        commandPreview={manualApplyCommandPreview}
        result={manualApplyResult}
        polling={manualApplyPolling}
        pollCount={manualApplyPollCount}
        lastCheckedAt={manualApplyLastCheckedAt}
        nextCheckIn={manualApplyNextCheckIn}
        errorMessage={manualApplyErrorMessage}
      />
      <LaunchCockpit
        steps={cockpit.steps}
        currentStage={derivedStage}
        nextAction={cockpit.nextAction}
        primaryAction={cockpit.primaryAction}
        onNext={handleProductLaunchPrimaryAction}
        rowExpression={rowExpression}
        onRowExpressionChange={setRowExpression}
        uploadBusy={uploadRunning || uploadFetching || uploadPolling}
        priceBusy={
          priceRunning || priceFetching || pricePolling || finalPriceActive
        }
        keywordBusy={
          keywordBusy === "dispatch" ||
          keywordBusy === "runs" ||
          keywordPolling ||
          isKeywordRunning(keywordRunsResult)
        }
        autoPilotEnabled={autopilotEnabled}
        onAutoPilotChange={setAutopilotEnabled}
        currentRequestId={currentRequestId}
        previousRequestId={previousRequestId}
        lastCheckedAt={lastCheckedAt}
        autoPollStatus={`업로드 ${uploadPollCount}회 · 가격 ${pricePollCount}회 · 키워드 ${keywordPollCount}회 · 최종가격 ${finalPricePollCount}회`}
        actionsUrl={
          keywordGithubActionsUrl ??
          priceGithubActionsUrl ??
          uploadGithubActionsUrl
        }
        counts={{
          upload: uploadCounts,
          price: priceCounts,
          keyword: keywordSummary,
        }}
        uploadProgress={{
          phase: getUploadPhaseLabel(
            uploadActionsResult,
            uploadRunning,
            uploadFetching,
            uploadPolling,
          ),
          elapsedSeconds: uploadElapsedSeconds,
          pollCount: uploadPollCount,
          lastCheckedAt: uploadLastCheckedAt,
          nextCheckIn: uploadNextCheckIn,
          requestId: currentUploadRequestId,
          actionsUrl: uploadGithubActionsUrl,
          active: uploadRunning || uploadFetching || uploadPolling,
          onCheckNow: fetchUploadResult,
          checking: uploadFetching,
        }}
        autoActualApplyEnabled={autoActualApplyEnabled}
        onAutoActualApplyEnabledChange={setAutoActualApplyEnabled}
        manualCandidatesReady={manualCandidatesReady}
        manualPreviewStatus={manualPreviewStatus}
        manualPreflightResult={manualPreflightResult}
        manualBusy={manualApplyBusy}
        goodsKeysEmpty={goodsKeys.length === 0}
      />
      {cockpit.primaryAction === "failed" ? (
        <ErrorDrawer
          title="실패 원인"
          uploadResult={uploadActionsResult}
          priceResult={priceActionsResult}
          keywordResult={keywordRunsResult}
          requestId={previousRequestId}
          actionsUrl={
            keywordGithubActionsUrl ??
            priceGithubActionsUrl ??
            uploadGithubActionsUrl
          }
          onReset={resetProductLaunchSession}
          onRetry={retryProductLaunchSession}
          onFetchPriceResult={fetchPriceResult}
          actionsDisabled={failureActionsDisabled}
        />
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-slate-950">
          개발자 진단 보기
        </summary>

        <form
          onSubmit={runUpload}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-bold text-slate-950">
            Step 1. 상품업로드
          </h2>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            실재고 시트 행 번호
            <input
              value={rowExpression}
              onChange={(event) => setRowExpression(event.target.value)}
              placeholder="예: 950 또는 950-952 또는 950,951"
              required
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={skipIfGoodsKey}
              onChange={(event) => setSkipIfGoodsKey(event.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            이미 goods_key 있으면 스킵(권장)
          </label>
          <div className="mt-1 space-y-1 text-xs text-slate-600">
            <p>체크하면 이미 업로드된 상품은 건너뜁니다.</p>
            <p>
              체크 해제는 기존 상품 수정이 아니라 새 상품 등록을 다시
              시도합니다. 같은 자사상품코드가 이미 있으면 중복 오류가 발생할 수
              있습니다.
            </p>
          </div>
          {!skipIfGoodsKey ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              주의: 체크 해제 상태에서는 같은 행을 다시 업로드할 때 자사상품코드
              중복으로 실패할 수 있습니다. 기존 상품 수정이 목적이라면 업로드가
              아니라 수정/가격/상품명 반영 플로우를 사용하세요.
            </p>
          ) : null}
          <p className="mt-3 text-sm text-slate-600">
            채널 선택 없이 도매1~도매4, 소매1~소매2 전체 6채널로 실행합니다.
          </p>
          <button
            type="submit"
            disabled={uploadRunning || !rowExpression.trim()}
            className="mt-5 rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 disabled:bg-slate-100"
          >
            {uploadRunning
              ? "실행 요청 중..."
              : "고급 옵션으로 상품업로드 시작"}
          </button>
          {!uploadRequestId && rowExpression ? (
            <button
              type="button"
              onClick={recoverLatestUploadResult}
              disabled={uploadFetching || uploadPolling}
              className="ml-3 mt-5 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:bg-slate-100"
            >
              최근 상품업로드 결과 복구
            </button>
          ) : null}
          <button
            type="button"
            onClick={fetchUploadResult}
            disabled={uploadFetching || uploadPolling}
            className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
          >
            {uploadFetching || uploadPolling
              ? "확인 중..."
              : "상품업로드 결과 가져오기"}
          </button>
          <GithubActionsShortcutButton
            href={uploadGithubActionsUrl}
            className="ml-3 mt-5"
          />
          <StatusBlock result={uploadRunResult} requestId={uploadRequestId} />
          <UploadPollingStatusCard
            result={uploadActionsResult}
            requestId={uploadRequestId}
            rowsWithGoodsKeyCount={uploadRows.length}
            polling={uploadPolling}
            fetching={uploadFetching}
            elapsedSeconds={uploadElapsedSeconds}
            lastCheckedAt={uploadLastCheckedAt}
            pollCount={uploadPollCount}
            maxPolls={UPLOAD_MAX_POLLS}
            nextCheckIn={uploadNextCheckIn}
          />
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">
              문제만 보기
            </button>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              전체 보기
            </button>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              성공 항목 숨기기
            </button>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              성공 항목 펼치기
            </button>
          </div>
          <h2 className="text-lg font-bold text-slate-950">상품업로드 결과</h2>
          <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-medium text-blue-800">
            상품그룹은 ptn_goods_cd 끝 글자 기준의 Commerce OS 내부
            인식값입니다. 상품그룹 정의표에 suffix 한 줄을 추가하면 새 그룹을
            확장할 수 있습니다. 샵플링 상품그룹 API를 수정하지 않습니다.
          </p>
          {uploadActionsResult?.message ? (
            <p className="mt-3 text-sm text-slate-600">
              {uploadActionsResult.message}
            </p>
          ) : null}
          <UploadRowsTable rows={uploadResultRows} />
        </section>

        {goodsKeys.length === 0 && uploadActionsResult?.status === "success" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            goods_key가 생성된 상품이 없어 가격설정을 진행할 수 없습니다.
          </p>
        ) : null}
        {goodsKeys.length > 0 ? (
          <PriceSection
            goodsKeyCount={goodsKeys.length}
            result={priceRunResult}
            actionsResult={priceActionsResult}
            requestId={priceRequestId}
            running={priceRunning}
            fetching={priceFetching}
            onRun={runPriceModify}
            onFetch={fetchPriceResult}
            onClearFailure={retryProductLaunchSession}
          />
        ) : null}
        {manualApplyReadyForFinalPrice ? (
          <PriceSection
            title="가격 최종 재적용"
            goodsKeyCount={goodsKeys.length}
            result={finalPriceRunResult}
            actionsResult={finalPriceActionsResult}
            requestId={finalPriceRequestId}
            running={finalPriceRunning}
            fetching={finalPriceFetching}
            onRun={runFinalPriceModify}
            onFetch={fetchFinalPriceResult}
            finalPass
          />
        ) : null}
        {goodsKeys.length > 0 ? (
          <KeywordPrepSection
            rows={uploadRows}
            goodsKeys={goodsKeys}
            seedKeyword={keywordSeed}
            onSeedKeywordChange={setKeywordSeed}
            preview={keywordPreview}
            dispatchResult={keywordDispatchResult}
            runsResult={keywordRunsResult}
            importMessage={keywordImportMessage}
            busy={keywordBusy}
            onPreview={previewKeywordDispatch}
            onDispatch={dispatchKeywordEngine}
            onFetchRuns={fetchKeywordRuns}
            onImport={importKeywordArtifact}
          />
        ) : null}
        <FinalChecklist />
      </details>
    </div>
  );
}

export function hasManualCandidatesForAllSourceRows(
  sourceRowGroups: ReturnType<typeof buildLaunchSourceRowGroups>,
  manualTitleCandidatesBySourceRow: Record<string, string>,
  manualSearchCandidatesBySourceRow: Record<string, string>,
) {
  if (sourceRowGroups.length === 0) return false;
  return sourceRowGroups.every((group) => {
    const sourceRowTitle = String(
      manualTitleCandidatesBySourceRow[group.sourceRowId] ?? "",
    ).trim();
    const sourceRowSearch = String(
      manualSearchCandidatesBySourceRow[group.sourceRowId] ?? "",
    ).trim();
    if (sourceRowTitle || sourceRowSearch) return true;
    return group.goodsKeys.some(
      (goodsKey) =>
        String(manualTitleCandidatesBySourceRow[goodsKey] ?? "").trim() ||
        String(manualSearchCandidatesBySourceRow[goodsKey] ?? "").trim(),
    );
  });
}

function RecoveryBanner({ uploadRecovered }: { uploadRecovered: boolean }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900">
      <p>이전 상품출시 작업을 복구했습니다.</p>
      <p>완료된 GitHub Actions 결과를 다시 확인하는 중입니다.</p>
      {uploadRecovered ? (
        <p className="mt-2">
          상품업로드 결과를 복구했습니다. 생성된 goods_key 기준으로 다음 단계를
          이어갑니다.
        </p>
      ) : (
        <p className="mt-2">상품업로드 결과 확인 중</p>
      )}
    </section>
  );
}

function ManualOverrideSection({
  goodsKeys,
  uploadRows,
  manualTitleOverridesByGoodsKey,
  manualKeywordOverridesByGoodsKey,
  onManualTitleChange,
  onManualKeywordChange,
}: {
  goodsKeys: string[];
  uploadRows: ProductLaunchUploadRow[];
  manualTitleOverridesByGoodsKey: Record<string, string>;
  manualKeywordOverridesByGoodsKey: Record<string, string>;
  onManualTitleChange: (goodsKey: string, value: string) => void;
  onManualKeywordChange: (goodsKey: string, value: string) => void;
}) {
  const uploadRowsByGoodsKey = new Map(
    uploadRows.map((row) => [(row.goods_key ?? "").trim(), row]),
  );
  const rows =
    goodsKeys.length > 0
      ? goodsKeys
      : uploadRows.map((row) => (row.goods_key ?? "").trim()).filter(Boolean);
  return (
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-bold text-blue-700">
        행별 상품명/검색어 후보 입력
      </p>
      <h2 className="mt-1 text-xl font-black text-slate-950">
        행별 상품명/검색어 후보 입력
      </h2>
      <p className="mt-2 text-sm font-semibold text-slate-700">
        행별 또는 상품별 상품명과 검색어 후보를 입력하세요. 상품그룹별 쇼핑몰은
        등록 정책표에서 자동 선택됩니다.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          상품업로드 후 행별 상품명/검색어 후보 입력칸이 표시됩니다.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-700">
                <th className="border border-slate-200 px-3 py-2">goods_key</th>
                <th className="border border-slate-200 px-3 py-2">상품그룹</th>
                <th className="border border-slate-200 px-3 py-2">
                  현재 상품명
                </th>
                <th className="border border-slate-200 px-3 py-2">
                  상품명 후보 입력
                </th>
                <th className="border border-slate-200 px-3 py-2">
                  검색어 후보 입력
                </th>
                <th className="border border-slate-200 px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((goodsKey) => {
                const uploadRow = uploadRowsByGoodsKey.get(goodsKey);
                const productGroup = inferProductGroupFromPtnGoodsCd(
                  uploadRow?.ptn_goods_cd ?? "",
                ).productGroup;
                const engineTitle =
                  [
                    uploadRow?.final_title,
                    uploadRow?.registered_title,
                    uploadRow?.upload_title,
                    uploadRow?.product_name,
                    uploadRow?.title,
                    uploadRow?.productTitle,
                  ].find((value) => String(value ?? "").trim()) ??
                  "상품명 대기";
                const manualTitle =
                  manualTitleOverridesByGoodsKey[goodsKey] ?? "";
                const manualKeyword =
                  manualKeywordOverridesByGoodsKey[goodsKey] ?? "";
                const status = resolveManualTitleOverride(manualTitle, goodsKey)
                  ? "수동"
                  : String(engineTitle).trim() && engineTitle !== "상품명 대기"
                    ? "엔진"
                    : "보강 필요";
                return (
                  <tr key={goodsKey} className="bg-white">
                    <td className="border border-slate-200 px-3 py-2 font-mono">
                      {goodsKey}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 font-semibold">
                      {productGroup}
                    </td>
                    <td className="border border-slate-200 px-3 py-2">
                      {engineTitle}
                    </td>
                    <td className="border border-slate-200 px-3 py-2">
                      <input
                        value={manualTitle}
                        onChange={(event) =>
                          onManualTitleChange(goodsKey, event.target.value)
                        }
                        placeholder="상품명 후보"
                        className="w-64 rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </td>
                    <td className="border border-slate-200 px-3 py-2">
                      <input
                        value={manualKeyword}
                        onChange={(event) =>
                          onManualKeywordChange(goodsKey, event.target.value)
                        }
                        placeholder="게임패드,컨트롤러,조이스틱"
                        className="w-64 rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </td>
                    <td className="border border-slate-200 px-3 py-2 font-bold">
                      {status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RepresentativePreviewCard({
  uploadRows,
  goodsKeys,
  manualTitleOverridesByGoodsKey,
  manualKeywordOverridesByGoodsKey,
}: {
  uploadRows: ProductLaunchUploadRow[];
  goodsKeys: string[];
  manualTitleOverridesByGoodsKey: Record<string, string>;
  manualKeywordOverridesByGoodsKey: Record<string, string>;
}) {
  const firstGoodsKey = goodsKeys[0] ?? "";
  const uploadRowsByGoodsKey = new Map(
    uploadRows.map((row) => [(row.goods_key ?? "").trim(), row]),
  );
  const row = uploadRowsByGoodsKey.get(firstGoodsKey) ?? uploadRows[0];
  const productGroup = inferProductGroupFromPtnGoodsCd(
    row?.ptn_goods_cd ?? "",
  ).productGroup;
  const markets = getMarketsForProductGroup(productGroup);
  const parsedTitleCandidates = parseManualCandidateList(
    manualTitleOverridesByGoodsKey[firstGoodsKey] ?? "",
  );
  const titleCandidate =
    parsedTitleCandidates.join(" ") ||
    resolveManualTitleOverride(
      manualTitleOverridesByGoodsKey[firstGoodsKey] ?? "",
      firstGoodsKey,
    ) ||
    String(
      row?.final_title ??
        row?.registered_title ??
        row?.upload_title ??
        row?.product_name ??
        row?.title ??
        "상품명 후보 대기",
    );
  const searchCandidate =
    normalizeManualKeywordOverride(
      manualKeywordOverridesByGoodsKey[firstGoodsKey] ?? "",
    ) ||
    normalizeManualKeywordOverride(parsedTitleCandidates.join(",")) ||
    "검색어 후보 대기";
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-bold text-indigo-700">대표 미리보기</p>
      <h2 className="mt-1 text-xl font-black text-slate-950">대표 미리보기</h2>
      {!row ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          상품업로드 후 대표 상품명/검색어 미리보기가 표시됩니다.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <ResultRow label="대표 goods_key" value={firstGoodsKey || "-"} mono />
          <ResultRow label="상품그룹" value={productGroup || "-"} />
          <ResultRow
            label="자동 선택 쇼핑몰 수"
            value={`${markets.length}개`}
          />
          <ResultRow label="상품명 후보" value={titleCandidate} />
          <ResultRow label="검색어 후보" value={searchCandidate} />
          <ResultRow
            label="쇼핑몰 정책"
            value={
              markets
                .map((market) => `${market.marketName}(${market.mallKey})`)
                .join(", ") || "상품그룹 매칭 대기"
            }
          />
        </div>
      )}
    </section>
  );
}

function ManualPreviewReviewSection({
  manualMallPreviewRows,
  manualPreflightResult,
}: {
  manualMallPreviewRows: ReturnType<typeof buildManualMallPreviewRows>;
  manualPreflightResult: KeywordExecutionPreflightResult | null;
}) {
  const { status, rows, summary } = manualMallPreviewRows;
  const preflightSummary = manualPreflightResult?.summary;
  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
      <p className="text-sm font-bold text-emerald-800">
        전체 쇼핑몰 적용 미리보기
      </p>
      {status === "not_generated" ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-black text-slate-950">
            검토 계획 생성 전
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            상품명과 검색어를 입력한 뒤 검토 계획을 생성하세요.
          </p>
        </div>
      ) : (
        <>
          {status === "preview_only" ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-black text-amber-900">
              미리보기 생성됨 · 사전점검 전
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="전체" value={summary.totalCount} />
            <SummaryCard label="반영 가능" value={summary.eligibleCount} />
            <SummaryCard label="차단" value={summary.blockedCount} />
            <SummaryCard label="반영 완료" value={summary.appliedCount} />
            <SummaryCard label="실패" value={summary.failedCount} />
          </div>
          {preflightSummary ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
              <SummaryCard label="예상 상품명 대상" value={preflightSummary.expectedTitleTargetCount} />
              <SummaryCard label="생성 상품명 대상" value={preflightSummary.generatedTitleTargetCount} />
              <SummaryCard label="검색어 goods_key" value={preflightSummary.siteSrchGoodsKeyCount} />
              <SummaryCard label="커버리지 불일치" value={preflightSummary.coverageMismatchGoodsKeyCount} />
              <SummaryCard label="미등록 상품그룹" value={preflightSummary.unregisteredProductGroupGoodsKeyCount} />
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-emerald-200 bg-white">
            <table className="min-w-[1500px] text-left text-xs">
              <thead className="bg-emerald-100 text-emerald-950">
                <tr>
                  {[
                    "goods_key",
                    "상품그룹",
                    "쇼핑몰",
                    "mall_key",
                    "생성 상품명",
                    "검색어",
                    "상품명 키워드 수",
                    "포함 키워드 수",
                    "무결성",
                    "미리보기 상태",
                    "사전점검 상태",
                    "반영 상태",
                    "차단 사유",
                    "경고",
                  ].map((header) => (
                    <th key={header} className="border border-emerald-200 px-3 py-2">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.goodsKey}:${row.mallKey}:${row.sourceRowIndex}:${index}`}
                    className={manualMallPreviewRowClassName(row)}
                  >
                    <td className="border border-slate-200 px-3 py-2 font-mono">{row.goodsKey}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.productGroup}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.marketName}</td>
                    <td className="border border-slate-200 px-3 py-2 font-mono">{row.mallKey}</td>
                    <td className="border border-slate-200 px-3 py-2 font-semibold">{row.finalTitle}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.finalSiteSrch}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.titleKeywordCount}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.titleIncludedKeywordCount}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.titleKeywordIntegrityOk ? "정상" : "확인 필요"}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.previewStatus}</td>
                    <td className="border border-slate-200 px-3 py-2">{manualPreflightStatusLabel(row.preflightStatus)}</td>
                    <td className="border border-slate-200 px-3 py-2">{manualApplyStatusLabel(row.applyStatus)}</td>
                    <td className="border border-slate-200 px-3 py-2">{formatKeywordExecutionPreflightLabels(row.blockingReasons) || "-"}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.validationWarnings.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function manualPreflightStatusLabel(status: string) {
  return status === "eligible" ? "반영 가능" : status === "blocked" ? "차단" : "사전점검 전";
}

function manualApplyStatusLabel(status: string) {
  const labels: Record<string, string> = {
    preflight_pending: "사전점검 전",
    ready: "반영 준비",
    applied: "반영 완료",
    verified: "검증 완료",
    failed: "실패",
    blocked: "차단",
    not_started: "실행 전",
  };
  return labels[status] ?? status;
}

function manualMallPreviewRowClassName(row: ReturnType<typeof buildManualMallPreviewRows>["rows"][number]) {
  if (row.applyStatus === "failed" || row.applyStatus === "blocked" || row.preflightStatus === "blocked") return "bg-red-50 text-red-950";
  if (row.applyStatus === "verified" || row.applyStatus === "applied") return "bg-emerald-50 text-emerald-950";
  if (row.applyStatus === "preflight_pending" || row.preflightStatus === "pending") return "bg-slate-50 text-slate-600";
  return "bg-white text-slate-900";
}

function ManualApplyStatusCard({
  requestId,
  actionsUrl,
  runUrl,
  commandPreview,
  result,
  polling,
  pollCount,
  lastCheckedAt,
  nextCheckIn,
  errorMessage,
}: {
  requestId: string;
  actionsUrl: string;
  runUrl: string;
  commandPreview: string;
  result: ManualApplyActionsResult | null;
  polling: boolean;
  pollCount: number;
  lastCheckedAt: Date | null;
  nextCheckIn: number;
  errorMessage: string;
}) {
  if (!requestId && !result && !commandPreview) return null;
  const summary = summarizeManualApplyResult(result);
  const titleWarning =
    summary.titleNotAppliedCount + summary.titleFailedCount > 0;
  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-indigo-800">
            실제 반영 진행상태
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            {result?.message || "실제 반영 요청 전송 완료"}
          </h2>
          <p className="mt-2 text-sm font-semibold text-indigo-900">
            GitHub Actions에서 쇼핑몰별 상품명/검색어 반영을 실행 중입니다.
          </p>
        </div>
        <GithubActionsShortcutButton href={runUrl || actionsUrl} />
      </div>
      {errorMessage ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
          {errorMessage}
        </p>
      ) : null}
      {titleWarning ? (
        <p className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-black text-red-800">
          검색어는 반영되었지만 쇼핑몰별 상품명이 반영되지 않았습니다. GitHub
          Actions 결과의 title_update_status / mall_title_apply_status /
          message를 확인해야 합니다.
        </p>
      ) : null}
      <div className="mt-4 grid gap-2 text-sm text-indigo-950 md:grid-cols-2 lg:grid-cols-4">
        <ResultRow
          label="현재 상태"
          value={`${result?.phase ?? "queued"} / ${result?.status ?? (polling ? "pending" : "queued")}`}
        />
        <ResultRow
          label="request_id"
          value={requestId || result?.requestId || "-"}
          mono
        />
        <ResultRow
          label="GitHub Actions 바로가기"
          value={runUrl || actionsUrl || "-"}
          mono
        />
        <ResultRow
          label="마지막 확인 시각"
          value={
            lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"
          }
        />
        <ResultRow
          label="자동 확인 횟수"
          value={`${pollCount} / ${ACTIVE_MAX_POLLS}`}
        />
        <ResultRow
          label="다음 확인까지"
          value={
            polling
              ? nextCheckIn > 0
                ? `${nextCheckIn}초`
                : "곧 확인"
              : "자동 확인 종료"
          }
        />
        <ResultRow
          label="상품명 반영 상태"
          value={`쇼핑몰별 상품명 반영 성공 ${summary.titleSuccessCount} · 미확인 ${summary.titleUnverifiedCount} · 미반영 ${summary.titleNotAppliedCount} · 실패 ${summary.titleFailedCount}`}
        />
        <ResultRow
          label="검색어 반영 상태"
          value={`검색어 반영 성공 ${summary.searchSuccessCount} · 미확인 ${summary.searchUnverifiedCount} · 미반영 ${summary.searchNotAppliedCount} · 실패 ${summary.searchFailedCount}`}
        />
        <ResultRow label="반영 상품 수" value={summary.appliedItemCount} />
        <ResultRow label="실패 수" value={summary.failedCount} />
        <ResultRow label="차단 수" value={summary.blockedCount} />
      </div>
      {isManualApplyReadyForFinalPrice(result) ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm font-bold text-emerald-800">
          실제 반영 결과 확인 후 가격 최종 재적용을 진행하세요.
        </p>
      ) : null}
      {commandPreview ? (
        <p className="mt-3 rounded-xl bg-white p-3 font-mono text-xs text-slate-700">
          {commandPreview}
        </p>
      ) : null}
    </section>
  );
}

function summarizeManualApplyResult(result: ManualApplyActionsResult | null) {
  const summary = result?.summary ?? {};
  const rows = [
    ...(result?.applyResults ?? []),
    ...(result?.verifyResults ?? []),
  ];
  const countRows = (predicate: (row: Record<string, unknown>) => boolean) =>
    rows.filter(predicate).length;
  const text = (value: unknown) => String(value ?? "").toLowerCase();
  const titleSuccessCount = Number(
    summary.title_apply_success_count ??
      countRows((row) =>
        ["success", "ok", "api_success", "verified"].includes(
          text(row.title_update_status || row.mall_title_apply_status),
        ),
      ),
  );
  const titleUnverifiedCount = Number(
    summary.title_apply_unverified_count ??
      countRows((row) =>
        text(row.title_update_status || row.mall_title_apply_status).includes(
          "unverified",
        ),
      ),
  );
  const titleNotAppliedCount = Number(
    summary.title_apply_not_applied_count ??
      countRows(
        (row) =>
          text(row.title_update_status || row.mall_title_apply_status) ===
          "not_applied",
      ),
  );
  const titleFailedCount = countRows((row) =>
    text(row.title_update_status || row.mall_title_apply_status).includes(
      "fail",
    ),
  );
  const searchSuccessCount = Number(
    summary.search_apply_success_count ??
      countRows((row) =>
        ["verified", "success", "ok", "api_success"].includes(
          text(row.site_srch_update_status || row.verification_status),
        ),
      ),
  );
  const searchUnverifiedCount = countRows((row) =>
    text(row.site_srch_update_status || row.verification_status).includes(
      "unverified",
    ),
  );
  const searchNotAppliedCount = Number(
    summary.search_apply_not_applied_count ??
      countRows((row) => text(row.site_srch_update_status) === "not_applied"),
  );
  const searchFailedCount = countRows((row) =>
    text(row.site_srch_update_status || row.verification_status).includes(
      "fail",
    ),
  );
  const failedCount = Number(
    summary.failed_item_count ?? titleFailedCount + searchFailedCount,
  );
  const blockedCount = Number(
    summary.blocked_item_count ?? result?.blockedItems?.length ?? 0,
  );
  const warningCount = Array.isArray(summary.warnings)
    ? summary.warnings.length
    : Number(summary.warning_count ?? 0);
  const appliedItemCount = Number(
    summary.applied_item_count ??
      Math.max(titleSuccessCount, searchSuccessCount),
  );
  const status = text(summary.status || result?.status);
  return {
    titleSuccessCount,
    titleUnverifiedCount,
    titleNotAppliedCount,
    titleFailedCount,
    searchSuccessCount,
    searchUnverifiedCount,
    searchNotAppliedCount,
    searchFailedCount,
    failedCount,
    blockedCount,
    warningCount,
    appliedItemCount,
    overallSuccess: ["success", "success_with_verification_warning"].includes(
      status,
    ),
  };
}

function isFinalManualApplyResult(result: ManualApplyActionsResult | null) {
  const value = String(
    result?.phase ?? result?.status ?? result?.summary?.status ?? "",
  );
  return [
    "artifact_ready",
    "failed",
    "blocked",
    "completed_no_artifact",
    "error",
    "success",
    "partial_failure",
    "success_with_verification_warning",
    "partial_success_unverified",
  ].includes(value);
}

function isManualApplyReadyForFinalPrice(
  result: ManualApplyActionsResult | null,
) {
  const status = String(result?.summary?.status ?? result?.status ?? "");
  return (
    isFinalManualApplyResult(result) &&
    [
      "success",
      "success_with_verification_warning",
      "partial_success_unverified",
    ].includes(status)
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-white p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function OperatorLaunchStatusBoard({
  state,
  productCount,
  mallCount,
  titleTargetCount,
  keywordWarningCount,
  issueCount,
  actualApplyDone,
  keywordApplyState,
  priceIssueState,
  manualCandidatesReady,
  onNext,
  initialPriceRequestId,
  finalPriceRequestId,
  finalPriceActionsResult,
  finalPriceActive,
  finalPriceDone,
  finalPriceFailed,
  finalPriceTargetCount,
}: {
  state: ReturnType<typeof buildCockpit>;
  productCount: number;
  mallCount: number;
  titleTargetCount: number;
  keywordWarningCount: number;
  issueCount: number;
  actualApplyDone: boolean;
  keywordApplyState: KeywordApplyState | null;
  priceIssueState: PriceIssueState;
  manualCandidatesReady: boolean;
  onNext: () => void;
  initialPriceRequestId: string;
  finalPriceRequestId: string;
  finalPriceActionsResult: PriceActionsResult | null;
  finalPriceActive: boolean;
  finalPriceDone: boolean;
  finalPriceFailed: boolean;
  finalPriceTargetCount: number;
}) {
  const hasCriticalPriceIssue = priceIssueState.kind === "critical";
  const realApplyStatus = keywordApplyState?.realApplyStatus ?? "idle";
  const realApplyRunning =
    realApplyStatus === "queued" ||
    realApplyStatus === "running" ||
    realApplyStatus === "waiting_artifact";
  const realApplyLabel = getKeywordApplyPhaseLabelForBoard(keywordApplyState);
  const keywordRealApplySucceeded =
    isKeywordRealApplySuccess(keywordApplyState);
  const manualApplyReadyForFinalPrice = keywordRealApplySucceeded;
  const finalPriceStatus = finalPriceActive
    ? "가격 최종 재적용 중"
    : finalPriceDone
      ? "success"
      : finalPriceFailed
        ? "failed"
        : "waiting";
  const boardButtonLabel = finalPriceActive
    ? "가격 최종 재적용 확인 중"
    : manualApplyReadyForFinalPrice && !finalPriceDone
      ? "가격 최종 재적용 확인 중"
      : actualApplyDone
        ? "출시 결과 확인"
        : realApplyRunning
          ? "검토 결과 새로고침"
          : realApplyStatus === "failed" || realApplyStatus === "blocked"
            ? "문제 확인"
            : state.primaryAction === "upload"
              ? "상품출시 시작"
              : keywordApplyState?.dryRunStatus === "success"
                ? "승인하고 실제 반영 실행"
                : "상품명/검색어 후보 입력 후 검토 생성";
  const dryRunComplete = keywordApplyState?.dryRunStatus === "success";
  const blockedByApply =
    realApplyStatus === "blocked" ||
    (keywordApplyState?.blankMallTitleBlockedCount ?? 0) > 0;
  const uploadAndPriceComplete =
    state.steps[0]?.state === "success" && state.steps[1]?.state === "success";
  const finalVerdict = blockedByApply
    ? "출시 보류 - 차단 항목 있음"
    : realApplyRunning
      ? "샵플링 실제 반영 중"
      : finalPriceActive
        ? "가격 최종 재적용 중"
        : finalPriceFailed
          ? "출시 보류 - 가격 최종 재적용 실패"
          : manualApplyReadyForFinalPrice && !finalPriceDone
            ? "가격 최종 재적용 중"
            : actualApplyDone
              ? "출시 완료"
              : dryRunComplete
                ? "출시 보류 - 승인 대기"
                : uploadAndPriceComplete && !manualCandidatesReady
                  ? "후보 입력 대기"
                  : uploadAndPriceComplete
                    ? "키워드 검토 준비 중"
                    : hasCriticalPriceIssue
                      ? "출시 보류 - 가격 확인 필요"
                      : state.primaryAction === "wait"
                        ? "진행 중"
                        : "검토 준비";
  const status: string = finalVerdict;
  const progress = actualApplyDone
    ? 100
    : Math.round(
        (state.steps.filter((step) => step.state === "success").length /
          Math.max(state.steps.length, 1)) *
          100,
      );
  const stages = [
    "상품업로드",
    "가격 1차 적용",
    "검토 준비",
    "상품명/키워드 실제 반영",
    "가격 최종 재적용",
    "출시 완료",
  ];
  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
      <p className="text-sm font-black text-emerald-700">상품출시 진행상태</p>
      <h1 className="mt-1 text-2xl font-black text-slate-950">
        {actualApplyDone && !hasCriticalPriceIssue ? "출시 완료" : finalVerdict}
      </h1>
      {actualApplyDone ? (
        <p className="mt-2 text-sm font-bold text-emerald-900">
          샵플링 상품명/검색어 반영까지 완료되었습니다.
        </p>
      ) : null}
      {hasCriticalPriceIssue ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-800">
          가격 확인 필요
          <br />
          쇼핑몰별 판매가 0원 항목이 남아 있습니다.
        </p>
      ) : null}
      {priceIssueState.kind === "unsupported" ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">
          가격 화면 검증 필요
          <br />
          가격 API는 실행됐지만 샵플링 화면 기준 0원 여부를 확인하지 못했습니다.
          상품명 API 반영은 실행됐지만 샵플링 화면 확인이 필요합니다.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <SummaryCard label="현재 상태" value={status} />
        <SummaryCard label="다음 작업" value={state.nextAction} />
        <SummaryCard label="진행률" value={`${progress}%`} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {stages.map((stage) => (
          <span
            key={stage}
            className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700"
          >
            {stage}
          </span>
        ))}
      </div>
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
      {status === "상품명 일부 누락" ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">
          상품명 일부 누락
        </p>
      ) : null}
      {!actualApplyDone && keywordApplyState?.dryRunStatus === "success" ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-900">
          키워드 dry_run은 완료됐지만 실제 샵플링 반영은 아직 실행되지
          않았습니다.
        </p>
      ) : null}
      <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-900">
        상품명/키워드 반영 후 가격을 마지막으로 한 번 더 적용합니다.
        <br />
        상품명 반영 과정에서 일부 쇼핑몰 가격이 0원으로 돌아가는 것을 방지하기
        위한 최종 보정 단계입니다.
      </div>
      <details className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800">
        <summary className="cursor-pointer">고급 / 상세 결과 보기</summary>
        <p className="mt-3">
          1차 가격 request id:{" "}
          <span className="font-mono">{initialPriceRequestId || "-"}</span>
        </p>
        <p>
          실제 반영 request id:{" "}
          <span className="font-mono">
            {keywordApplyState?.realApplyRequestId || "-"}
          </span>
        </p>
        <p>
          최종 가격 request id:{" "}
          <span className="font-mono">
            {finalPriceRequestId || finalPriceActionsResult?.requestId || "-"}
          </span>
        </p>
        <p>final price status: {finalPriceStatus}</p>
        <p>final price target count: {finalPriceTargetCount}</p>
        <p>
          dry_run request id:{" "}
          <span className="font-mono">
            {keywordApplyState?.dryRunRequestId || "-"}
          </span>
        </p>
        <p>
          real apply request id:{" "}
          <span className="font-mono">
            {keywordApplyState?.realApplyRequestId || "-"}
          </span>
        </p>
        <p>real apply status: {realApplyLabel}</p>
        <p>applied count: {keywordApplyState?.appliedCount ?? 0}</p>
        <p>failed count: {keywordApplyState?.failedCount ?? 0}</p>
        <p>
          blocked blank title count:{" "}
          {keywordApplyState?.blankMallTitleBlockedCount ?? 0}
        </p>
      </details>
      {keywordApplyState ? (
        <div className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800">
          <p>
            상품명 반영 {keywordApplyState.failedCount === 0 ? "성공" : "실패"}
          </p>
          <p>
            검색어 반영 {keywordApplyState.failedCount === 0 ? "성공" : "실패"}
          </p>
          <p>
            가격 최종 재적용{" "}
            {finalPriceDone ? "성공" : finalPriceFailed ? "실패" : "대기"}
          </p>
        </div>
      ) : null}
      {actualApplyDone ? (
        <div className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800">
          <p>반영 상품 수: {titleTargetCount}</p>
          <p>반영 쇼핑몰 수: {mallCount}</p>
          <p>가격 상태: {priceIssueState.label}</p>
          <p>검색어 경고 수: {keywordWarningCount}</p>
          <p>다음 수동 작업: 샵플링에서 마켓전송 전 최종 확인</p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onNext}
        className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white"
      >
        {boardButtonLabel}
      </button>
    </section>
  );
}

function isKeywordRealApplySuccess(state: KeywordApplyState | null) {
  const status = String(state?.realApplyStatus ?? "");
  return (
    (status === "success" || status === "success_with_verification_warning") &&
    (state?.appliedCount ?? 0) > 0 &&
    (state?.failedCount ?? 0) === 0 &&
    (state?.blankMallTitleBlockedCount ?? 0) === 0
  );
}

function getKeywordApplyPhaseLabelForBoard(state: KeywordApplyState | null) {
  if (!state || state.dryRunStatus === "idle") return "키워드 dry_run 대기";
  if (
    String(state.realApplyStatus) === "success" ||
    String(state.realApplyStatus) === "success_with_verification_warning"
  )
    return "실제 반영 완료";
  if (state.realApplyStatus === "failed") return "실제 반영 실패";
  if (state.realApplyStatus === "blocked") return "실제 반영 차단됨";
  if (
    state.realApplyStatus === "queued" ||
    state.realApplyStatus === "running" ||
    state.realApplyStatus === "waiting_artifact"
  )
    return "실제 반영 실행 중";
  if (state.dryRunStatus === "success") return "실제 반영 대기";
  return "키워드 dry_run 대기";
}

type StepState =
  | "waiting"
  | "running"
  | "checking"
  | "success"
  | "failed"
  | "action";
type CockpitStep = {
  name: string;
  state: StepState;
  action: string;
  message: string;
  count?: string;
};

function LaunchCockpit({
  steps,
  currentStage,
  nextAction,
  primaryAction,
  onNext,
  rowExpression,
  onRowExpressionChange,
  uploadBusy,
  priceBusy,
  keywordBusy,
  autoPilotEnabled,
  onAutoPilotChange,
  autoActualApplyEnabled,
  onAutoActualApplyEnabledChange,
  currentRequestId,
  previousRequestId,
  lastCheckedAt,
  autoPollStatus,
  actionsUrl,
  counts,
  uploadProgress,
  manualCandidatesReady,
  manualPreviewStatus,
  manualPreflightResult,
  manualBusy,
  goodsKeysEmpty,
}: {
  steps: CockpitStep[];
  currentStage: string;
  nextAction: string;
  primaryAction: string;
  onNext: () => void;
  rowExpression: string;
  onRowExpressionChange: (value: string) => void;
  uploadBusy: boolean;
  priceBusy: boolean;
  keywordBusy: boolean;
  autoPilotEnabled: boolean;
  onAutoPilotChange: (value: boolean) => void;
  autoActualApplyEnabled: boolean;
  onAutoActualApplyEnabledChange: (value: boolean) => void;
  currentRequestId: string;
  previousRequestId: string;
  lastCheckedAt: Date | null;
  autoPollStatus: string;
  actionsUrl?: string;
  counts: {
    upload: Record<string, number>;
    price: Record<string, number>;
    keyword: {
      targetCount: number;
      artifactState: string;
      reviewPendingCount: number;
      failureReason: string;
      artifact?: KeywordArtifact;
    };
  };
  manualCandidatesReady: boolean;
  manualPreviewStatus: string;
  manualPreflightResult: KeywordExecutionPreflightResult | null;
  manualBusy: boolean;
  goodsKeysEmpty: boolean;
  uploadProgress: {
    active: boolean;
    phase: string;
    elapsedSeconds: number;
    pollCount: number;
    lastCheckedAt: Date | null;
    nextCheckIn: number;
    requestId: string;
    actionsUrl?: string;
    onCheckNow: () => void;
    checking: boolean;
  };
}) {
  const rowIsValid = rowExpression.trim().length > 0;
  const primaryLabel = getPrimaryActionLabel(
    primaryAction,
    uploadBusy,
    priceBusy,
    keywordBusy,
    currentStage,
    manualCandidatesReady,
    manualPreviewStatus,
    manualPreflightResult,
  );
  const disabled =
    primaryAction === "upload"
      ? !rowIsValid || uploadBusy
      : primaryAction === "price"
        ? priceBusy || goodsKeysEmpty
        : primaryAction === "wait" || primaryAction === "failed"
          ? true
          : !manualCandidatesReady ||
            manualPreviewStatus === "checking" ||
            !!keywordBusy ||
            manualBusy ||
            !!manualPreflightResult?.summary.blockedCount ||
            (manualPreflightResult
              ? manualPreflightResult.summary.eligibleCount === 0 ||
                manualPreflightResult.summary.eligibleCount > 100
              : false);
  void steps;
  void counts;
  void autoPilotEnabled;
  void onAutoPilotChange;
  void autoActualApplyEnabled;
  void onAutoActualApplyEnabledChange;
  void currentRequestId;
  void previousRequestId;
  void autoPollStatus;
  void actionsUrl;
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">운영 집중 모드</p>
          <h1 className="text-2xl font-black text-slate-950">
            상품 출시 플로우
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            행 번호를 입력하면 상품업로드부터 순서대로 진행합니다.
          </p>
        </div>
      </div>
      {primaryAction === "upload" ? (
        <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-bold text-blue-700">행번호 입력</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            먼저 실재고 시트 행 번호를 입력하세요
          </h2>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            실재고 시트 행 번호
            <input
              value={rowExpression}
              onChange={(event) => onRowExpressionChange(event.target.value)}
              placeholder="예: 950 또는 950-955"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-2 text-sm text-slate-700">
            상품을 업로드할 실재고 시트의 행 번호입니다. 처음에는 행 번호만
            입력하면 됩니다.
          </p>
          {!rowIsValid ? (
            <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-blue-800">
              행 번호를 입력하면 상품업로드를 시작할 수 있습니다.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onNext}
            disabled={disabled}
            className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300"
          >
            {rowIsValid ? primaryLabel : "행 번호 입력 후 시작"}
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <button
            type="button"
            onClick={onNext}
            disabled={disabled}
            className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-slate-300"
          >
            {primaryLabel}
          </button>
        </div>
      )}

      {uploadProgress.active ? (
        <div className="mt-5 rounded-2xl border border-blue-300 bg-blue-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-lg font-black text-blue-950">
                <span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-800" />
                상품업로드 진행 중
                <span className="inline-flex gap-1">
                  <span className="animate-pulse">.</span>
                  <span className="animate-pulse delay-150">.</span>
                  <span className="animate-pulse delay-300">.</span>
                </span>
              </p>
              <p className="mt-2 text-sm font-semibold text-blue-900">
                GitHub Actions에서 상품업로드가 실행 중입니다. 완료되면 자동으로
                결과를 확인합니다.
              </p>
            </div>
            <GithubActionsShortcutButton href={uploadProgress.actionsUrl} />
          </div>
          <div className="mt-4 grid gap-2 text-sm text-blue-950 md:grid-cols-2 lg:grid-cols-4">
            <ResultRow label="현재 phase" value={uploadProgress.phase} />
            <ResultRow
              label="경과 시간"
              value={formatElapsed(uploadProgress.elapsedSeconds)}
            />
            <ResultRow
              label="자동 확인"
              value={`업로드 ${uploadProgress.pollCount}회`}
            />
            <ResultRow
              label="마지막 확인"
              value={
                uploadProgress.lastCheckedAt
                  ? uploadProgress.lastCheckedAt.toLocaleTimeString("ko-KR")
                  : "-"
              }
            />
            <ResultRow
              label="다음 확인"
              value={
                uploadProgress.nextCheckIn > 0
                  ? `${uploadProgress.nextCheckIn}초 후`
                  : "곧 확인"
              }
            />
            <ResultRow
              label="현재 요청 ID"
              value={uploadProgress.requestId || "아직 없음"}
              mono
            />
          </div>
          <button
            type="button"
            onClick={uploadProgress.onCheckNow}
            disabled={uploadProgress.checking}
            className="mt-4 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 disabled:bg-slate-100"
          >
            지금 다시 확인
          </button>
        </div>
      ) : null}
      <details className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
        <summary className="cursor-pointer font-bold">
          전체 항목 펼쳐보기
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ResultRow label="현재 단계" value={currentStage} />
          <ResultRow label="지금 할 일" value={nextAction} />
          <ResultRow
            label="현재 입력 행"
            value={rowExpression || "아직 없음"}
          />
          <ResultRow
            label="마지막 확인 시각"
            value={
              lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"
            }
          />
        </div>
      </details>
    </section>
  );
}
function getPrimaryActionLabel(
  primaryAction: string,
  uploadBusy: boolean,
  priceBusy: boolean,
  keywordBusy: boolean,
  currentStage: string,
  manualCandidatesReady: boolean,
  manualPreviewStatus: string,
  manualPreflightResult: KeywordExecutionPreflightResult | null,
) {
  if (primaryAction === "upload") return "상품출시 진행 시작";
  if (primaryAction === "price") return "가격설정 시작";
  if (primaryAction === "wait") return "준비 중입니다...";
  if (primaryAction === "failed") return "실패 원인 보기";
  if (uploadBusy || priceBusy || keywordBusy) return "준비 중입니다...";
  if (manualPreviewStatus === "checking") return "후보 검토 중...";
  if (
    manualPreflightResult?.summary.eligibleCount &&
    manualPreflightResult.summary.blockedCount === 0
  )
    return "승인하고 실제 반영 실행";
  if (manualCandidatesReady) return "상품명/검색어 후보 확인";
  if (primaryAction === "keyword" || primaryAction === "review")
    return "상품명/검색어 후보를 입력하세요.";
  if (currentStage === "가격설정") return "가격설정 결과 확인 중...";
  if (currentStage === "키워드 결과 검토") return "상품명/검색어 후보 확인";
  if (currentStage === "키워드/상품명 준비") return "키워드 결과 확인 중...";
  return "상품업로드 결과 확인 중...";
}
function ErrorDrawer({
  title,
  uploadResult,
  priceResult,
  keywordResult,
  requestId,
  actionsUrl,
  onReset,
  onRetry,
  onFetchPriceResult,
  actionsDisabled,
}: {
  title: string;
  uploadResult: UploadActionsResult | null;
  priceResult: PriceActionsResult | null;
  keywordResult: KeywordRunsResult | null;
  requestId: string;
  actionsUrl?: string;
  onReset: () => void;
  onRetry: () => void;
  onFetchPriceResult: () => void;
  actionsDisabled: boolean;
}) {
  const keywordFailure = hasKeywordFailure(keywordResult);
  const githubCredentialError = isGithubCredentialError(priceResult);
  const duplicate = !githubCredentialError && allFailedRowsAreDuplicatePtnGoodsCd(uploadResult);
  const operatorMessage = githubCredentialError
    ? "GitHub 토큰 오류"
    : keywordFailure
      ? "검토 준비가 실패했습니다."
    : duplicate
      ? "같은 자사상품코드가 이미 샵플링에 등록되어 있습니다."
      : "실패한 단계의 로그와 행별 오류를 확인하세요.";
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <h2 className="text-lg font-bold text-red-800">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-red-950">
        <p className="font-semibold">{operatorMessage}</p>
        {githubCredentialError ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <h3 className="font-black">GitHub 토큰 오류</h3>
            <p className="mt-2 font-semibold">
              가격설정 실행은 완료되었을 수 있지만, OPS Center가 GitHub Actions 결과 파일을 가져오지 못했습니다.
            </p>
            <p className="mt-2">
              Vercel 환경변수 SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN 또는 GITHUB_ACTIONS_TOKEN을 확인하세요.
            </p>
            {priceResult?.runConclusion === "success" ? (
              <p className="mt-2 rounded-lg bg-white p-3 font-bold">
                가격설정 작업은 성공했을 수 있습니다. 토큰을 수정한 뒤 결과만 다시 가져오세요.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={onFetchPriceResult} disabled={actionsDisabled} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-400">가격설정 결과 다시 가져오기</button>
              <GithubActionsShortcutButton href={actionsUrl ?? priceResult?.runUrl} />
              <button type="button" onClick={onRetry} disabled={actionsDisabled} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 disabled:bg-slate-100">현재 실패 기록 지우기</button>
            </div>
          </div>
        ) : duplicate ? (
          <p className="rounded-xl border border-red-200 bg-white p-3 font-semibold">
            같은 자사상품코드가 이미 샵플링에 등록되어 있습니다.
            <br />
            실재고 시트의 자사상품코드를 수정했거나 goods_key가 이미 있는 행을
            다시 업로드하려는 경우, 실패 기록을 지운 뒤 다시 실행하세요.
          </p>
        ) : null}
        {keywordFailure ? (
          <p>
            키워드 엔진이 상품정보를 조회하지 못했습니다. 새로 업로드한 상품은
            API 반영 지연일 수 있습니다. 잠시 후 다시 실행하거나 seed keyword를
            입력해 실행하세요. 권장 작업: GitHub Actions 로그 확인, 잠시 후 다시
            실행, 시드 키워드를 입력하고 다시 실행.
          </p>
        ) : null}
        {!githubCredentialError ? <div className="rounded-xl border border-red-200 bg-white p-4">
          <p className="font-bold text-red-900">
            자사상품코드나 실재고 시트 값을 수정했다면 아래 버튼으로 이전 실패
            기록을 지우고 다시 시작하세요.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onReset}
              disabled={actionsDisabled}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-black text-white disabled:bg-slate-400"
            >
              문제 해결 후 처음부터 다시 시작
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={actionsDisabled}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-black text-red-800 disabled:bg-slate-100"
            >
              현재 실패 기록 지우기
            </button>
            <button
              type="button"
              onClick={onRetry}
              disabled={actionsDisabled}
              className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-black text-blue-800 disabled:bg-slate-100"
            >
              문제 해결 후 같은 행 다시 실행
            </button>
          </div>
        </div> : null}
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer font-bold text-slate-900">
            개발자 진단 보기
          </summary>
          <dl className="mt-3 grid gap-2">
            <ResultRow
              label="technical detail"
              value={
                uploadResult?.message ??
                priceResult?.message ??
                keywordResult?.message ??
                "-"
              }
            />
            <ResultRow label="request id" value={requestId} mono />
            <ResultRow
              label="run id"
              value={String(
                uploadResult?.runId ?? keywordResult?.runs?.[0]?.id ?? "-",
              )}
              mono
            />
            <ResultRow
              label="run conclusion"
              value={String(
                uploadResult?.runConclusion ??
                  keywordResult?.runs?.[0]?.conclusion ??
                  "-",
              )}
            />
            <ResultRow
              label="artifact state"
              value={getKeywordSummary(keywordResult, 0).artifactState}
            />
            <ResultRow
              label="recommended next action"
              value="실패 원인 보기 후 GitHub Actions 바로가기에서 로그를 확인하고, 안전 재시도 안내에 따라 중복 스킵 또는 시드 키워드를 사용해 다시 실행하세요."
            />
          </dl>
        </details>
        <GithubActionsShortcutButton href={actionsUrl} />
      </div>
    </section>
  );
}

function GithubActionsShortcutButton({
  href,
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  if (!href) return null;
  return (
    <span className={`inline-flex flex-col gap-1 align-top ${className}`}>
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800"
      >
        GitHub Actions 바로가기
      </Link>
      <span className="text-xs text-slate-600">
        문제가 있으면 실행 로그에서 실패 원인을 바로 확인할 수 있습니다.
      </span>
    </span>
  );
}

function UploadRowsTable({ rows }: { rows: ProductLaunchUploadRow[] }) {
  const issueRows = rows.filter(
    (row) => isFailedUploadRow(row) || !row.goods_key,
  );
  const displayRows =
    issueRows.length > 0 ? issueRows.slice(0, 20) : rows.slice(0, 20);
  const hiddenSuccessCount = rows.filter(
    (row) => !isFailedUploadRow(row) && row.goods_key,
  ).length;
  return (
    <div className="mt-4 overflow-x-auto">
      <p className="mb-2 text-xs font-semibold text-slate-600">
        문제 {displayRows.length}개 표시 중 · 성공 {hiddenSuccessCount}개 숨김{" "}
        <button className="ml-2 underline">더 보기</button>{" "}
        <button className="ml-2 underline">전체 펼치기</button>
      </p>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-700">
            <th className="border border-slate-200 px-3 py-2">행</th>
            <th className="border border-slate-200 px-3 py-2">상품그룹</th>
            <th className="border border-slate-200 px-3 py-2">채널</th>
            <th className="border border-slate-200 px-3 py-2">code</th>
            <th className="border border-slate-200 px-3 py-2">goods_key</th>
            <th className="border border-slate-200 px-3 py-2">ptn_goods_cd</th>
            <th className="border border-slate-200 px-3 py-2">상태</th>
            <th className="border border-slate-200 px-3 py-2">메시지</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.length > 0 ? (
            displayRows.map((row, index) => {
              const duplicate = isDuplicatePtnGoodsCdError(row);
              const failed = isFailedUploadRow(row);
              return (
                <tr
                  key={`${row.row}-${row.channel}-${row.goods_key}-${row.ptn_goods_cd}-${index}`}
                  className={failed ? "bg-red-50 text-red-950" : "bg-white"}
                >
                  <td className="border border-slate-200 px-3 py-2">
                    {row.row ?? "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-semibold">
                    {
                      inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "")
                        .productGroup
                    }
                  </td>
                  <td className="border border-slate-200 px-3 py-2">
                    {row.channel ?? "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2">
                    {row.code ?? "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-mono">
                    {row.goods_key ?? "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-mono">
                    {row.ptn_goods_cd ?? "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-semibold">
                    {row.status ?? (failed ? "failed" : "-")}
                  </td>
                  <td className="border border-slate-200 px-3 py-2">
                    {duplicate ? (
                      <>
                        <strong>
                          같은 자사상품코드가 이미 샵플링에 등록되어 있습니다.
                        </strong>
                        <br />
                      </>
                    ) : null}
                    {row.message ?? row.msg ?? "-"}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                className="border border-slate-200 px-3 py-2 text-slate-500"
                colSpan={8}
              >
                업로드 행별 결과가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function UploadPollingStatusCard({
  result,
  requestId,
  rowsWithGoodsKeyCount,
  polling,
  fetching,
  elapsedSeconds,
  lastCheckedAt,
  pollCount,
  maxPolls,
  nextCheckIn,
}: {
  result: UploadActionsResult | null;
  requestId: string;
  rowsWithGoodsKeyCount: number;
  polling: boolean;
  fetching: boolean;
  elapsedSeconds: number;
  lastCheckedAt: Date | null;
  pollCount: number;
  maxPolls: number;
  nextCheckIn: number;
}) {
  const state = getUploadPollingState(
    result,
    rowsWithGoodsKeyCount,
    polling,
    pollCount >= maxPolls,
  );
  if (!result && !polling && pollCount === 0) return null;
  return (
    <article className={`mt-5 rounded-2xl border p-4 ${state.cardClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-bold ${state.textClass}`}>
            {state.label}
          </p>
          <p className="mt-1 text-sm text-slate-700">{state.message}</p>
        </div>
        {state.showSpinner || fetching ? (
          <span
            aria-label="확인 중"
            className="inline-flex size-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700"
          />
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
        <span>
          경과 시간: <strong>{formatElapsed(elapsedSeconds)}</strong>
        </span>
        <span>
          마지막 확인:{" "}
          <strong>
            {lastCheckedAt ? lastCheckedAt.toLocaleTimeString("ko-KR") : "-"}
          </strong>
        </span>
        <span>
          확인 횟수:{" "}
          <strong>
            {pollCount}/{maxPolls}
          </strong>
        </span>
        <span>
          다음 자동 확인:{" "}
          <strong>
            {polling && !state.final ? `${nextCheckIn}초 후` : "-"}
          </strong>
        </span>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {[
          "요청 전송",
          "GitHub Actions 실행 확인",
          "워크플로우 진행 중",
          "결과 artifact 확인 중",
          "OPS Center 결과 반영 완료",
        ].map((step, index) => {
          const stepNumber = index + 1;
          const statusClass =
            stepNumber < state.currentStep
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : stepNumber === state.currentStep
                ? state.stepClass
                : "border-slate-200 bg-slate-50 text-slate-500";
          return (
            <li
              key={step}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${statusClass}`}
            >
              <span className="mr-1">{stepNumber}</span>
              {step}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {requestId || result?.requestId ? (
          <span className="font-mono text-xs text-slate-600">
            request_id: {result?.requestId ?? requestId}
          </span>
        ) : null}
        {result?.runId ? (
          <span className="font-mono text-xs text-slate-600">
            run_id: {result.runId}
          </span>
        ) : null}
        <GithubActionsShortcutButton href={result?.runUrl} />
      </div>
      {state.showDetails ? (
        <UploadPollingErrorDetails result={result} requestId={requestId} />
      ) : null}
    </article>
  );
}

function getUploadPhaseLabel(
  result: UploadActionsResult | null,
  running: boolean,
  fetching: boolean,
  polling: boolean,
) {
  if (running || result?.phase === "request_sent") return "요청 전송";
  if (
    result?.phase === "queued" ||
    result?.phase === "running" ||
    result?.runStatus === "queued" ||
    result?.runStatus === "in_progress"
  )
    return "GitHub Actions 실행 중";
  if (
    result?.phase === "waiting_artifact" ||
    result?.phase === "completed_no_artifact" ||
    polling
  )
    return "결과 파일 확인 중";
  if (fetching || result?.status === "success")
    return "OPS Center 결과 반영 중";
  return "요청 전송";
}

function getUploadPollingState(
  result: UploadActionsResult | null,
  rowsWithGoodsKeyCount: number,
  polling: boolean,
  timedOut: boolean,
) {
  if (timedOut && !isFinalUploadPollingResult(result, rowsWithGoodsKeyCount))
    return {
      label: "자동 확인 시간 초과",
      message:
        "자동 확인 시간이 초과되었습니다. 잠시 후 다시 확인하거나 GitHub Actions 로그를 확인하세요.",
      currentStep: 4,
      final: true,
      showSpinner: false,
      showDetails: true,
      cardClass: "border-red-200 bg-red-50",
      textClass: "text-red-700",
      stepClass: "border-red-300 bg-red-100 text-red-800",
    };
  if (isConfirmedUploadFailure(result))
    return {
      label: "실패",
      message:
        result?.message ??
        "상품업로드 실행이 실패했습니다. GitHub Actions 로그를 확인하세요.",
      currentStep: 3,
      final: true,
      showSpinner: false,
      showDetails: true,
      cardClass: "border-red-200 bg-red-50",
      textClass: "text-red-700",
      stepClass: "border-red-300 bg-red-100 text-red-800",
    };
  if (result?.status === "error" && result?.phase !== "completed_no_artifact")
    return {
      label: "결과 확인 오류",
      message: "상품업로드 결과 확인 중 오류가 발생했습니다.",
      currentStep: 2,
      final: true,
      showSpinner: false,
      showDetails: true,
      cardClass: "border-red-200 bg-red-50",
      textClass: "text-red-700",
      stepClass: "border-red-300 bg-red-100 text-red-800",
    };
  const summaryStatus = getUploadSummaryStatus(result);
  if (summaryStatus === "failed")
    return {
      label: "상품업로드 실패",
      message: allFailedRowsAreDuplicatePtnGoodsCd(result)
        ? "같은 자사상품코드가 이미 등록되어 업로드가 차단되었습니다."
        : "샵플링이 상품등록을 거절했습니다. 아래 행별 오류를 확인하세요.",
      currentStep: 5,
      final: true,
      showSpinner: false,
      showDetails: true,
      cardClass: "border-red-200 bg-red-50",
      textClass: "text-red-700",
      stepClass: "border-red-300 bg-red-100 text-red-800",
    };
  if (summaryStatus === "partial_failure")
    return {
      label: "상품업로드 일부 실패",
      message: "일부 상품등록이 실패했습니다. 아래 행별 오류를 확인하세요.",
      currentStep: 5,
      final: true,
      showSpinner: false,
      showDetails: true,
      cardClass: "border-amber-200 bg-amber-50",
      textClass: "text-amber-800",
      stepClass: "border-amber-300 bg-amber-100 text-amber-900",
    };
  if (
    summaryStatus === "success" ||
    (result?.status === "success" && rowsWithGoodsKeyCount > 0)
  )
    return {
      label: "상품업로드 완료",
      message: "상품업로드가 완료되었습니다. goods_key를 확인했습니다.",
      currentStep: 5,
      final: true,
      showSpinner: false,
      showDetails: false,
      cardClass: "border-emerald-200 bg-emerald-50",
      textClass: "text-emerald-800",
      stepClass: "border-emerald-300 bg-emerald-100 text-emerald-800",
    };
  if (result?.status === "success")
    return {
      label: "상품업로드 결과 확인 완료",
      message: "실행 결과를 가져왔지만 goods_key 결과가 없습니다.",
      currentStep: 5,
      final: true,
      showSpinner: false,
      showDetails: false,
      cardClass: "border-amber-200 bg-amber-50",
      textClass: "text-amber-800",
      stepClass: "border-amber-300 bg-amber-100 text-amber-900",
    };
  if (
    result?.phase === "waiting_artifact" ||
    result?.phase === "completed_no_artifact"
  )
    return {
      label: "결과 파일 대기",
      message:
        result.status === "error"
          ? "현재 요청의 artifact에서 result_summary.json을 찾지 못했습니다."
          : "현재 요청의 실행은 확인됐고, 결과 파일을 기다리는 중입니다.",
      currentStep: 4,
      final: result.status === "error",
      showSpinner: result.status !== "error",
      showDetails: result.status === "error",
      cardClass:
        result.status === "error"
          ? "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50",
      textClass: result.status === "error" ? "text-red-700" : "text-amber-800",
      stepClass:
        result.status === "error"
          ? "border-red-300 bg-red-100 text-red-800"
          : "border-amber-300 bg-amber-100 text-amber-900 animate-pulse",
    };
  if (
    result?.phase === "queued" ||
    result?.phase === "running" ||
    result?.runStatus === "queued" ||
    result?.runStatus === "in_progress"
  )
    return {
      label: "진행 중",
      message:
        "상품업로드가 아직 진행 중입니다. 결과 파일이 준비되면 자동으로 다시 확인합니다.",
      currentStep: 3,
      final: false,
      showSpinner: true,
      showDetails: false,
      cardClass: "border-blue-200 bg-blue-50",
      textClass: "text-blue-800",
      stepClass: "border-blue-300 bg-blue-100 text-blue-800 animate-pulse",
    };
  return {
    label: polling ? "GitHub Actions 확인 중" : "결과 확인 대기",
    message: "현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다.",
    currentStep: 2,
    final: false,
    showSpinner: polling,
    showDetails: false,
    cardClass: "border-blue-200 bg-blue-50",
    textClass: "text-blue-800",
    stepClass: "border-blue-300 bg-blue-100 text-blue-800 animate-pulse",
  };
}

function UploadPollingErrorDetails({
  result,
  requestId,
}: {
  result: UploadActionsResult | null;
  requestId: string;
}) {
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-slate-800">
      <p className="font-bold text-red-700">상세 오류</p>
      <dl className="mt-2 grid gap-1">
        <ResultRow label="message" value={result?.message ?? "-"} />
        <ResultRow
          label="requestId"
          value={result?.requestId ?? requestId ?? "-"}
          mono
        />
        {result?.runId ? (
          <ResultRow label="runId" value={result.runId} mono />
        ) : null}
        {result?.runUrl ? (
          <ResultRow label="runUrl" value={result.runUrl} />
        ) : null}
      </dl>
    </div>
  );
}

function isConfirmedUploadFailure(result: UploadActionsResult | null) {
  if (!result) return false;
  const confirmedConclusion =
    result.runStatus === "completed" &&
    ["failure", "cancelled", "timed_out"].includes(
      String(result.runConclusion ?? ""),
    );
  const backendConfirmedFailure =
    result.phase === "failed" && (!!result.runId || !!result.runUrl);
  return (confirmedConclusion && !result.summary) || backendConfirmedFailure;
}

function isFinalUploadPollingResult(
  result: UploadActionsResult | null,
  rowsWithGoodsKeyCount: number,
) {
  return (
    isConfirmedUploadFailure(result) ||
    result?.status === "success" ||
    rowsWithGoodsKeyCount > 0
  );
}

function getUploadSummaryStatus(result: UploadActionsResult | null) {
  const summary = result?.summary;
  if (!summary || typeof summary !== "object") return "";
  return String((summary as { status?: unknown }).status ?? "");
}

function isFailedUploadRow(row: ProductLaunchUploadRow) {
  const status = String(
    row.status ?? row.success ?? row.ok ?? "",
  ).toLowerCase();
  return (
    status === "failed" ||
    status === "failure" ||
    status === "false" ||
    isDuplicatePtnGoodsCdError(row)
  );
}

function isDuplicatePtnGoodsCdError(row: ProductLaunchUploadRow) {
  const code = String(row.code ?? "");
  const message = `${row.message ?? ""} ${row.msg ?? ""}`;
  return code.startsWith("110") || message.includes("자사상품코드 중복");
}

function allFailedRowsAreDuplicatePtnGoodsCd(
  result: UploadActionsResult | null,
) {
  const rows = extractUploadRows(result).filter(isFailedUploadRow);
  return rows.length > 0 && rows.every(isDuplicatePtnGoodsCdError);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${rest}초`;
}

function PriceSection({
  title = "Step 2. 가격설정",
  goodsKeyCount,
  result,
  actionsResult,
  requestId,
  running,
  fetching,
  onRun,
  onFetch,
  onClearFailure,
  finalPass = false,
}: {
  title?: string;
  goodsKeyCount: number;
  result: RunResult | null;
  actionsResult: PriceActionsResult | null;
  requestId: string;
  running: boolean;
  fetching: boolean;
  onRun: () => void;
  onFetch: () => void;
  onClearFailure?: () => void;
  finalPass?: boolean;
}) {
  const summary = actionsResult?.summary;
  const errors = Array.isArray(summary?.errors) ? summary.errors : [];
  const notApplied = Number(summary?.not_applied_count ?? 0);
  const blankRisk = Number(summary?.blank_risk_count ?? 0);
  const failed = Number(summary?.failed_count ?? summary?.fail_count ?? 0);
  const affectedMalls = Array.isArray(summary?.affected_malls)
    ? summary.affected_malls.join(", ")
    : [...new Set(errors.map((error) => error.mall).filter(Boolean))].join(
        ", ",
      );
  const githubCredentialError = isGithubCredentialError(actionsResult);
  const hasCoverageRisk = !githubCredentialError && (notApplied > 0 || blankRisk > 0 || failed > 0);
  const expectedUpdateCount = goodsKeyCount * FULL_PRICE_POLICY_MALL_COUNT;
  const confirmedAll =
    actionsResult &&
    !hasCoverageRisk &&
    Number(summary?.estimated_mall_update_count ?? 0) >= expectedUpdateCount;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      {finalPass ? (
        <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-900">
          상품명/키워드 반영 후 가격을 마지막으로 한 번 더 적용합니다.
          <br />
          상품명 반영 과정에서 일부 쇼핑몰 가격이 0원으로 돌아가는 것을 방지하기
          위한 최종 보정 단계입니다.
        </p>
      ) : null}
      <p className="mt-3 text-sm text-slate-700">
        대상 goods_key 수: <strong>{goodsKeyCount}</strong>
      </p>
      <p className="mt-1 text-sm font-bold text-slate-800">
        가격 정책: 전체 쇼핑몰 가격 일괄 적용
      </p>
      <p className="mt-1 text-sm text-slate-700">
        상품명/검색어는 상품그룹별로 다르게 반영하고, 가격은 모든 쇼핑몰에 동일
        정책으로 채웁니다.
      </p>
      <p className="mt-1 text-sm text-slate-700">
        예상 쇼핑몰 가격설정 대상 수: <strong>{expectedUpdateCount}</strong>
      </p>
      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600">
        가격설정 대상 쇼핑몰 수 = goods_key 수 × {FULL_PRICE_POLICY_MALL_COUNT}
      </p>
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
      >
        {running
          ? "실행 요청 중..."
          : finalPass
            ? "가격 최종 재적용 실행"
            : "가격설정 실행"}
      </button>
      <button
        type="button"
        onClick={onFetch}
        disabled={fetching}
        className="ml-3 mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
      >
        {fetching
          ? "가져오는 중..."
          : finalPass
            ? "가격 최종 재적용 결과 가져오기"
            : "가격설정 결과 가져오기"}
      </button>
      <StatusBlock result={result} requestId={requestId} />
      {githubCredentialError ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h3 className="text-base font-black">GitHub 토큰 오류</h3>
          <p className="mt-2 font-semibold">
            가격설정 실행은 완료되었을 수 있지만, OPS Center가 GitHub Actions 결과 파일을 가져오지 못했습니다.
          </p>
          <p className="mt-2">
            Vercel 환경변수 SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN 또는 GITHUB_ACTIONS_TOKEN을 확인하세요.
          </p>
          {actionsResult?.runConclusion === "success" ? (
            <p className="mt-2 rounded-lg bg-white p-3 font-bold">
              가격설정 작업은 성공했을 수 있습니다. 토큰을 수정한 뒤 결과만 다시 가져오세요.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onFetch}
              disabled={fetching}
              className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-400"
            >
              {fetching ? "가져오는 중..." : "가격설정 결과 다시 가져오기"}
            </button>
            <GithubActionsShortcutButton href={actionsResult?.runUrl ?? result?.githubActionsUrl} />
            {onClearFailure ? (
              <button
                type="button"
                onClick={onClearFailure}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900"
              >
                현재 실패 기록 지우기
              </button>
            ) : null}
          </div>
        </div>
      ) : hasCoverageRisk ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
          <h3 className="font-black">
            가격이 비어 있을 수 있는 쇼핑몰이 있습니다.
          </h3>
          <p className="mt-2">영향 쇼핑몰: {affectedMalls || "확인 필요"}</p>
          <p>
            영향 goods_key 수:{" "}
            {String(summary?.goods_key_count ?? goodsKeyCount)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRun}
              className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white"
            >
              가격설정 재실행
            </button>
            <GithubActionsShortcutButton href={actionsResult?.runUrl} />
            <button
              type="button"
              className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-800"
            >
              상세 결과 보기
            </button>
          </div>
        </div>
      ) : confirmedAll ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-800">
          모든 필수 쇼핑몰 가격 반영을 확인했습니다.
        </p>
      ) : null}
      {actionsResult ? (
        <dl className="mt-4 grid gap-3 text-sm">
          <ResultRow
            label="status"
            value={String(summary?.status ?? actionsResult.status ?? "-")}
          />
          <ResultRow
            label="exit_code"
            value={String(summary?.exit_code ?? "-")}
          />
          <ResultRow
            label="goods_key_count"
            value={String(summary?.goods_key_count ?? "-")}
          />
          <ResultRow
            label="estimated_mall_update_count"
            value={String(summary?.estimated_mall_update_count ?? "-")}
          />
          <ResultRow
            label="policy_override_count"
            value={String(summary?.policy_override_count ?? 0)}
          />
          <ResultRow label="성공 수" value={String(summary?.ok_count ?? "-")} />
          <ResultRow
            label="실패 수"
            value={String(summary?.fail_count ?? "-")}
          />
        </dl>
      ) : null}
      <ErrorsTable errors={errors} />
    </section>
  );
}

function KeywordPrepSection({
  rows,
  goodsKeys,
  seedKeyword,
  onSeedKeywordChange,
  preview,
  dispatchResult,
  runsResult,
  importMessage,
  busy,
  onPreview,
  onDispatch,
  onFetchRuns,
  onImport,
}: {
  rows: ProductLaunchUploadRow[];
  goodsKeys: string[];
  seedKeyword: string;
  onSeedKeywordChange: (value: string) => void;
  preview: unknown;
  dispatchResult: KeywordDispatchResult | null;
  runsResult: KeywordRunsResult | null;
  importMessage: string;
  busy: string;
  onPreview: () => void;
  onDispatch: () => void;
  onFetchRuns: () => void;
  onImport: (run: KeywordRun, artifact: KeywordArtifact) => void;
}) {
  const latestRunWithArtifact = runsResult?.runs?.find((run) =>
    run.artifacts?.some((artifact) => artifact.expected && !artifact.expired),
  );
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">
        Step 3. 상품명/키워드 실행 및 검토
      </h2>
      <p className="mt-3 text-sm text-slate-700">
        현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용하는 기준으로
        준비합니다.
      </p>
      <p className="mt-1 text-sm text-slate-700">
        키워드 엔진은 dry_run으로만 실행되며, 결과는 키워드 결과 검토 화면에서
        사람이 확인합니다.
      </p>
      <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">
        키워드/상품명 결과는 샵플링에 자동 반영되지 않습니다. 검토 화면에서 확인
        후 별도 승인해야 합니다.
      </p>
      <p className="mt-3 text-sm text-slate-700">
        대상 goods_key 수: <strong>{goodsKeys.length}</strong>
      </p>
      <p className="mt-1 break-all font-mono text-xs text-slate-700">
        goods_key CSV preview: {goodsKeys.join(",")}
      </p>
      <label className="mt-4 block text-sm font-semibold text-slate-800">
        시드 키워드
        <input
          value={seedKeyword}
          onChange={(event) => onSeedKeywordChange(event.target.value)}
          placeholder="예: 욕실 수납, 주방 정리, 차량용 수납"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <p className="mt-1 text-xs text-slate-600">
        비워두면 goods_key 기준으로 키워드 엔진이 자동 진행합니다.
      </p>
      <UploadRowsTable rows={rows} />
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPreview}
          disabled={!!busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
        >
          키워드 엔진 입력값 확인
        </button>
        <button
          type="button"
          onClick={onDispatch}
          disabled={!!busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
        >
          키워드 엔진 실행
        </button>
        <button
          type="button"
          onClick={onFetchRuns}
          disabled={!!busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100"
        >
          키워드 실행 결과 확인
        </button>
      </div>
      {preview ? (
        <details className="mt-4 rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">
            상세 실행 정보 열기
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </details>
      ) : null}
      {dispatchResult ? (
        <dl className="mt-4 grid gap-3 text-sm">
          <ResultRow label="repo" value={dispatchResult.repo ?? "-"} />
          <ResultRow
            label="workflowFile"
            value={dispatchResult.workflowFile ?? "-"}
          />
          <ResultRow
            label="actionsUrl"
            value={dispatchResult.actionsUrl ?? "-"}
          />
          <ResultRow
            label="expectedArtifactName"
            value={dispatchResult.expectedArtifactName ?? "-"}
          />
          <ResultRow
            label="message"
            value="키워드 엔진 실행을 요청했습니다. 몇 초 뒤 실행 결과 확인을 눌러주세요."
          />
        </dl>
      ) : null}
      {runsResult?.message ? (
        <p className="mt-3 text-sm text-slate-600">{runsResult.message}</p>
      ) : null}
      {latestRunWithArtifact ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          가져올 결과물이 있는 최신 실행을 우선 표시합니다.
        </p>
      ) : null}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">
          이전 실행 기록 보기
        </summary>
        <div className="mt-4 space-y-3">
          {runsResult?.runs?.map((run) => {
            const expectedArtifact = run.artifacts?.find(
              (artifact) => artifact.expected,
            );
            return (
              <article
                key={run.id}
                className="rounded-lg border border-slate-200 p-4 text-sm"
              >
                <div className="flex flex-wrap gap-3">
                  <span>
                    run id: <strong>{run.id}</strong>
                  </span>
                  <span>status: {run.status ?? "-"}</span>
                  <span>conclusion: {run.conclusion ?? "-"}</span>
                  <span>createdAt: {run.createdAt ?? "-"}</span>
                  {run.htmlUrl ? (
                    <Link
                      href={run.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-700 underline"
                    >
                      GitHub Actions 바로가기
                    </Link>
                  ) : null}
                </div>
                <p
                  className={
                    expectedArtifact
                      ? "mt-2 font-semibold text-emerald-700"
                      : "mt-2 text-slate-600"
                  }
                >
                  {expectedArtifact
                    ? `expected artifact exists: ${expectedArtifact.name}`
                    : "expected artifact exists: no"}
                </p>
                {expectedArtifact ? (
                  <button
                    type="button"
                    onClick={() => onImport(run, expectedArtifact)}
                    disabled={!!busy || expectedArtifact.expired}
                    className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300"
                  >
                    결과 가져오기 및 검토 시작
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </details>
      {importMessage ? (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          {importMessage}
        </p>
      ) : null}
      {importMessage ? (
        <Link
          href="/keyword-review-queue?from=product-launch-flow"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          개별 키워드 검토 화면에서 열기
        </Link>
      ) : null}
    </section>
  );
}

function FinalChecklist() {
  const items = [
    "상품업로드 결과 확인",
    "goods_key 6개 확인",
    "ptn_goods_cd suffix 기반 상품그룹 인식 확인",
    "가격설정 완료 확인",
    "상품명/키워드 단계는 MVP 기준 동일 적용 예정",
    "샵플링 마켓전송은 수동으로 진행",
  ];
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <h2 className="text-lg font-bold text-amber-950">최종 체크리스트</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold text-red-700">
        마켓전송은 현재 OPS Center에서 자동 실행하지 않습니다. 샵플링 관리자에서
        최종 확인 후 직접 전송하세요.
      </p>
    </section>
  );
}
function ErrorsTable({ errors }: { errors: ProductLaunchPriceError[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="border border-slate-200 px-3 py-2">idx</th>
            <th className="border border-slate-200 px-3 py-2">mall</th>
            <th className="border border-slate-200 px-3 py-2">goods_key</th>
            <th className="border border-slate-200 px-3 py-2">code</th>
            <th className="border border-slate-200 px-3 py-2">msg</th>
          </tr>
        </thead>
        <tbody>
          {errors.length > 0 ? (
            errors.map((error, index) => (
              <tr key={`${error.goods_key}-${index}`}>
                <td className="border border-slate-200 px-3 py-2">
                  {error.idx ?? index + 1}
                </td>
                <td className="border border-slate-200 px-3 py-2">
                  {error.mall ?? "-"}
                </td>
                <td className="border border-slate-200 px-3 py-2 font-mono">
                  {error.goods_key ?? "-"}
                </td>
                <td className="border border-slate-200 px-3 py-2">
                  {error.code ?? "-"}
                </td>
                <td className="border border-slate-200 px-3 py-2">
                  {error.msg ?? "-"}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                className="border border-slate-200 px-3 py-2 text-slate-500"
                colSpan={5}
              >
                실패 항목이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function StatusBlock({
  result,
  requestId,
}: {
  result: RunResult | null;
  requestId: string;
}) {
  return result ? (
    <dl className="mt-4 grid gap-3 text-sm">
      <ResultRow
        label="실행 상태"
        value={
          result.status === "queued"
            ? "GitHub Actions 실행 요청됨"
            : (result.status ?? "-")
        }
      />
      <ResultRow
        label="요청 추적 ID"
        value={result.requestId ?? requestId ?? "-"}
        mono
      />
      {result.commandPreview ? (
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer font-semibold">
            상세 실행 정보 열기
          </summary>
          <ResultRow
            label="commandPreview"
            value={result.commandPreview}
            mono
          />
        </details>
      ) : null}
      {result.githubActionsUrl ? (
        <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]">
          <dt className="font-semibold text-slate-700">githubActionsUrl</dt>
          <dd>
            <a
              href={result.githubActionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-semibold text-blue-700 underline"
            >
              {result.githubActionsUrl}
            </a>
          </dd>
        </div>
      ) : null}
      {result.message ? (
        <ResultRow label="message" value={result.message} />
      ) : null}
    </dl>
  ) : null;
}
function ResultRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3 md:grid-cols-[220px_1fr]">
      <dt className="font-semibold text-slate-700">{label}</dt>
      <dd className={mono ? "font-mono text-slate-900" : "text-slate-900"}>
        {value}
      </dd>
    </div>
  );
}
function getStoredValue(key: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}
function persistValue(key: string, value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}
function currentManualOverrideStorageScope(
  rowExpression: string,
  launchRequestId: string,
) {
  return (launchRequestId || rowExpression || "draft").replace(
    /[^a-zA-Z0-9_.-]+/g,
    "_",
  );
}
function readStoredRecord(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}
function persistRecord(key: string, value: Record<string, string>) {
  if (typeof window !== "undefined")
    window.localStorage.setItem(key, JSON.stringify(value));
}
function readProductLaunchSession(): ProductLaunchSessionV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PRODUCT_LAUNCH_SESSION_STORAGE_KEY) ?? "null",
    );
    return parsed && typeof parsed === "object"
      ? (parsed as ProductLaunchSessionV2)
      : null;
  } catch {
    return null;
  }
}
function persistProductLaunchSession(session: ProductLaunchSessionV2) {
  if (typeof window !== "undefined")
    window.localStorage.setItem(
      PRODUCT_LAUNCH_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
}
function clearProductLaunchSession() {
  if (typeof window === "undefined") return;
  const exactKeys = [
    PRODUCT_LAUNCH_SESSION_STORAGE_KEY,
    UPLOAD_REQUEST_ID_STORAGE_KEY,
    PRICE_REQUEST_ID_STORAGE_KEY,
    LAST_ROW_EXPRESSION_STORAGE_KEY,
    KEYWORD_SEED_STORAGE_KEY,
    MANUAL_WIZARD_STORAGE_KEY,
    MANUAL_CANDIDATES_STORAGE_KEY,
    KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY,
  ];
  const localPrefixes = [
    SEED_KEYWORDS_STORAGE_PREFIX,
    MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX,
    MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX,
  ];
  exactKeys.forEach((key) => window.localStorage.removeItem(key));
  removeStorageKeysByPrefix(window.localStorage, localPrefixes);
  window.sessionStorage.removeItem(KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY);
  removeStorageKeysByPrefix(window.sessionStorage, ["productLaunchFlow"]);
}
function removeStorageKeysByPrefix(storage: Storage, prefixes: string[]) {
  for (const key of Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => !!key)) {
    if (prefixes.some((prefix) => key.startsWith(prefix)))
      storage.removeItem(key);
  }
}
function deriveLaunchStage({
  uploadActionsResult,
  uploadRowsCount,
  priceActionsResult,
  keywordRunsResult,
  keywordApplyState,
  finalPriceActionsResult,
  manualCandidatesReady,
}: {
  uploadActionsResult: UploadActionsResult | null;
  uploadRowsCount: number;
  priceActionsResult: PriceActionsResult | null;
  keywordRunsResult: KeywordRunsResult | null;
  keywordApplyState: KeywordApplyState | null;
  finalPriceActionsResult: PriceActionsResult | null;
  manualCandidatesReady?: boolean;
}) {
  if (!isSuccessfulUploadResult(uploadActionsResult, uploadRowsCount))
    return "상품업로드";
  if (!isSuccessfulPriceResult(priceActionsResult)) return "가격설정";
  if (
    !isFinalKeywordRuns(keywordRunsResult) &&
    keywordApplyState?.dryRunStatus !== "success"
  )
    return manualCandidatesReady === false
      ? "후보 입력 대기"
      : "키워드 dry_run";
  if (
    keywordApplyState?.dryRunStatus === "success" &&
    !isKeywordRealApplySuccess(keywordApplyState)
  )
    return "실제 반영 대기";
  if (
    isKeywordRealApplySuccess(keywordApplyState) &&
    !isSuccessfulPriceResult(finalPriceActionsResult)
  )
    return "가격 최종 재적용";
  return "출시 완료";
}
function getRequestIdForStage(
  stage: string,
  ids: {
    uploadRequestId: string;
    priceRequestId: string;
    keywordRequestId: string;
    keywordDryRunRequestId: string;
    keywordRealApplyRequestId: string;
    finalPriceRequestId: string;
  },
) {
  if (stage === "상품업로드") return ids.uploadRequestId;
  if (stage === "가격설정") return ids.priceRequestId;
  if (stage === "키워드 dry_run")
    return ids.keywordDryRunRequestId || ids.keywordRequestId;
  if (stage === "실제 반영 대기")
    return (
      ids.keywordRealApplyRequestId ||
      ids.keywordDryRunRequestId ||
      ids.keywordRequestId
    );
  if (stage === "가격 최종 재적용" || stage === "출시 완료")
    return ids.finalPriceRequestId;
  return "";
}

type PriceIssueState = {
  kind: "ok" | "critical" | "unsupported" | "unknown";
  count: number;
  label: string;
};

function getPriceIssueState(
  result: PriceActionsResult | null,
): PriceIssueState {
  const summary = result?.summary;
  if (!summary) return { kind: "unknown", count: 0, label: "확인 전" };
  const visibleUnrepaired = Number(summary.visible_price_unrepaired_count ?? 0);
  const missingPrice = Number(summary.missing_price_count ?? 0);
  const count = visibleUnrepaired + missingPrice;
  if (count > 0) return { kind: "critical", count, label: "가격 확인 필요" };
  if (summary.verification_supported === false)
    return { kind: "unsupported", count: 0, label: "가격 화면 검증 필요" };
  return { kind: "ok", count: 0, label: "확인 완료" };
}

function getKeywordWarningCount(state: KeywordApplyState | null) {
  return state?.warningCount ?? 0;
}

function getLaunchBoardIssueCount({
  priceIssueState,
  uploadRows,
  goodsKeys,
  titleTargetCount,
  keywordApplyState,
  cockpit,
}: {
  priceIssueState: PriceIssueState;
  uploadRows: ProductLaunchUploadRow[];
  goodsKeys: string[];
  titleTargetCount: number;
  keywordApplyState: KeywordApplyState | null;
  cockpit: ReturnType<typeof buildCockpit>;
}) {
  const missingProductGroupCount = Object.values(
    buildGoodsKeyGroupMap(uploadRows),
  ).filter((metadata) => metadata.product_group_status !== "registered").length;
  const titleCoverageMissingCount = Math.max(
    0,
    expectedLaunchApplyCount(goodsKeys, buildGoodsKeyGroupMap(uploadRows)) -
      titleTargetCount,
  );
  const failedDryRunOrApplyCount = [
    keywordApplyState?.dryRunStatus,
    keywordApplyState?.realApplyStatus,
  ].filter((status) => status === "failed").length;
  const actualApplyFailedCount = keywordApplyState?.failedCount ?? 0;
  return (
    priceIssueState.count +
    missingProductGroupCount +
    titleCoverageMissingCount +
    failedDryRunOrApplyCount +
    actualApplyFailedCount +
    (cockpit.primaryAction === "failed" ? 1 : 0) +
    (keywordApplyState?.warningCount ?? 0)
  );
}

function getUploadCounts(
  result: UploadActionsResult | null,
  rows: ProductLaunchUploadRow[],
  rowsWithGoodsKey: ProductLaunchUploadRow[],
) {
  return {
    targetRows: rows.length,
    goodsKeyCount: rowsWithGoodsKey.length,
    failedRows: rows.filter(isFailedUploadRow).length,
    duplicateRows: rows.filter(isDuplicatePtnGoodsCdError).length,
  };
}
function getPriceCounts(
  result: PriceActionsResult | null,
  targetGoodsKeys: number,
) {
  const summary = result?.summary;
  return {
    targetGoodsKeys,
    okCount: Number(summary?.ok_count ?? 0),
    failCount: Number(summary?.failed_count ?? summary?.fail_count ?? 0),
  };
}
function getKeywordSummary(
  result: KeywordRunsResult | null,
  targetCount: number,
) {
  const latest = result?.runs?.[0];
  const artifact = latest?.artifacts?.find(
    (item) => item.expected && !item.expired,
  );
  const failed = hasKeywordFailure(result);
  return {
    targetCount,
    artifact,
    artifactState: artifact
      ? "ready"
      : latest?.status === "queued" || latest?.status === "in_progress"
        ? "waiting"
        : failed
          ? "missing"
          : "not checked",
    reviewPendingCount: artifact ? 1 : 0,
    failureReason:
      failed && !artifact
        ? "키워드 결과 파일이 아직 없습니다. 실행 중이거나 실패했을 수 있습니다."
        : "-",
  };
}
function isFinalPriceResult(result: PriceActionsResult | null) {
  if (!result) return false;
  const status = String(
    result.summary?.status ?? result.status ?? "",
  ).toLowerCase();
  const conclusion = String(result.runConclusion ?? "").toLowerCase();
  return (
    ["success", "failed", "failure", "error"].includes(status) ||
    ["success", "failure", "cancelled", "timed_out"].includes(conclusion)
  );
}
function isSuccessfulPriceResult(result: PriceActionsResult | null) {
  const status = String(
    result?.summary?.status ?? result?.status ?? "",
  ).toLowerCase();
  const conclusion = String(result?.runConclusion ?? "").toLowerCase();
  return status === "success" || conclusion === "success";
}
function isAutopilotSafePriceResult(result: PriceActionsResult | null) {
  if (!result) return false;
  const summary = result.summary;
  const status = String(summary?.status ?? result.status ?? "").toLowerCase();
  const conclusion = String(result.runConclusion ?? "").toLowerCase();
  const failedCount = Number(summary?.failed_count ?? summary?.fail_count ?? 0);
  const missingPriceCount = Number(summary?.missing_price_count ?? 0);
  const missingMallRowCount = Number(summary?.missing_mall_row_count ?? 0);
  const mismatchCount = Number(summary?.mismatch_count ?? 0);
  if (
    ["failed", "partial_failure", "failure", "error"].includes(status) ||
    ["failure", "cancelled", "timed_out"].includes(conclusion)
  )
    return false;
  if (
    missingPriceCount > 0 ||
    missingMallRowCount > 0 ||
    mismatchCount > 0 ||
    failedCount > 0
  )
    return false;
  const verificationUnavailableButApiComplete =
    status === "success" &&
    summary?.verification_supported === false &&
    Number(summary?.api_success_count ?? 0) ===
      Number(summary?.required_update_count ?? -1);
  return (
    status === "success" ||
    conclusion === "success" ||
    verificationUnavailableButApiComplete
  );
}
function hasPriceFailure(result: PriceActionsResult | null) {
  const status = String(
    result?.summary?.status ?? result?.status ?? "",
  ).toLowerCase();
  const conclusion = String(result?.runConclusion ?? "").toLowerCase();
  return (
    ["failed", "partial_failure", "failure", "error"].includes(status) ||
    ["failure", "cancelled", "timed_out"].includes(conclusion)
  );
}
function isSuccessfulUploadResult(
  result: UploadActionsResult | null,
  rowsWithGoodsKeyCount: number,
) {
  return (
    isFinalUploadPollingResult(result, rowsWithGoodsKeyCount) &&
    !hasUploadFailure(result) &&
    rowsWithGoodsKeyCount > 0
  );
}
function hasUploadFailure(result: UploadActionsResult | null) {
  return (
    isConfirmedUploadFailure(result) ||
    getUploadSummaryStatus(result) === "failed" ||
    getUploadSummaryStatus(result) === "partial_failure"
  );
}
function isKeywordRunning(result: KeywordRunsResult | null) {
  const status = result?.runs?.[0]?.status;
  return status === "queued" || status === "in_progress";
}
function hasKeywordFailure(result: KeywordRunsResult | null) {
  const run = result?.runs?.[0];
  return (
    run?.status === "completed" &&
    ["failure", "cancelled", "timed_out"].includes(
      String(run.conclusion ?? ""),
    ) &&
    !run.artifacts?.some((artifact) => artifact.expected && !artifact.expired)
  );
}
function isFinalKeywordRuns(result: KeywordRunsResult | null) {
  const run = result?.runs?.[0];
  return (
    !!run &&
    (hasKeywordFailure(result) ||
      !!run.artifacts?.some(
        (artifact) => artifact.expected && !artifact.expired,
      ))
  );
}
function buildCockpit(state: {
  hasUploadRequest: boolean;
  uploadActive: boolean;
  uploadSuccess: boolean;
  uploadFailed: boolean;
  priceActive: boolean;
  priceSuccess: boolean;
  priceFailed: boolean;
  keywordActive: boolean;
  keywordSuccess: boolean;
  keywordFailed: boolean;
}) {
  const steps: CockpitStep[] = [
    {
      name: "상품업로드",
      state: state.uploadFailed
        ? "failed"
        : state.uploadActive
          ? "checking"
          : state.uploadSuccess
            ? "success"
            : "waiting",
      action: state.uploadSuccess
        ? "가격설정 시작"
        : state.uploadActive
          ? "상품업로드 결과 확인 중..."
          : "상품업로드 시작",
      message: state.uploadSuccess
        ? "goods_key가 준비되었습니다."
        : state.uploadActive
          ? "중복 클릭 없이 자동 확인합니다."
          : "행 번호 입력 후 시작하세요.",
    },
    {
      name: "가격설정",
      state: state.priceFailed
        ? "failed"
        : state.priceActive
          ? "checking"
          : state.priceSuccess
            ? "success"
            : state.uploadSuccess
              ? "action"
              : "waiting",
      action: state.priceSuccess
        ? "상품명/검색어 검토 시작"
        : state.priceActive
          ? "가격설정 결과 확인 중..."
          : "가격설정 시작",
      message: state.uploadSuccess
        ? "업로드 성공 후 실행할 수 있습니다."
        : "업로드 완료 후 활성화됩니다.",
    },
    {
      name: "키워드/상품명 준비",
      state: state.keywordFailed
        ? "failed"
        : state.keywordActive
          ? "running"
          : state.keywordSuccess
            ? "action"
            : state.priceSuccess
              ? "action"
              : "waiting",
      action: state.keywordSuccess
        ? "키워드 검토 시작"
        : state.keywordActive
          ? "키워드 결과 확인 중..."
          : "상품명/검색어 검토 시작",
      message: state.keywordSuccess
        ? "검토 진행 중 · 승인된 행이 있으면 반영 준비으로 이동"
        : state.keywordActive
          ? "검토 준비가 진행 중입니다. 결과가 준비되면 자동으로 표시됩니다."
          : state.keywordFailed
            ? "검토 준비가 실패했습니다."
            : "사전 검토 결과만 준비합니다.",
    },
    {
      name: "키워드 결과 검토",
      state: state.keywordSuccess ? "action" : "waiting",
      action: state.keywordSuccess
        ? "키워드 검토 시작"
        : "artifact 생성 후 열 수 있습니다.",
      message: state.keywordSuccess
        ? "검토 진행 중 · 승인된 행이 있으면 반영 준비으로 이동"
        : "artifact 생성 후 열 수 있습니다.",
    },
    {
      name: "최종 확인",
      state: state.keywordSuccess ? "action" : "waiting",
      action: "최종 확인",
      message: "마켓전송은 수동으로 진행합니다.",
    },
  ];
  let primaryAction:
    | "upload"
    | "price"
    | "keyword"
    | "review"
    | "failed"
    | "wait" = "upload";
  if (state.uploadFailed || state.priceFailed || state.keywordFailed)
    primaryAction = "failed";
  else if (state.uploadActive || state.priceActive || state.keywordActive)
    primaryAction = "wait";
  else if (!state.uploadSuccess) primaryAction = "upload";
  else if (!state.priceSuccess) primaryAction = "price";
  else if (!state.keywordSuccess) primaryAction = "keyword";
  else primaryAction = "review";
  const currentStage =
    steps.find(
      (step) =>
        step.state === "failed" ||
        step.state === "running" ||
        step.state === "checking" ||
        step.state === "action",
    )?.name ?? "상품업로드";
  const nextAction =
    primaryAction === "failed"
      ? "문제가 발생했습니다. 실패 원인을 확인하세요."
      : state.uploadActive
        ? "상품업로드 결과를 확인하는 중입니다. 잠시만 기다려주세요."
        : state.priceActive
          ? "진행 중입니다. 현재 단계: 가격설정. 자동으로 다음 단계로 이동합니다. 가격설정 결과 확인 중..."
          : state.keywordActive
            ? "진행 중입니다. 현재 단계: 키워드/상품명 준비. 자동으로 다음 단계로 이동합니다. 키워드 dry_run 결과 확인 중..."
            : primaryAction === "upload"
              ? "행 번호를 입력하고 상품업로드를 시작하세요."
              : primaryAction === "price"
                ? "상품업로드가 완료되었습니다. 이제 가격설정을 시작하세요."
                : primaryAction === "keyword"
                  ? "가격설정이 완료되었습니다. 이제 키워드 dry_run을 시작하세요."
                  : primaryAction === "review"
                    ? "키워드 결과가 준비되었습니다. 검토 화면에서 확인하세요."
                    : (steps.find((step) => step.name === currentStage)
                        ?.action ?? "상품업로드 시작");
  return { steps, primaryAction, currentStage, nextAction };
}
