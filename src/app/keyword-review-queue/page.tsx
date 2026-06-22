"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ChangeEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
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
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  exportKeywordExecutionPlan,
  type KeywordExecutionPreflightResult,
} from "@/lib/keywordReviewExecutionPreflight";

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
  const [importedArtifact] = useState<ImportedArtifactPayload | null>(() =>
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
  const [allowedMallKeys, setAllowedMallKeys] = useState("");
  const [maxRows, setMaxRows] = useState("0");
  const [alreadyAppliedGoodsKeys, setAlreadyAppliedGoodsKeys] = useState("");
  const [finalConfirmation, setFinalConfirmation] = useState(false);
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
    setFinalConfirmation(false);
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

  function previewQueue() {
    const parsed = [
      ...parseKeywordMvpCsv(approvalCsv),
      ...parseKeywordMvpCsv(manualCsv),
    ];
    const reviewedRows = createReviewedRows(parsed);
    setRows(reviewedRows);
    setSelectedRows(new Set());
    setCopyStatus("");
    setPayloadPreview(null);
    setPreflightResult(null);
  }

  function updateRow(
    index: number,
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "editedTitle" | "editedSiteSrch" | "reviewStatus"
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
    update: Partial<Pick<ReviewedKeywordRow, "reviewStatus">>,
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
          <button
            type="button"
            onClick={loadImportedArtifact}
            className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
          >
            결과 다시 불러오기
          </button>
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
                ? "가져온 파일에 검토할 행이 없습니다. artifact 내용을 확인해 주세요."
                : "아직 가져온 키워드 결과물이 없습니다."}
            </p>
            {!hasImportedArtifact ? (
              <Link
                href="/keyword-engine-runner"
                className="mt-3 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
              >
                키워드 엔진 실행기로 이동
              </Link>
            ) : null}
          </div>
        ) : (
          <div>
            <div className="border-b border-slate-200 p-4">
              <h2 className="font-semibold text-slate-950">검토 목록</h2>
              <p className="mt-1 text-sm text-slate-600">
                표에서 상품명과 검색어를 확인하고 승인 또는 보류를 선택하세요.
              </p>
            </div>
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
              onClearSelection={() => setSelectedRows(new Set())}
            />
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
        finalConfirmation={finalConfirmation}
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
        onFinalConfirmationChange={(value) => {
          setFinalConfirmation(value);
          setPreflightResult(null);
        }}
        onRun={(config) =>
          setPreflightResult(
            buildKeywordExecutionPreflight(
              {
                previewResult: payloadPreview!,
                finalConfirmationText: finalConfirmation
                  ? config.confirmationText
                  : "",
              },
              config,
            ),
          )
        }
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
  finalConfirmation,
  onAllowedMallKeysChange,
  onMaxRowsChange,
  onAlreadyAppliedGoodsKeysChange,
  onFinalConfirmationChange,
  onRun,
}: {
  previewResult: KeywordPayloadPreviewResult | null;
  result: KeywordExecutionPreflightResult | null;
  allowedMallKeys: string;
  maxRows: string;
  alreadyAppliedGoodsKeys: string;
  finalConfirmation: boolean;
  onAllowedMallKeysChange: (value: string) => void;
  onMaxRowsChange: (value: string) => void;
  onAlreadyAppliedGoodsKeysChange: (value: string) => void;
  onFinalConfirmationChange: (value: boolean) => void;
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
      <details>
        <summary className="cursor-pointer p-4 font-semibold text-slate-950 sm:p-5">
          고급 안전 확인 열기
        </summary>
        <div className="border-t border-slate-200 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-950">실행 전 안전 확인</h2>
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
            미리보기 전용입니다. 샵플링에는 자동 반영되지 않습니다.
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              허용할 몰 키
              <textarea
                value={allowedMallKeys}
                onChange={(event) =>
                  onAllowedMallKeysChange(event.target.value)
                }
                className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
                placeholder="몰 키를 한 줄에 하나씩 또는 쉼표로 구분해 입력"
              />
              <span className="mt-1 block font-normal">
                비워두면 모든 몰 키를 차단합니다.
              </span>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              이미 처리한 상품번호
              <textarea
                value={alreadyAppliedGoodsKeys}
                onChange={(event) =>
                  onAlreadyAppliedGoodsKeysChange(event.target.value)
                }
                className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
                placeholder="상품번호를 한 줄에 하나씩 또는 쉼표로 구분해 입력"
              />
              <span className="mt-1 block font-normal">
                이미 처리한 상품번호를 입력하면 중복 실행을 막을 수 있습니다.
              </span>
            </label>
          </div>
          <label className="mt-4 block max-w-xs text-xs font-semibold text-slate-600">
            최대 처리 행 수
            <input
              type="number"
              min="0"
              step="1"
              value={maxRows}
              onChange={(event) => onMaxRowsChange(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
            />
            <span className="mt-1 block font-normal">
              0보다 큰 숫자를 입력해야 합니다.
            </span>
          </label>
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={finalConfirmation}
              onChange={(event) =>
                onFinalConfirmationChange(event.target.checked)
              }
              className="mt-1"
            />
            <span>
              이 확인은 미리보기 전용이며 샵플링에 반영되지 않는다는 것을
              확인했습니다.
            </span>
          </label>
          <button
            type="button"
            disabled={!previewResult}
            onClick={() => onRun(config)}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            안전 확인 실행
          </button>
        </div>

        {!result ? (
          <p className="p-8 text-center text-sm text-slate-500">
            먼저 미리보기를 만든 뒤 필요한 안전 조건을 확인할 수 있습니다.
          </p>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Eligible"
                value={result.summary.eligibleCount}
              />
              <SummaryCard
                label="Blocked"
                value={result.summary.blockedCount}
              />
              <SummaryCard
                label="Already applied blocked"
                value={result.summary.alreadyAppliedBlockedCount}
              />
              <SummaryCard
                label="Mall key blocked"
                value={result.summary.mallKeyBlockedCount}
              />
              <SummaryCard
                label="Duplicate goods keys"
                value={result.summary.duplicateGoodsKeyCount}
              />
              <StatusCard
                label="Max rows exceeded"
                value={result.summary.maxRowsExceeded}
              />
              <StatusCard
                label="Final confirmation required"
                value={result.summary.requiresFinalConfirmation}
              />
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">goods_key</th>
                    <th className="px-3 py-2">mall_key</th>
                    <th className="px-3 py-2">최종 상품명</th>
                    <th className="px-3 py-2">최종 검색어</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Block reasons</th>
                    <th className="px-3 py-2">Warnings</th>
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
                        {item.preflight_status}
                      </td>
                      <td className="min-w-56 px-3 py-3 align-top text-xs">
                        {item.block_reasons.join(", ") || "—"}
                      </td>
                      <td className="min-w-56 px-3 py-3 align-top text-xs">
                        {item.preflight_warnings.join(" ") || "—"}
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
              Preview-only execution plan JSON
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
                onClick={() =>
                  void navigator.clipboard.writeText(executionPlan)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                Copy execution plan JSON
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
                Download execution plan JSON
              </button>
            </div>
          </div>
        )}
      </details>
    </section>
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

function payloadStatusLabel(status: string) {
  return (
    {
      preview_ready: "미리보기 가능",
      invalid: "확인 필요",
      held: "보류",
      blocked_risk: "위험/차단",
      not_approved: "미승인",
    }[status] ?? status
  );
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
          검토 결과 미리보기 만들기
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          승인한 항목만 모아 다음 단계에서 확인할 미리보기를 만듭니다. 이 버튼을
          눌러도 샵플링에는 반영되지 않습니다.
        </p>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          미리보기 전용입니다. 샵플링에는 자동 반영되지 않습니다.
        </div>
        <button
          type="button"
          disabled={approvedCount === 0}
          onClick={onGenerate}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          미리보기 만들기
        </button>
      </div>

      {!result ? (
        <p className="p-8 text-center text-sm text-slate-500">
          먼저 표에서 한 개 이상 승인한 뒤 미리보기를 만들 수 있습니다.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="승인한 항목"
              value={result.summary.approvedCount}
            />
            <SummaryCard
              label="미리보기 가능"
              value={result.summary.previewReadyCount}
            />
            <SummaryCard
              label="확인 필요"
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
                  <th className="px-3 py-2">상품번호</th>
                  <th className="px-3 py-2">최종 상품명</th>
                  <th className="px-3 py-2">최종 검색어</th>
                  <th className="px-3 py-2">확인 결과</th>
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

          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <summary className="cursor-pointer font-semibold text-slate-900">
              기술 정보 보기
            </summary>
            <label
              htmlFor="payload-xml-preview"
              className="mt-4 block font-semibold text-slate-600"
            >
              Preview XML / payload / site_srch / preflight / preview-only flags
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
          </details>
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
  onClearSelection,
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
        "editedTitle" | "editedSiteSrch" | "reviewStatus"
      >
    >,
  ) => void;
  onBulkApprove: () => void;
  onBulkHold: () => void;
  onApproveAllReviewNeeded: () => void;
  onClearSelection: () => void;
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
          onClick={onApproveAllReviewNeeded}
          className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700"
        >
          전체 검토 필요 항목 승인
        </button>
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
              <th className="w-28 px-2 py-2">상품번호</th>
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
                    {row.goodsKey || "—"}
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
                    </div>
                  </td>
                </tr>
                {expandedRows.has(index) ? (
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <td colSpan={8} className="px-3 py-3">
                      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Detail label="mail_key" value={row.mallKey} />
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-800">{value || "—"}</dd>
    </div>
  );
}
