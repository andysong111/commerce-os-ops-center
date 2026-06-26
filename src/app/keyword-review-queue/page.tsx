"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ChangeEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { OperationStatusCard, formatKeywordApplyRunPhase, type OperationStatusState } from "@/components/OperationStatusCard";
import { createEngineArtifactReviewSummary } from "@/lib/engineArtifactReview";
import {
  createReviewedRows,
  exportReviewedQueue,
  parseKeywordMvpCsv,
  type KeywordQueueClassification,
  type ReviewedKeywordRow,
} from "@/lib/keywordReviewQueue";
import { KEYWORD_REVIEW_QUEUE_SAMPLE_CSV } from "@/lib/keywordReviewQueueSample";
import {
  buildKeywordShoplingPayloadPreview,
  exportKeywordPayloadPreview,
  type KeywordPayloadPreviewResult,
} from "@/lib/keywordReviewPayloadPreview";
import {
  buildCompactKeywordApplyExecutionPlan,
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  exportKeywordExecutionPlan,
  formatKeywordExecutionPreflightLabels,
  type KeywordExecutionPreflightResult,
} from "@/lib/keywordReviewExecutionPreflight";

const DEFAULT_MALL_KEY_STORAGE_KEY = "keywordReviewQueue.defaultMallKey";
const DEFAULT_MALL_KEY = "SMALL_00004";

const APPLY_RESULT_LABELS: Record<string, string> = {
  goods_key: "상품번호",
  mall_key: "쇼핑몰",
  title_update_status: "상품명 반영 상태",
  site_srch_update_status: "검색어 반영 상태",
  code: "코드",
  msg: "메시지",
  dry_run: "dry_run 여부",
  warning_flags: "경고",
  reasons: "사유",
  mode: "모드",
  status: "상태",
  input_item_count: "입력 행 수",
  valid_item_count: "유효 행 수",
  blocked_item_count: "차단 행 수",
  applied_item_count: "반영 행 수",
  failed_item_count: "실패 행 수",
  warnings: "경고",
};

const APPLY_RESULT_VALUE_LABELS: Record<string, string> = {
  dry_run: "dry_run 확인",
  success: "성공",
  blocked: "차단",
  failed: "실패",
  partial_failure: "일부 실패",
  true: "예",
  false: "아니오",
  underfilled_search_keywords: "검색어가 10개 미만입니다. 현재는 경고입니다.",
};

const KEYWORD_APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING";
const KEYWORD_APPLY_DRY_RUN_REQUEST_ID_KEY = "keywordReviewQueue.keywordApplyDryRunRequestId";
const KEYWORD_APPLY_REAL_REQUEST_ID_KEY = "keywordReviewQueue.keywordApplyRequestId";

function formatApplyResultValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatApplyResultValue).join(", ");
  const raw = String(value ?? "—");
  return APPLY_RESULT_VALUE_LABELS[raw] ?? raw;
}

const SHOPLING_MALL_OPTIONS = [
  ["SMALL_00001", "옥션"],
  ["SMALL_00002", "지마켓"],
  ["SMALL_00003", "11번가"],
  ["SMALL_00004", "스마트스토어"],
  ["SMALL_00005", "GS SHOP"],
  ["SMALL_00012", "쿠팡"],
  ["SMALL_00014", "카페24(1.9)"],
  ["SMALL_00019", "신세계몰"],
  ["SMALL_00069", "도매꾹"],
  ["SMALL_00071", "도매창고"],
  ["SMALL_00101", "카카오톡 스토어"],
  ["SMALL_00107", "오너클랜"],
  ["SMALL_00112", "에이블리"],
  ["SMALL_00116", "셀파"],
  ["SMALL_00130", "롯데ON"],
  ["SMALL_00165", "셀링콕"],
  ["SMALL_00168", "인큐텐"],
  ["SMALL_00179", "투비즈온"],
  ["SMALL_00180", "도매아토즈"],
  ["SMALL_00186", "AliExpress"],
  ["SMALL_00188", "셀리어스"],
  ["SMALL_00190", "도매의신"],
  ["SMALL_00191", "TEMU"],
  ["SMALL_00194", "토스쇼핑"],
] as const;

function fallbackSiteSrchFromTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

type ViewMode = "sheet" | "card";
type SheetFilter =
  | "all"
  | "manual_review"
  | "auto_apply_candidate"
  | "hold"
  | "approved"
  | "blocked_risk"
  | "missing_keywords"
  | "missing_title";

type ImportedArtifactPayload = {
  kind: "keyword_engine";
  source?: { repo?: string; runId?: number; artifactId?: number };
  files: Record<string, string>;
  generatedSourceFiles?: string[];
  requiresHumanReview: true;
};

function readImportedArtifactHandoff(): ImportedArtifactPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(
    "opsCenter.keywordEngine.importedArtifact.v1",
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ImportedArtifactPayload>;
    if (
      parsed.kind === "keyword_engine" &&
      parsed.requiresHumanReview === true &&
      parsed.files
    ) {
      return parsed as ImportedArtifactPayload;
    }
  } catch {
    return null;
  }
  return null;
}

const classificationLabels: Record<KeywordQueueClassification, string> = {
  auto_apply_candidate: "승인 가능",
  manual_review: "검토 필요",
  blocked_risk: "위험/차단",
};

const classificationStyles: Record<KeywordQueueClassification, string> = {
  auto_apply_candidate: "bg-emerald-50 text-emerald-700",
  manual_review: "bg-amber-50 text-amber-700",
  blocked_risk: "bg-red-50 text-red-700",
};

function createRowsFromImportedArtifact(
  artifact: ImportedArtifactPayload | null,
) {
  if (!artifact) return [];
  return createReviewedRows([
    ...parseKeywordMvpCsv(
      String(artifact.files["keyword_mvp_approval_sheet.csv"] ?? ""),
    ),
    ...parseKeywordMvpCsv(
      String(artifact.files["keyword_mvp_manual_candidates.csv"] ?? ""),
    ),
  ]);
}

const reviewSummary = createEngineArtifactReviewSummary({
  source: "keyword-engine-soon",
  statuses: [
    "imported",
    "needs_review",
    "preview_ready",
    "export_ready",
    "execution_disabled",
  ],
});

export default function KeywordReviewQueuePage() {
  const [importedArtifact, setImportedArtifact] =
    useState<ImportedArtifactPayload | null>(() =>
      readImportedArtifactHandoff(),
    );
  const [approvalCsv, setApprovalCsv] = useState(() =>
    String(importedArtifact?.files?.["keyword_mvp_approval_sheet.csv"] ?? ""),
  );
  const [manualCsv, setManualCsv] = useState(() =>
    String(
      importedArtifact?.files?.["keyword_mvp_manual_candidates.csv"] ?? "",
    ),
  );
  const [summaryMarkdown, setSummaryMarkdown] = useState(() =>
    String(importedArtifact?.files?.["keyword_mvp_summary.md"] ?? ""),
  );
  const [rows, setRows] = useState<ReviewedKeywordRow[]>(() =>
    createRowsFromImportedArtifact(importedArtifact),
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    createRowsFromImportedArtifact(importedArtifact).length > 5
      ? "sheet"
      : "card",
  );
  const [selectedRows, setSelectedRows] = useState<Set<number>>(
    () => new Set(),
  );
  const [sheetFilter, setSheetFilter] = useState<SheetFilter>("all");
  const [sheetSearch, setSheetSearch] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(
    () => new Set(),
  );
  const [copyStatus, setCopyStatus] = useState("");
  const [payloadPreview, setPayloadPreview] =
    useState<KeywordPayloadPreviewResult | null>(null);
  const [preflightResult, setPreflightResult] =
    useState<KeywordExecutionPreflightResult | null>(null);
  const [allowedMallKeys, setAllowedMallKeys] = useState(DEFAULT_MALL_KEY);
  const [maxRows, setMaxRows] = useState("20");
  const [alreadyAppliedGoodsKeys, setAlreadyAppliedGoodsKeys] = useState("");
  const [keywordApplyMaxRows, setKeywordApplyMaxRows] = useState("20");
  const [keywordApplyDryRunStatus, setKeywordApplyDryRunStatus] = useState("");
  const [keywordApplyRealStatus, setKeywordApplyRealStatus] = useState("");
  const [keywordApplyDryRunResult, setKeywordApplyDryRunResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [keywordApplyRealResult, setKeywordApplyRealResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [defaultMallKey, setDefaultMallKey] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_MALL_KEY;
    return (
      window.localStorage.getItem(DEFAULT_MALL_KEY_STORAGE_KEY) ||
      DEFAULT_MALL_KEY
    );
  });
  const [mallKeyFillStatus, setMallKeyFillStatus] = useState("");

  function changeDefaultMallKey(value: string) {
    const previousDefaultMallKey = defaultMallKey;
    setDefaultMallKey(value);
    setAllowedMallKeys((current) => {
      const normalizedCurrent = current.trim();
      if (!normalizedCurrent || normalizedCurrent === previousDefaultMallKey) {
        return value;
      }
      return current;
    });
    setPreflightResult(null);
    window.localStorage.setItem(DEFAULT_MALL_KEY_STORAGE_KEY, value);
  }
  function loadImportedArtifact() {
    if (!importedArtifact?.files) return;
    setApprovalCsv(
      String(importedArtifact.files["keyword_mvp_approval_sheet.csv"] ?? ""),
    );
    setManualCsv(
      String(importedArtifact.files["keyword_mvp_manual_candidates.csv"] ?? ""),
    );
    setSummaryMarkdown(
      String(importedArtifact.files["keyword_mvp_summary.md"] ?? ""),
    );
    setRows([]);
    setPayloadPreview(null);
    setPreflightResult(null);
    const parsed = [
      ...parseKeywordMvpCsv(
        String(importedArtifact.files["keyword_mvp_approval_sheet.csv"] ?? ""),
      ),
      ...parseKeywordMvpCsv(
        String(
          importedArtifact.files["keyword_mvp_manual_candidates.csv"] ?? "",
        ),
      ),
    ];
    const reviewedRows = createReviewedRows(parsed);
    setRows(reviewedRows);
    setSelectedRows(new Set());
    setViewMode(reviewedRows.length > 5 ? "sheet" : "card");
    setCopyStatus("키워드 결과물을 가져왔습니다. 검토 목록을 불러왔습니다.");
  }

  const counts = useMemo(
    () => ({
      auto: rows.filter((row) => row.classification === "auto_apply_candidate")
        .length,
      manual: rows.filter((row) => row.classification === "manual_review")
        .length,
      blocked: rows.filter((row) => row.classification === "blocked_risk")
        .length,
      total: rows.length,
    }),
    [rows],
  );
  const hasImportedArtifact = Boolean(importedArtifact);
  const importedRowsAreEmpty = hasImportedArtifact && counts.total === 0;

  function resetReviewLocalState() {
    setRows([]);
    setSelectedRows(new Set());
    setSheetFilter("all");
    setSheetSearch("");
    setExpandedRows(new Set());
    setCopyStatus("");
    setPayloadPreview(null);
    setPreflightResult(null);
    setImportedArtifact(null);
    setApprovalCsv("");
    setManualCsv("");
    setSummaryMarkdown("");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(
        "opsCenter.keywordEngine.importedArtifact.v1",
      );
    }
  }

  function clearCurrentReviewList() {
    if (
      window.confirm(
        "현재 불러온 키워드 검토 목록을 삭제하시겠습니까? 샵플링에는 영향이 없고, 이 브라우저의 검토 화면만 비워집니다.",
      )
    ) {
      resetReviewLocalState();
    }
  }

  function deleteReviewRows(indexes: number[]) {
    const targetIndexes = new Set(indexes);
    setRows((current) =>
      current.filter((_, index) => !targetIndexes.has(index)),
    );
    setSelectedRows(new Set());
    setExpandedRows(new Set());
    setPayloadPreview(null);
    setPreflightResult(null);
    setCopyStatus("");
  }

  function previewQueue() {
    const parsed = [
      ...parseKeywordMvpCsv(approvalCsv),
      ...parseKeywordMvpCsv(manualCsv),
    ];
    const reviewedRows = createReviewedRows(parsed);
    setRows(reviewedRows);
    setSelectedRows(new Set());
    setViewMode(reviewedRows.length > 5 ? "sheet" : "card");
    setCopyStatus("");
    setPayloadPreview(null);
    setPreflightResult(null);
  }

  function updateRow(
    index: number,
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "editedTitle" | "editedSiteSrch" | "editedMallKey" | "reviewStatus"
      >
    >,
  ) {
    setPayloadPreview(null);
    setPreflightResult(null);
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...update } : row,
      ),
    );
  }

  function updateRows(
    indexes: number[],
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "reviewStatus" | "editedMallKey" | "editedSiteSrch"
      >
    >,
  ) {
    setPayloadPreview(null);
    setPreflightResult(null);
    const targetIndexes = new Set(indexes);
    setRows((current) =>
      current.map((row, rowIndex) =>
        targetIndexes.has(rowIndex) ? { ...row, ...update } : row,
      ),
    );
  }

  function approveFirstCandidatePerGoodsKey() {
    setPayloadPreview(null);
    setPreflightResult(null);
    const seen = new Set<string>();
    setRows((current) =>
      current.map((row) => {
        const goodsKey = row.goodsKey.trim();
        if (row.classification === "blocked_risk") return row;
        if (!goodsKey || !row.recommendedTitle.trim()) return row;
        if (!seen.has(goodsKey)) {
          seen.add(goodsKey);
          return {
            ...row,
            reviewStatus: "approved",
            editedMallKey:
              row.editedMallKey.trim() || row.mallKey.trim() || defaultMallKey,
            editedSiteSrch:
              row.editedSiteSrch.trim() ||
              row.recommendedSiteSrch.trim() ||
              fallbackSiteSrchFromTitle(
                row.editedTitle || row.recommendedTitle,
              ),
          };
        }
        return { ...row, reviewStatus: "hold" };
      }),
    );
    setMallKeyFillStatus(
      "상품별 첫 후보에 쇼핑몰과 임시 검색어를 자동으로 채웠습니다.",
    );
  }

  function fillMallKeyForRows(approvedOnly: boolean) {
    setPayloadPreview(null);
    setPreflightResult(null);
    setRows((current) =>
      current.map((row) => {
        if (row.classification === "blocked_risk") return row;
        if (approvedOnly && row.reviewStatus !== "approved") return row;
        return row.mallKey.trim() || row.editedMallKey.trim()
          ? row
          : { ...row, editedMallKey: defaultMallKey };
      }),
    );
    setMallKeyFillStatus("선택한 쇼핑몰을 검토 행에 적용했습니다.");
  }

  function fillEmptySiteSrch() {
    setPayloadPreview(null);
    setPreflightResult(null);
    setRows((current) =>
      current.map((row) => {
        const finalSiteSrch =
          row.editedSiteSrch.trim() || row.recommendedSiteSrch.trim();
        if (finalSiteSrch) return row;
        return {
          ...row,
          editedSiteSrch: fallbackSiteSrchFromTitle(
            row.editedTitle || row.recommendedTitle,
          ),
        };
      }),
    );
  }

  function approveAllReviewNeededRows() {
    if (
      !window.confirm(
        "검토 필요 항목을 모두 승인하시겠습니까? 샵플링에는 자동 반영되지 않고 검토 결과만 변경됩니다.",
      )
    ) {
      return;
    }
    updateRows(
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.classification === "manual_review")
        .map(({ index }) => index),
      { reviewStatus: "approved" },
    );
  }

  function loadFile(
    event: ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(setter);
  }

  const exportText = exportReviewedQueue(rows);

  return (
    <>
      <PageHeader
        title="키워드 결과 검토"
        description="키워드 엔진이 만든 상품명과 검색어 후보를 확인하고 승인합니다."
      />

      <BeginnerGuide />

      <EngineSafetyBanner />

      <WhatThisPageDoes />

      {importedArtifact ? (
        <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
          <h2 className="font-semibold">키워드 결과를 불러왔습니다.</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <span>전체: {counts.total}개</span>
            <span>승인 가능: {counts.auto}개</span>
            <span>검토 필요: {counts.manual}개</span>
            <span>위험/차단: {counts.blocked}개</span>
          </div>
          <p className="mt-3">
            아래 항목을 하나씩 확인하고 승인 또는 보류를 선택하세요.
          </p>
          {importedRowsAreEmpty ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 font-semibold text-amber-800">
              가져온 파일에 검토할 행이 없습니다. artifact 내용을 확인해 주세요.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadImportedArtifact}
              className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
            >
              결과 다시 불러오기
            </button>
            {rows.length > 0 ? (
              <button
                type="button"
                onClick={clearCurrentReviewList}
                className="rounded-lg border border-emerald-700 bg-white px-4 py-2 text-sm font-semibold text-emerald-800"
              >
                현재 검토 목록 삭제
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 shadow-sm">
          <h2 className="font-semibold">
            아직 가져온 키워드 결과물이 없습니다.
          </h2>
          <p className="mt-1">
            일반 흐름은 키워드 엔진 실행기에서 상품번호를 입력한 뒤, ‘결과
            가져오기 및 검토 시작’을 누르는 것입니다.
          </p>
          <Link
            href="/keyword-engine-runner"
            className="mt-3 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
          >
            키워드 엔진 실행기로 이동
          </Link>
        </section>
      )}

      <details
        open={!hasImportedArtifact}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <summary className="cursor-pointer font-semibold text-slate-950">
          직접 파일 넣기
        </summary>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          보통은 사용할 필요 없습니다. 키워드 엔진 실행기에서 결과를 가져온 경우
          자동으로 불러옵니다. 필요하면 CSV를 직접 붙여넣거나 업로드할 수
          있습니다.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ImportField
            id="approval-csv"
            label="keyword_mvp_approval_sheet.csv"
            required
            value={approvalCsv}
            onChange={setApprovalCsv}
            onFile={(event) => loadFile(event, setApprovalCsv)}
          />
          <ImportField
            id="manual-csv"
            label="keyword_mvp_manual_candidates.csv (optional)"
            value={manualCsv}
            onChange={setManualCsv}
            onFile={(event) => loadFile(event, setManualCsv)}
          />
        </div>
        <label
          htmlFor="summary-markdown"
          className="mt-4 block text-xs font-semibold text-slate-600"
        >
          keyword_mvp_summary.md (optional)
        </label>
        <textarea
          id="summary-markdown"
          value={summaryMarkdown}
          onChange={(event) => setSummaryMarkdown(event.target.value)}
          className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          placeholder="# Keyword MVP summary"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={previewQueue}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            검토 목록 만들기
          </button>
          <button
            type="button"
            onClick={() => setApprovalCsv(KEYWORD_REVIEW_QUEUE_SAMPLE_CSV)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            샘플 CSV 불러오기
          </button>
        </div>
      </details>

      <section
        className="my-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Queue summary"
      >
        <SummaryCard label="승인 가능" value={counts.auto} />
        <SummaryCard label="검토 필요" value={counts.manual} />
        <SummaryCard label="위험/차단" value={counts.blocked} />
        <SummaryCard label="전체" value={counts.total} />
      </section>

      <section className="my-6 rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">적용 쇼핑몰 선택</h2>
        <p className="mt-1 text-sm text-slate-600">
          mall_key는 샵플링 쇼핑몰 코드입니다. 도매1/소매1 상품그룹과는
          다릅니다. 먼저 테스트할 쇼핑몰 1개를 선택하세요.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-600">
            쇼핑몰 코드
            <select
              value={defaultMallKey}
              onChange={(event) => changeDefaultMallKey(event.target.value)}
              className="mt-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
            >
              {SHOPLING_MALL_OPTIONS.map(([key, label]) => (
                <option key={key} value={key}>
                  {key} {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => fillMallKeyForRows(false)}
            className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-700"
          >
            선택 쇼핑몰 일괄 적용
          </button>
          <button
            type="button"
            onClick={() => fillMallKeyForRows(true)}
            className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700"
          >
            승인된 행에 쇼핑몰 적용
          </button>
          <button
            type="button"
            onClick={fillEmptySiteSrch}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            빈 검색어 자동 채우기
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          검색어가 비어 있으면 상품명을 임시 검색어로 사용합니다. 품질 개선은
          이후 단계에서 진행합니다.
        </p>
        {mallKeyFillStatus ? (
          <p className="mt-2 text-xs font-semibold text-emerald-700">
            {mallKeyFillStatus}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold text-slate-950">검토 행</h2>
            <p className="mt-1 text-sm text-slate-600">
              승인/보류한 결과를 다음 단계로 넘기기 위해 복사합니다.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              현재 수정/승인/보류 상태가 복사됩니다.
            </p>
          </div>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => {
              void navigator.clipboard.writeText(exportText).then(() => {
                setCopyStatus("검토 결과를 복사했습니다.");
              });
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            검토 결과 복사
          </button>
          {copyStatus && (
            <p className="w-full text-right text-xs text-emerald-700">
              {copyStatus}
            </p>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <p>
              {hasImportedArtifact
                ? "검토할 키워드가 없습니다."
                : "아직 불러온 키워드 결과가 없습니다."}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Link
                href="/keyword-engine-runner"
                className="inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
              >
                키워드 엔진 실행기로 이동
              </Link>
              <a
                href="#approval-csv"
                className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                직접 파일 넣기
              </a>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap gap-2 border-b border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setViewMode("sheet")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${viewMode === "sheet" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
              >
                시트형 보기
              </button>
              <button
                type="button"
                onClick={() => setViewMode("card")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${viewMode === "card" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
              >
                카드형 보기
              </button>
            </div>
            {viewMode === "sheet" ? (
              <SheetReviewTable
                rows={rows}
                selectedRows={selectedRows}
                setSelectedRows={setSelectedRows}
                sheetFilter={sheetFilter}
                setSheetFilter={setSheetFilter}
                sheetSearch={sheetSearch}
                setSheetSearch={setSheetSearch}
                expandedRows={expandedRows}
                setExpandedRows={setExpandedRows}
                onUpdate={updateRow}
                onBulkApprove={() =>
                  updateRows([...selectedRows], { reviewStatus: "approved" })
                }
                onBulkHold={() =>
                  updateRows([...selectedRows], { reviewStatus: "hold" })
                }
                onApproveAllReviewNeeded={approveAllReviewNeededRows}
                onApproveFirstCandidatePerGoodsKey={
                  approveFirstCandidatePerGoodsKey
                }
                onClearSelection={() => setSelectedRows(new Set())}
                onDeleteRow={(index) => {
                  if (
                    window.confirm(
                      "이 행을 현재 검토 목록에서 삭제하시겠습니까?",
                    )
                  ) {
                    deleteReviewRows([index]);
                  }
                }}
                onBulkDelete={() => {
                  if (
                    selectedRows.size > 0 &&
                    window.confirm(
                      "선택한 항목을 현재 검토 목록에서 삭제하시겠습니까?",
                    )
                  ) {
                    deleteReviewRows([...selectedRows]);
                  }
                }}
              />
            ) : (
              <div className="divide-y divide-slate-200">
                {rows.map((row, index) => (
                  <ReviewRow
                    key={`${row.goodsKey}-${row.sourceRowIndex}-${index}`}
                    row={row}
                    onUpdate={(update) => updateRow(index, update)}
                    onDelete={() => {
                      if (
                        window.confirm(
                          "이 행을 현재 검토 목록에서 삭제하시겠습니까?",
                        )
                      ) {
                        deleteReviewRows([index]);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <PayloadPreviewSection
        rows={rows}
        result={payloadPreview}
        onGenerate={() => {
          setPayloadPreview(buildKeywordShoplingPayloadPreview(rows));
          setPreflightResult(null);
        }}
      />
      <ExecutionPreflightSection
        previewResult={payloadPreview}
        result={preflightResult}
        allowedMallKeys={allowedMallKeys}
        maxRows={maxRows}
        alreadyAppliedGoodsKeys={alreadyAppliedGoodsKeys}
        onAllowedMallKeysChange={(value) => {
          setAllowedMallKeys(value);
          setPreflightResult(null);
        }}
        onMaxRowsChange={(value) => {
          setMaxRows(value);
          setPreflightResult(null);
        }}
        onAlreadyAppliedGoodsKeysChange={(value) => {
          setAlreadyAppliedGoodsKeys(value);
          setPreflightResult(null);
        }}
        onRun={(config) =>
          setPreflightResult(
            buildKeywordExecutionPreflight(
              {
                previewResult: payloadPreview!,
                finalConfirmationText: "",
              },
              config,
            ),
          )
        }
      />
      <KeywordShoplingApplySection
        preflightResult={preflightResult}
        maxRows={keywordApplyMaxRows}
        dryRunStatusMessage={keywordApplyDryRunStatus}
        realStatusMessage={keywordApplyRealStatus}
        dryRunResult={keywordApplyDryRunResult}
        realResult={keywordApplyRealResult}
        onMaxRowsChange={setKeywordApplyMaxRows}
        onDryRunStatusChange={setKeywordApplyDryRunStatus}
        onRealStatusChange={setKeywordApplyRealStatus}
        onDryRunResultChange={setKeywordApplyDryRunResult}
        onRealResultChange={setKeywordApplyRealResult}
      />
    </>
  );
}

function BeginnerGuide() {
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-950">검토 순서</h2>
      <ol className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
        <li className="rounded-lg bg-slate-50 px-3 py-2">
          1. 추천 상품명 확인
        </li>
        <li className="rounded-lg bg-slate-50 px-3 py-2">2. 필요하면 수정</li>
        <li className="rounded-lg bg-slate-50 px-3 py-2">
          3. 승인 또는 보류 선택
        </li>
      </ol>
    </section>
  );
}

function EngineSafetyBanner() {
  return (
    <section className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
      <h2 className="font-semibold">안전 안내</h2>
      <p className="mt-1">
        이 화면에서는 키워드를 바로 적용하지 않습니다. 승인해도 샵플링에는 자동
        반영되지 않고, 검토 결과만 준비됩니다.
      </p>
      <details className="mt-3 rounded-lg border border-blue-100 bg-white/70 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-800">
          기술 정보 보기
        </summary>
        <p className="mt-2">
          외부 엔진 실행은 비활성화되어 있고 미리보기만 준비합니다. 이 화면은
          샵플링 API 호출이나 자동 적용을 수행하지 않습니다.
        </p>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          <Detail
            label="외부 엔진 실행"
            value={String(reviewSummary.safetyFlags.externalEngineExecution)}
          />
          <Detail
            label="미리보기 전용"
            value={String(reviewSummary.safetyFlags.previewOnly)}
          />
        </dl>
      </details>
    </section>
  );
}

function WhatThisPageDoes() {
  return (
    <details className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-semibold text-slate-950">
        도움말 보기
      </summary>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-700">
        <li>결과를 확인합니다.</li>
        <li>필요하면 상품명과 검색어를 수정합니다.</li>
        <li>승인 또는 보류를 선택합니다.</li>
      </ul>
    </details>
  );
}

function parseKeyList(value: string) {
  return value
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean);
}

function ExecutionPreflightSection({
  previewResult,
  result,
  allowedMallKeys,
  maxRows,
  alreadyAppliedGoodsKeys,
  onAllowedMallKeysChange,
  onMaxRowsChange,
  onAlreadyAppliedGoodsKeysChange,
  onRun,
}: {
  previewResult: KeywordPayloadPreviewResult | null;
  result: KeywordExecutionPreflightResult | null;
  allowedMallKeys: string;
  maxRows: string;
  alreadyAppliedGoodsKeys: string;
  onAllowedMallKeysChange: (value: string) => void;
  onMaxRowsChange: (value: string) => void;
  onAlreadyAppliedGoodsKeysChange: (value: string) => void;
  onRun: (config: typeof DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG) => void;
}) {
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: parseKeyList(allowedMallKeys),
    maxRows: Math.max(0, Number.parseInt(maxRows, 10) || 0),
    alreadyAppliedGoodsKeys: parseKeyList(alreadyAppliedGoodsKeys),
  };
  const executionPlan = result
    ? exportKeywordExecutionPlan(result, config)
    : "";
  const allItems = result
    ? [...result.eligibleItems, ...result.blockedItems].sort(
        (left, right) => left.source_row_index - right.source_row_index,
      )
    : [];

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4 sm:p-5">
        <h2 className="font-semibold text-slate-950">실행 전 최종 점검</h2>
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          미리보기 전용입니다. 이 단계에서는 샵플링 API를 실행하지 않습니다.
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            허용 쇼핑몰
            <textarea
              value={allowedMallKeys}
              onChange={(event) => onAllowedMallKeysChange(event.target.value)}
              className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
              placeholder="mall_key를 줄바꿈 또는 쉼표로 입력"
            />
            <span className="mt-1 block font-normal">
              허용 쇼핑몰은 위 ‘적용 쇼핑몰 선택’ 값으로 자동 설정됩니다.
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            이미 반영한 상품번호
            <textarea
              value={alreadyAppliedGoodsKeys}
              onChange={(event) =>
                onAlreadyAppliedGoodsKeysChange(event.target.value)
              }
              className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
              placeholder="goods_key를 줄바꿈 또는 쉼표로 입력"
            />
            <span className="mt-1 block font-normal">
              이미 반영한 goods_key를 입력하면 중복 실행을 막습니다.
            </span>
          </label>
        </div>
        <label className="mt-4 block max-w-xs text-xs font-semibold text-slate-600">
          최대 실행 행 수
          <input
            type="number"
            min="0"
            step="1"
            value={maxRows}
            onChange={(event) => onMaxRowsChange(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
          />
          <span className="mt-1 block font-normal">
            테스트는 1, 기본은 20입니다.
          </span>
        </label>
        <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          실행 전 점검은 미리보기 전용입니다. 실제 반영은 아래 ‘실제 샵플링 반영 실행’에서 확인문구 입력 후 진행됩니다.
        </p>
        <button
          type="button"
          disabled={!previewResult}
          onClick={() => onRun(config)}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          실행 전 점검
        </button>
      </div>

      {!result ? (
        <p className="p-8 text-center text-sm text-slate-500">
          샵플링 반영 미리보기를 생성한 뒤 실행 전 점검을 누르세요. 기본 쇼핑몰은 위에서 선택한 값이 자동 적용됩니다.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="실행 가능"
              value={result.summary.eligibleCount}
            />
            <SummaryCard label="차단됨" value={result.summary.blockedCount} />
            <SummaryCard
              label="이미 반영됨"
              value={result.summary.alreadyAppliedBlockedCount}
            />
            <SummaryCard
              label="쇼핑몰 제한"
              value={result.summary.mallKeyBlockedCount}
            />
            <SummaryCard
              label="중복 상품번호"
              value={result.summary.duplicateGoodsKeyCount}
            />
            <StatusCard
              label="최대 행 초과"
              value={result.summary.maxRowsExceeded}
            />
            <StatusCard
              label="최종 확인 필요"
              value={result.summary.requiresFinalConfirmation}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">상품번호</th>
                  <th className="px-3 py-2">쇼핑몰</th>
                  <th className="px-3 py-2">최종 상품명</th>
                  <th className="px-3 py-2">최종 검색어</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">차단 사유</th>
                  <th className="px-3 py-2">경고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {allItems.map((item) => (
                  <tr key={`${item.source_row_index}-${item.goods_key}`}>
                    <td className="px-3 py-3 align-top">
                      {item.goods_key || "—"}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.mall_key || "—"}
                    </td>
                    <td className="max-w-xs px-3 py-3 align-top">
                      {item.final_title || "—"}
                    </td>
                    <td className="max-w-sm px-3 py-3 align-top">
                      {item.final_site_srch || "—"}
                    </td>
                    <td
                      className={`px-3 py-3 align-top font-semibold ${
                        item.preflight_status === "eligible"
                          ? "text-emerald-700"
                          : "text-red-700"
                      }`}
                    >
                      {item.preflight_status === "eligible"
                        ? "실행 가능"
                        : "차단됨"}
                    </td>
                    <td className="min-w-56 px-3 py-3 align-top text-xs">
                      {formatKeywordExecutionPreflightLabels(item.block_reasons) || "—"}
                    </td>
                    <td className="min-w-56 px-3 py-3 align-top text-xs">
                      {formatKeywordExecutionPreflightLabels(item.preflight_warnings) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label
            htmlFor="execution-plan-json"
            className="mt-5 block text-xs font-semibold text-slate-600"
          >
            미리보기용 실행 계획 JSON
          </label>
          <textarea
            id="execution-plan-json"
            readOnly
            value={executionPlan}
            className="mt-1.5 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(executionPlan)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              실행 계획 복사
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  "keyword-execution-plan-preview.json",
                  executionPlan,
                  "application/json",
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              실행 계획 다운로드
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type ApplyRunMeta = { requestId?: string; phase?: string; state: OperationStatusState; runUrl?: string; runStatus?: string | null; runConclusion?: string | null; artifactName?: string; fetchedAt?: string; lastCheckedAt?: string; pollCount: number; isPolling?: boolean; message?: string };
const MAX_APPLY_POLLS = 18;
const APPLY_POLL_INTERVAL_MS = 5000;

function toOperationState(result: Record<string, unknown> | null, fallback: OperationStatusState = "idle"): OperationStatusState {
  const phase = String(result?.phase ?? "");
  const runStatus = String(result?.runStatus ?? "");
  const runConclusion = String(result?.runConclusion ?? "");
  const summary = result?.summary && typeof result.summary === "object" ? result.summary as Record<string, unknown> : undefined;
  const summaryStatus = String(summary?.status ?? "");
  if (["failed", "partial_failure", "blocked"].includes(summaryStatus)) return summaryStatus === "blocked" ? "blocked" : "failed";
  if (runStatus === "completed" && runConclusion === "failure") return "failed";
  if (result?.status === "error" && (phase === "failed" || phase === "completed_no_artifact")) return "failed";
  if (result?.status === "success" || phase === "artifact_ready") return "success";
  if (result?.status === "pending") {
    if (phase === "queued") return "queued";
    if (phase === "running") return "running";
    if (phase === "waiting_artifact" || phase === "unknown") return "waiting_artifact";
    return "waiting_artifact";
  }
  if (phase === "queued") return "queued";
  if (phase === "running") return "running";
  if (phase === "waiting_artifact" || phase === "unknown") return "waiting_artifact";
  return fallback;
}

function KeywordShoplingApplySection({
  preflightResult,
  maxRows,
  dryRunStatusMessage,
  realStatusMessage,
  dryRunResult,
  realResult,
  onMaxRowsChange,
  onDryRunStatusChange,
  onRealStatusChange,
  onDryRunResultChange,
  onRealResultChange,
}: {
  preflightResult: KeywordExecutionPreflightResult | null;
  maxRows: string;
  dryRunStatusMessage: string;
  realStatusMessage: string;
  dryRunResult: Record<string, unknown> | null;
  realResult: Record<string, unknown> | null;
  onMaxRowsChange: (value: string) => void;
  onDryRunStatusChange: (value: string) => void;
  onRealStatusChange: (value: string) => void;
  onDryRunResultChange: (value: Record<string, unknown> | null) => void;
  onRealResultChange: (value: Record<string, unknown> | null) => void;
}) {
  const disabled = !preflightResult;
  const executionPlanJson = preflightResult ? buildCompactKeywordApplyExecutionPlan(preflightResult) : "";
  const showGithub422Hint = `${dryRunStatusMessage} ${realStatusMessage}`.includes("status=422");
  const [dryRunMeta, setDryRunMeta] = useState<ApplyRunMeta>(() => ({ state: "idle", pollCount: 0, requestId: typeof window !== "undefined" ? window.localStorage.getItem(KEYWORD_APPLY_DRY_RUN_REQUEST_ID_KEY) || undefined : undefined }));
  const [realMeta, setRealMeta] = useState<ApplyRunMeta>(() => ({ state: "idle", pollCount: 0, requestId: typeof window !== "undefined" ? window.localStorage.getItem(KEYWORD_APPLY_REAL_REQUEST_ID_KEY) || undefined : undefined }));

  const pendingMessage = "아직 실행 중이거나 결과 파일을 생성하는 중입니다. 잠시 후 자동으로 다시 확인합니다.";
  const loadingHelp = "실행 중입니다. 결과 가져오기를 반복해서 누르지 않아도 자동으로 확인합니다. GitHub Actions는 아직 실행 중입니다. 결과 artifact가 아직 생성되지 않았습니다. 이 상태는 실패가 아닙니다. 잠시 후 다시 확인합니다. 최종 실패는 GitHub Actions가 종료된 뒤에만 표시됩니다.";

  function metaSetter(mode: "dry_run" | "apply") { return mode === "dry_run" ? setDryRunMeta : setRealMeta; }

  async function fetchResult(mode: "dry_run" | "apply", auto = false) {
    const setStatus = mode === "dry_run" ? onDryRunStatusChange : onRealStatusChange;
    const setResult = mode === "dry_run" ? onDryRunResultChange : onRealResultChange;
    const setMeta = metaSetter(mode);
    const currentMeta = mode === "dry_run" ? dryRunMeta : realMeta;
    const storageKey = mode === "dry_run" ? KEYWORD_APPLY_DRY_RUN_REQUEST_ID_KEY : KEYWORD_APPLY_REAL_REQUEST_ID_KEY;
    const requestId = window.localStorage.getItem(storageKey) || currentMeta.requestId || "";
    if (!requestId) {
      setResult(null);
      setStatus(mode === "dry_run" ? "아직 dry_run 실행 요청 ID가 없습니다. 먼저 dry_run 실행을 눌러주세요." : "아직 실제 반영 실행 요청 ID가 없습니다. 먼저 ‘실제 샵플링 반영 실행’을 눌러주세요.");
      return false;
    }
    const response = await fetch(`/api/keyword-shopling-apply/actions-result?request_id=${encodeURIComponent(requestId)}&mode=${encodeURIComponent(mode)}`);
    const json = await response.json();
    const fetchedAt = new Date().toISOString();
    const lastCheckedAt = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    const fetchedMode = typeof json.summary?.mode === "string" ? json.summary.mode : undefined;
    if (json.status === "success" && fetchedMode !== mode) {
      setResult(null);
      setStatus(mode === "apply" ? "가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다. 실제 반영 실행 요청 ID를 확인하세요." : "가져온 결과가 dry_run 결과가 아닙니다.");
      return false;
    }
    setResult({ ...json, fetchedAt });
    const state = toOperationState(json, auto ? "waiting_artifact" : "unknown");
    const isFinal = state === "success" || state === "failed" || state === "blocked";
    const message = json.status === "pending" ? `${pendingMessage} ${loadingHelp}` : json.message || formatKeywordApplyRunPhase(String(json.phase ?? "unknown"));
    setMeta((m) => ({ ...m, requestId, state, phase: String(json.phase ?? "unknown"), runUrl: json.runUrl, runStatus: json.runStatus, runConclusion: json.runConclusion, artifactName: json.artifactName, fetchedAt, lastCheckedAt, pollCount: auto ? m.pollCount + 1 : m.pollCount, isPolling: auto && !isFinal, message }));
    setStatus(message);
    if (!auto && !isFinal && !currentMeta.isPolling) void pollAfterDispatch(mode);
    return !isFinal;
  }

  async function pollAfterDispatch(mode: "dry_run" | "apply") {
    const setMeta = metaSetter(mode);
    const setStatus = mode === "dry_run" ? onDryRunStatusChange : onRealStatusChange;
    setMeta((m) => ({ ...m, isPolling: true }));
    for (let count = 0; count < MAX_APPLY_POLLS; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, APPLY_POLL_INTERVAL_MS));
      const keepGoing = await fetchResult(mode, true);
      if (!keepGoing) return;
    }
    const message = "자동 확인 시간이 끝났습니다. GitHub Actions 화면을 확인하거나 잠시 후 결과 가져오기를 다시 눌러주세요.";
    setMeta((m) => ({ ...m, state: m.state === "running" || m.state === "queued" ? m.state : "waiting_artifact", phase: m.phase || "waiting_artifact", isPolling: false, message }));
    setStatus(message);
  }

  async function run(mode: "dry_run" | "apply") {
    if (!preflightResult) return;
    const setStatus = mode === "dry_run" ? onDryRunStatusChange : onRealStatusChange;
    const setMeta = metaSetter(mode);
    const setResult = mode === "dry_run" ? onDryRunResultChange : onRealResultChange;
    if (mode === "apply" && !window.confirm("실제 샵플링 상품명/검색어를 수정합니다. 계속하시겠습니까?")) return;
    setResult(null);
    setMeta((m) => ({ ...m, state: "queued", phase: "queued", runStatus: "queued", pollCount: 0, isPolling: false, message: mode === "dry_run" ? "실행 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." : "실제 반영 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." }));
    setStatus(mode === "dry_run" ? "실행 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." : "실제 반영 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다.");
    const response = await fetch("/api/keyword-shopling-apply/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_plan_json: executionPlanJson, mode, confirmation_text: mode === "apply" ? KEYWORD_APPLY_CONFIRMATION_TEXT : "", max_items: Number.parseInt(maxRows, 10) || 20 }) });
    const json = await response.json();
    if (json.requestId) {
      const storageKey = mode === "dry_run" ? KEYWORD_APPLY_DRY_RUN_REQUEST_ID_KEY : KEYWORD_APPLY_REAL_REQUEST_ID_KEY;
      window.localStorage.setItem(storageKey, json.requestId);
      setMeta({ requestId: json.requestId, state: "queued", phase: "queued", runUrl: json.runUrl || json.githubActionsUrl, runStatus: "queued", pollCount: 0, isPolling: true, message: mode === "dry_run" ? "실행 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." : "실제 반영 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." });
      setStatus(mode === "dry_run" ? "실행 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다." : "실제 반영 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다.");
      void pollAfterDispatch(mode);
      return;
    }
    setMeta((m) => ({ ...m, state: "blocked", isPolling: false, message: json.message || "요청 실패" }));
    setStatus(json.message || json.commandPreview || (response.ok ? "요청 완료" : "요청 실패"));
  }

  const renderControls = (mode: "dry_run" | "apply", result: Record<string, unknown> | null, meta: ApplyRunMeta) => <>
    <OperationStatusCard state={meta.state || toOperationState(result)} phase={meta.phase || String(result?.phase ?? "unknown")} requestId={meta.requestId || String(result?.requestId ?? "")} runUrl={meta.runUrl || String(result?.runUrl ?? "")} runStatus={meta.runStatus || String(result?.runStatus ?? "")} runConclusion={meta.runConclusion || String(result?.runConclusion ?? "")} artifactName={meta.artifactName || String(result?.artifactName ?? "")} fetchedAt={meta.fetchedAt || String(result?.fetchedAt ?? "")} lastCheckedAt={meta.lastCheckedAt} pollCount={meta.pollCount} maxPolls={MAX_APPLY_POLLS} message={meta.message} />
    {result ? <ApplyResultFreshness result={result} /> : null}
    {result ? <ApplyResultDisplay result={result} title={mode === "dry_run" ? "dry_run result summary" : "apply result summary"} /> : null}
  </>;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4 sm:p-5"><h2 className="font-semibold text-slate-950">샵플링 반영 실행</h2><p className="mt-2 text-sm text-slate-600">이 단계는 승인된 상품명/검색어를 외부 GitHub Actions로 보내 샵플링에 반영합니다. OPS Center는 샵플링을 직접 호출하지 않습니다.</p><p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">먼저 dry_run으로 결과를 확인한 뒤, 실제 반영 버튼을 누르면 필요한 확인문구가 내부에서 자동으로 전달됩니다.</p>{!preflightResult ? <p className="mt-3 text-sm font-semibold text-red-700">먼저 반영 미리보기와 실행 전 점검을 실행하세요.</p> : null}<div className="mt-4 grid gap-3 sm:grid-cols-3"><SummaryCard label="실행 가능 행" value={preflightResult?.summary.eligibleCount ?? 0} /><SummaryCard label="차단 행" value={preflightResult?.summary.blockedCount ?? 0} /><label className="text-xs font-semibold text-slate-600">최대 실행 행 수<input type="number" min="1" max="100" value={maxRows} onChange={(event) => onMaxRowsChange(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label></div>
      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-blue-950">1단계: dry_run 확인</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={disabled} onClick={() => void run("dry_run")} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">샵플링 반영 dry_run 실행</button><button type="button" disabled={dryRunMeta.isPolling} onClick={() => void fetchResult("dry_run")} className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 disabled:border-slate-300 disabled:text-slate-400">{dryRunMeta.isPolling ? "자동 확인 중..." : "결과 가져오기"}</button>{dryRunMeta.isPolling ? <span className="self-center text-xs font-semibold text-blue-900">자동 확인 {dryRunMeta.pollCount}/{MAX_APPLY_POLLS}</span> : null}</div><p className="mt-3 text-xs text-blue-900">dry_run request id: <span className="font-mono">{dryRunMeta.requestId || "-"}</span></p>{dryRunStatusMessage ? <p className="mt-3 text-sm text-slate-700">{dryRunStatusMessage}</p> : null}{renderControls("dry_run", dryRunResult, dryRunMeta)}</div>
      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4"><h3 className="font-semibold text-red-950">2단계: 실제 반영</h3><p className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800">실제 반영 요청에는 외부 runner가 요구하는 확인문구가 자동으로 포함됩니다. 버튼 클릭 후 브라우저 최종 확인창에서 한 번 더 승인하세요.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={disabled} onClick={() => void run("apply")} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">실제 샵플링 반영 실행</button><button type="button" disabled={realMeta.isPolling} onClick={() => void fetchResult("apply")} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:border-slate-300 disabled:text-slate-400">{realMeta.isPolling ? "자동 확인 중..." : "결과 가져오기"}</button>{realMeta.isPolling ? <span className="self-center text-xs font-semibold text-red-900">자동 확인 {realMeta.pollCount}/{MAX_APPLY_POLLS}</span> : null}</div><p className="mt-3 text-xs text-red-900">apply request id: <span className="font-mono">{realMeta.requestId || "-"}</span></p>{realStatusMessage ? <p className="mt-3 text-sm text-slate-700">{realStatusMessage}</p> : null}{renderControls("apply", realResult, realMeta)}</div>{showGithub422Hint ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">GitHub Actions 입력값 검증에서 거절되었습니다. 실행 계획 크기 또는 workflow 입력값을 확인하세요.</p> : null}</div></section>
  );
}
function ApplyResultFreshness({ result }: { result: Record<string, unknown> }) {
  return <dl className="mt-3 grid gap-2 rounded-lg bg-white/80 p-3 text-xs sm:grid-cols-3"><div>request id: <span className="font-mono">{String(result.requestId ?? "-")}</span></div><div>mode: {String((result.summary as Record<string, unknown> | undefined)?.mode ?? "-")}</div><div>fetchedAt: {String(result.fetchedAt ?? "-")}</div><div>runStatus/conclusion: {String(result.runStatus ?? "-")} / {String(result.runConclusion ?? "-")}</div><div>artifactName: {String(result.artifactName ?? "-")}</div>{result.runUrl ? <div><a href={String(result.runUrl)} target="_blank" rel="noreferrer" className="font-semibold underline">GitHub Actions 열기</a></div> : null}</dl>;
}
function ApplyResultDisplay({ result, title = "실행 결과 요약" }: { result: Record<string, unknown>; title?: string }) {
  const summary = (
    result.summary && typeof result.summary === "object" ? result.summary : {}
  ) as Record<string, unknown>;
  const rows = (key: string) =>
    Array.isArray(result[key])
      ? (result[key] as Record<string, unknown>[])
      : [];
  return (
    <div className="p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {[
          "mode",
          "status",
          "input_item_count",
          "valid_item_count",
          "blocked_item_count",
          "applied_item_count",
          "failed_item_count",
          "dry_run",
          "warnings",
        ].map((key) => (
          <div key={key} className="rounded-lg bg-slate-50 p-2">
            <strong>{APPLY_RESULT_LABELS[key] ?? key}</strong>:{" "}
            {formatApplyResultValue(summary[key])}
          </div>
        ))}
      </div>
      <ResultRows title="반영 결과" rows={rows("applyResults")} />
      <ResultRows title="검증 결과" rows={rows("verifyResults")} />
      <BlockedRows rows={rows("blockedItems")} />
    </div>
  );
}
function ResultRows({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <h3 className="font-semibold">{title}</h3>
      <table className="mt-2 min-w-full divide-y divide-slate-200 text-left text-xs">
        <thead>
          <tr>
            {[
              "goods_key",
              "mall_key",
              "title_update_status",
              "site_srch_update_status",
              "code",
              "msg",
              "dry_run",
              "warning_flags",
            ].map((h) => (
              <th key={h} className="px-2 py-2">
                {APPLY_RESULT_LABELS[h] ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {[
                "goods_key",
                "mall_key",
                "title_update_status",
                "site_srch_update_status",
                "code",
                "msg",
                "dry_run",
                "warning_flags",
              ].map((h) => (
                <td key={h} className="px-2 py-2">
                  {formatApplyResultValue(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function BlockedRows({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <h3 className="font-semibold">차단 항목</h3>
      <table className="mt-2 min-w-full divide-y divide-slate-200 text-left text-xs">
        <thead>
          <tr>
            {["goods_key", "mall_key", "reasons"].map((h) => (
              <th key={h} className="px-2 py-2">
                {APPLY_RESULT_LABELS[h] ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {["goods_key", "mall_key", "reasons"].map((h) => (
                <td key={h} className="px-2 py-2">
                  {formatApplyResultValue(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PayloadPreviewSection({
  rows,
  result,
  onGenerate,
}: {
  rows: ReviewedKeywordRow[];
  result: KeywordPayloadPreviewResult | null;
  onGenerate: () => void;
}) {
  const approvedCount = rows.filter(
    (row) => row.reviewStatus === "approved",
  ).length;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4 sm:p-5">
        <h2 className="font-semibold text-slate-950">
          샵플링 반영 미리보기 생성
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          승인된 행을 검사하고 샵플링에 반영될 상품명/검색어 미리보기를
          만듭니다.
        </p>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          미리보기 전용입니다. 이 단계에서는 샵플링 API를 실행하지 않습니다.
        </div>
        <button
          type="button"
          disabled={approvedCount === 0}
          onClick={onGenerate}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          샵플링 반영 미리보기 생성
        </button>
      </div>

      {!result ? (
        <p className="p-8 text-center text-sm text-slate-500">
          승인된 행이 1개 이상 있으면 실행 없는 미리보기를 생성할 수 있습니다.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="승인된 행"
              value={result.summary.approvedCount}
            />
            <SummaryCard
              label="반영 준비 완료"
              value={result.summary.previewReadyCount}
            />
            <SummaryCard
              label="수정 필요"
              value={result.summary.invalidCount}
            />
            <SummaryCard
              label="제외된 차단 / 위험"
              value={result.summary.blockedRiskCount}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">상품번호 / 쇼핑몰</th>
                  <th className="px-3 py-2">최종 상품명</th>
                  <th className="px-3 py-2">최종 검색어</th>
                  <th className="px-3 py-2">검사 결과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {result.items.map((item) => (
                  <tr key={`${item.source_row_index}-${item.goods_key}`}>
                    <td className="px-3 py-3 align-top">
                      <strong>{item.goods_key || "—"}</strong>
                      <br />
                      <span className="text-xs text-slate-500">
                        {item.mall_key || "—"}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-3 align-top">
                      {item.final_title || "—"}
                    </td>
                    <td className="max-w-sm px-3 py-3 align-top">
                      {item.final_site_srch || "—"}
                    </td>
                    <td className="min-w-64 px-3 py-3 align-top">
                      <strong
                        className={
                          item.payload_status === "preview_ready"
                            ? "text-emerald-700"
                            : "text-red-700"
                        }
                      >
                        {payloadStatusLabel(item.payload_status)}
                      </strong>
                      {[
                        ...item.validation_errors,
                        ...item.validation_warnings,
                      ].map((message) => (
                        <p
                          key={message}
                          className="mt-1 text-xs text-slate-600"
                        >
                          {message}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label
            htmlFor="payload-xml-preview"
            className="mt-5 block text-xs font-semibold text-slate-600"
          >
            Preview XML
          </label>
          <textarea
            id="payload-xml-preview"
            readOnly
            value={result.previewXml}
            className="mt-1.5 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(result.previewXml)
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Copy preview XML
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  "keyword-shopling-preview.xml",
                  result.previewXml,
                  "application/xml",
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Download preview XML
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  "keyword-shopling-preview.json",
                  exportKeywordPayloadPreview(result),
                  "application/json",
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Download preview JSON
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ImportField({
  id,
  label,
  required = false,
  value,
  onChange,
  onFile,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold"
      />
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-40 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        placeholder="goods_key,mall_key,current_title,..."
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
    </article>
  );
}

function StatusCard({ label, value }: { label: string; value: boolean }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-2 text-lg font-bold ${
          value ? "text-red-700" : "text-emerald-700"
        }`}
      >
        {value ? "Yes" : "No"}
      </p>
    </article>
  );
}

function payloadStatusLabel(status: string) {
  return (
    (
      {
        invalid: "수정 필요",
        not_approved: "미승인",
        held: "보류",
        preview_ready: "반영 준비 완료",
        blocked_risk: "위험/차단",
      } as Record<string, string>
    )[status] ?? status
  );
}

function reviewStatusLabel(status: ReviewedKeywordRow["reviewStatus"]) {
  return { pending: "대기", approved: "승인됨", hold: "보류" }[status];
}

function reviewReasonFor(row: ReviewedKeywordRow) {
  if (row.classification === "blocked_risk") {
    return "위험 요소가 있어 보류하고 확인해야 합니다.";
  }
  if (row.reviewReason) return row.reviewReason;
  if (row.blockReason || row.warningFlags) {
    return "상품명이 짧거나 검색어가 부족해 검토가 필요합니다.";
  }
  if (row.classification === "auto_apply_candidate") {
    return "승인할 수 있는 후보입니다. 그래도 상품명과 검색어를 확인해 주세요.";
  }
  return "상품명이 짧거나 검색어가 부족해 검토가 필요합니다.";
}

const sheetFilters: { key: SheetFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "manual_review", label: "검토 필요" },
  { key: "auto_apply_candidate", label: "승인 가능" },
  { key: "hold", label: "보류" },
  { key: "approved", label: "승인됨" },
  { key: "blocked_risk", label: "위험/차단" },
  { key: "missing_keywords", label: "검색어 없음" },
  { key: "missing_title", label: "추천 상품명 없음" },
];

function isRowEdited(row: ReviewedKeywordRow) {
  return (
    row.editedTitle !== row.recommendedTitle ||
    row.editedSiteSrch !== row.recommendedSiteSrch
  );
}

function SheetReviewTable({
  rows,
  selectedRows,
  setSelectedRows,
  sheetFilter,
  setSheetFilter,
  sheetSearch,
  setSheetSearch,
  expandedRows,
  setExpandedRows,
  onUpdate,
  onBulkApprove,
  onBulkHold,
  onApproveAllReviewNeeded,
  onApproveFirstCandidatePerGoodsKey,
  onClearSelection,
  onDeleteRow,
  onBulkDelete,
}: {
  rows: ReviewedKeywordRow[];
  selectedRows: Set<number>;
  setSelectedRows: (rows: Set<number>) => void;
  sheetFilter: SheetFilter;
  setSheetFilter: (filter: SheetFilter) => void;
  sheetSearch: string;
  setSheetSearch: (search: string) => void;
  expandedRows: Set<number>;
  setExpandedRows: (rows: Set<number>) => void;
  onUpdate: (
    index: number,
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "editedTitle" | "editedSiteSrch" | "editedMallKey" | "reviewStatus"
      >
    >,
  ) => void;
  onBulkApprove: () => void;
  onBulkHold: () => void;
  onApproveAllReviewNeeded: () => void;
  onApproveFirstCandidatePerGoodsKey: () => void;
  onClearSelection: () => void;
  onDeleteRow: (index: number) => void;
  onBulkDelete: () => void;
}) {
  const normalizedSearch = sheetSearch.trim().toLowerCase();
  const visibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      if (sheetFilter === "manual_review")
        return row.classification === "manual_review";
      if (sheetFilter === "auto_apply_candidate")
        return row.classification === "auto_apply_candidate";
      if (sheetFilter === "blocked_risk")
        return row.classification === "blocked_risk";
      if (sheetFilter === "hold") return row.reviewStatus === "hold";
      if (sheetFilter === "approved") return row.reviewStatus === "approved";
      if (sheetFilter === "missing_keywords") return !row.editedSiteSrch.trim();
      if (sheetFilter === "missing_title") return !row.editedTitle.trim();
      return true;
    })
    .filter(({ row }) => {
      if (!normalizedSearch) return true;
      return [row.goodsKey, row.originalTitle, row.editedTitle].some((value) =>
        value.toLowerCase().includes(normalizedSearch),
      );
    });

  function toggleSelected(index: number) {
    const next = new Set(selectedRows);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelectedRows(next);
  }

  function toggleExpanded(index: number) {
    const next = new Set(expandedRows);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setExpandedRows(next);
  }

  return (
    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        {sheetFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setSheetFilter(filter.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              sheetFilter === filter.key
                ? "bg-blue-600 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={sheetSearch}
          onChange={(event) => setSheetSearch(event.target.value)}
          className="min-w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          placeholder="상품번호 또는 상품명 검색"
        />
        <button
          type="button"
          onClick={onBulkApprove}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
        >
          선택 항목 승인
        </button>
        <button
          type="button"
          onClick={onBulkHold}
          className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white"
        >
          선택 항목 보류
        </button>
        <button
          type="button"
          onClick={onBulkDelete}
          disabled={selectedRows.size === 0}
          className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          선택 항목 삭제
        </button>
        <button
          type="button"
          onClick={onApproveAllReviewNeeded}
          className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700"
        >
          전체 검토 필요 항목 승인
        </button>
        <button
          type="button"
          onClick={onApproveFirstCandidatePerGoodsKey}
          className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-700"
          title="플로우 테스트용입니다. goods_key별 첫 후보 1개만 승인하고, 쇼핑몰과 임시 검색어를 자동으로 채웁니다."
        >
          상품별 첫 후보만 승인
        </button>
        <span className="text-xs text-slate-500">
          플로우 테스트용입니다. goods_key별 첫 후보 1개만 승인하고, 쇼핑몰과
          임시 검색어를 자동으로 채웁니다.
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          선택 해제
        </button>
      </div>

      <div className="mt-4 max-h-[680px] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-[1280px] w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
            <tr className="border-b border-slate-300">
              <th className="w-14 px-2 py-2">선택</th>
              <th className="w-28 px-2 py-2">상태</th>
              <th className="w-36 px-2 py-2">상품번호 / 쇼핑몰</th>
              <th className="min-w-56 px-2 py-2">현재 상품명</th>
              <th className="min-w-72 px-2 py-2">추천 상품명</th>
              <th className="min-w-80 px-2 py-2">추천 검색어</th>
              <th className="min-w-52 px-2 py-2">검토 메모</th>
              <th className="w-44 px-2 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => (
              <Fragment key={`${row.goodsKey}-${row.sourceRowIndex}-${index}`}>
                <tr className="border-b border-slate-200 align-top">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={() => toggleSelected(index)}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`rounded-full px-2 py-1 font-semibold ${classificationStyles[row.classification]}`}
                      >
                        {classificationLabels[row.classification]}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                        {reviewStatusLabel(row.reviewStatus)}
                      </span>
                      {isRowEdited(row) ? (
                        <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">
                          수정됨
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-semibold text-slate-900">
                    <div>{row.goodsKey || "—"}</div>
                    <select
                      value={row.editedMallKey || row.mallKey || ""}
                      onChange={(event) =>
                        onUpdate(index, { editedMallKey: event.target.value })
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs font-normal"
                    >
                      <option value="">쇼핑몰 선택 필요</option>
                      {SHOPLING_MALL_OPTIONS.map(([key, label]) => (
                        <option key={key} value={key}>
                          {key} {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    {row.originalTitle || "—"}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.editedTitle}
                      onChange={(event) =>
                        onUpdate(index, { editedTitle: event.target.value })
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      placeholder="추천 상품명 없음 — 직접 입력"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={row.editedSiteSrch}
                      onChange={(event) =>
                        onUpdate(index, { editedSiteSrch: event.target.value })
                      }
                      className="min-h-9 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:min-h-24"
                      placeholder="검색어 없음 — 필요하면 입력"
                    />
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    {reviewReasonFor(row)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdate(index, { reviewStatus: "approved" })
                        }
                        className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white"
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdate(index, { reviewStatus: "hold" })
                        }
                        className="rounded bg-amber-500 px-2 py-1 font-semibold text-white"
                      >
                        보류
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(index)}
                        className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700"
                      >
                        세부보기
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRow(index)}
                        className="rounded border border-red-300 px-2 py-1 font-semibold text-red-700"
                      >
                        행 삭제
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedRows.has(index) ? (
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <td colSpan={8} className="px-3 py-3">
                      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Detail
                          label="mall_key"
                          value={
                            row.editedMallKey ||
                            row.mallKey ||
                            "쇼핑몰 선택 필요"
                          }
                        />
                        <Detail
                          label="sourceRowIndex"
                          value={String(row.sourceRowIndex)}
                        />
                        <Detail
                          label="quality_status"
                          value={row.qualityStatus}
                        />
                        <Detail
                          label="confidence_status"
                          value={row.confidenceStatus}
                        />
                        <Detail label="block_reason" value={row.blockReason} />
                        <Detail
                          label="warning_flags"
                          value={row.warningFlags}
                        />
                        <Detail
                          label="counts"
                          value={`${row.siteSrchKeywordCount ?? "—"} keywords / ${row.verifiedKeywordCount ?? "—"} verified`}
                        />
                        <Detail
                          label="raw site_srch"
                          value={row.originalSiteSrch}
                        />
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRow({
  row,
  onUpdate,
  onDelete,
}: {
  row: ReviewedKeywordRow;
  onUpdate: (
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "editedTitle" | "editedSiteSrch" | "editedMallKey" | "reviewStatus"
      >
    >,
  ) => void;
  onDelete: () => void;
}) {
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">
            상품번호 {row.goodsKey || "—"}
          </h3>
        </div>
        <div className="flex gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classificationStyles[row.classification]}`}
          >
            {classificationLabels[row.classification]}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {reviewStatusLabel(row.reviewStatus)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Detail label="현재 상품명" value={row.originalTitle} />
        <label className="text-xs font-semibold text-slate-600">
          적용 쇼핑몰
          <select
            value={row.editedMallKey || row.mallKey || ""}
            onChange={(event) =>
              onUpdate({ editedMallKey: event.target.value })
            }
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
          >
            <option value="">쇼핑몰 선택 필요</option>
            {SHOPLING_MALL_OPTIONS.map(([key, label]) => (
              <option key={key} value={key}>
                {key} {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          추천 상품명
          <input
            value={row.editedTitle}
            onChange={(event) => onUpdate({ editedTitle: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600 lg:col-span-2">
          추천 검색어
          <textarea
            value={row.editedSiteSrch}
            onChange={(event) =>
              onUpdate({ editedSiteSrch: event.target.value })
            }
            className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500"
            placeholder="추천 검색어가 없습니다. 필요하면 직접 입력하세요."
          />
        </label>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 lg:col-span-2">
          <p className="font-semibold">검토 메모</p>
          <p className="mt-1">{reviewReasonFor(row)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onUpdate({ reviewStatus: "approved" })}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          승인
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ reviewStatus: "hold" })}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          보류
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700"
        >
          행 삭제
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdate({
              editedTitle: row.recommendedTitle,
              editedSiteSrch: row.recommendedSiteSrch,
              reviewStatus: "pending",
            })
          }
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          처음으로 되돌리기
        </button>
      </div>

      <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-900">
          세부 정보 보기
        </summary>
        <dl className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Detail
            label="mall_key"
            value={row.editedMallKey || row.mallKey || "쇼핑몰 선택 필요"}
          />
          <Detail label="quality_status" value={row.qualityStatus} />
          <Detail label="confidence_status" value={row.confidenceStatus} />
          <Detail label="block_reason" value={row.blockReason} />
          <Detail label="warning_flags" value={row.warningFlags} />
          <Detail
            label="counts"
            value={`${row.siteSrchKeywordCount ?? "—"} keywords / ${row.verifiedKeywordCount ?? "—"} verified`}
          />
          <Detail label="raw site_srch" value={row.originalSiteSrch} />
          <Detail label="source row" value={String(row.sourceRowIndex)} />
        </dl>
        <pre className="mt-3 overflow-x-auto rounded bg-white p-3 font-mono text-[11px]">
          {JSON.stringify(row.raw, null, 2)}
        </pre>
      </details>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-800">{value || "—"}</dd>
    </div>
  );
}
