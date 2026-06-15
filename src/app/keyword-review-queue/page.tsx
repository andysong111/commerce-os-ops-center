"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
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
import {
  buildKeywordExecutionIntent,
  DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION,
  exportKeywordExecutionIntent,
  type KeywordExecutionIntentResult,
} from "@/lib/keywordReviewExecutionIntent";

const classificationLabels: Record<KeywordQueueClassification, string> = {
  auto_apply_candidate: "Auto apply candidate",
  manual_review: "Manual review",
  blocked_risk: "Blocked / risk",
};

const classificationStyles: Record<KeywordQueueClassification, string> = {
  auto_apply_candidate: "bg-emerald-50 text-emerald-700",
  manual_review: "bg-amber-50 text-amber-700",
  blocked_risk: "bg-red-50 text-red-700",
};

export default function KeywordReviewQueuePage() {
  const [approvalCsv, setApprovalCsv] = useState("");
  const [manualCsv, setManualCsv] = useState("");
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [rows, setRows] = useState<ReviewedKeywordRow[]>([]);
  const [copyStatus, setCopyStatus] = useState("");
  const [payloadPreview, setPayloadPreview] =
    useState<KeywordPayloadPreviewResult | null>(null);
  const [preflightResult, setPreflightResult] =
    useState<KeywordExecutionPreflightResult | null>(null);
  const [allowedMallKeys, setAllowedMallKeys] = useState("");
  const [maxRows, setMaxRows] = useState("0");
  const [alreadyAppliedGoodsKeys, setAlreadyAppliedGoodsKeys] = useState("");
  const [finalConfirmation, setFinalConfirmation] = useState(false);
  const [intentConfirmation, setIntentConfirmation] = useState(false);
  const [intentConfirmationText, setIntentConfirmationText] = useState("");
  const [executionIntent, setExecutionIntent] =
    useState<KeywordExecutionIntentResult | null>(null);
  const [executionIntentError, setExecutionIntentError] = useState("");

  const counts = useMemo(
    () => ({
      auto: rows.filter(
        (row) => row.classification === "auto_apply_candidate",
      ).length,
      manual: rows.filter((row) => row.classification === "manual_review")
        .length,
      blocked: rows.filter((row) => row.classification === "blocked_risk")
        .length,
      total: rows.length,
    }),
    [rows],
  );

  function previewQueue() {
    const parsed = [
      ...parseKeywordMvpCsv(approvalCsv),
      ...parseKeywordMvpCsv(manualCsv),
    ];
    setRows(createReviewedRows(parsed));
    setCopyStatus("");
    setPayloadPreview(null);
    setPreflightResult(null);
    setExecutionIntent(null);
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
    setExecutionIntent(null);
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...update } : row,
      ),
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
        title="Keyword Review Queue"
        description="Import Keyword Engine MVP dry-run outputs, classify them conservatively, and prepare user-reviewed approval data."
      />

      <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <strong>Review foundation only.</strong> Live Shopling API execution and
        real product keyword updates are not available. This page only parses,
        previews, edits, and exports local review data.
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">Import dry-run outputs</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Run the Keyword Engine outside Commerce OS, then paste or upload its
          approval sheet and optional manual candidates CSV. Summary Markdown
          is retained on this page for reviewer context only.
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
            Parse / Preview Queue
          </button>
          <button
            type="button"
            onClick={() => setApprovalCsv(KEYWORD_REVIEW_QUEUE_SAMPLE_CSV)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Load sample CSV
          </button>
        </div>
      </section>

      <section
        className="my-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Queue summary"
      >
        <SummaryCard label="Auto apply candidates" value={counts.auto} />
        <SummaryCard label="Manual review" value={counts.manual} />
        <SummaryCard label="Blocked / risk" value={counts.blocked} />
        <SummaryCard label="Total rows" value={counts.total} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold text-slate-950">Review rows</h2>
            <p className="mt-1 text-sm text-slate-600">
              Only manual rows expose edits. Approval and hold state remains in
              this browser session and does not trigger execution.
            </p>
          </div>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => {
              void navigator.clipboard.writeText(exportText).then(() => {
                setCopyStatus("Reviewed JSON copied.");
              });
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Copy reviewed JSON
          </button>
          {copyStatus && (
            <p className="w-full text-right text-xs text-emerald-700">
              {copyStatus}
            </p>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Paste or upload CSV data, then parse it to preview the queue.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {rows.map((row, index) => (
              <ReviewRow
                key={`${row.goodsKey}-${row.sourceRowIndex}-${index}`}
                row={row}
                onUpdate={(update) => updateRow(index, update)}
              />
            ))}
          </div>
        )}
      </section>

      <PayloadPreviewSection
        rows={rows}
        result={payloadPreview}
        onGenerate={() => {
          setPayloadPreview(buildKeywordShoplingPayloadPreview(rows));
          setPreflightResult(null);
          setExecutionIntent(null);
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
          setExecutionIntent(null);
        }}
        onMaxRowsChange={(value) => {
          setMaxRows(value);
          setPreflightResult(null);
          setExecutionIntent(null);
        }}
        onAlreadyAppliedGoodsKeysChange={(value) => {
          setAlreadyAppliedGoodsKeys(value);
          setPreflightResult(null);
          setExecutionIntent(null);
        }}
        onFinalConfirmationChange={(value) => {
          setFinalConfirmation(value);
          setPreflightResult(null);
          setExecutionIntent(null);
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
      <ExecutionIntentSection
        preflightResult={preflightResult}
        confirmationAccepted={intentConfirmation}
        confirmationText={intentConfirmationText}
        intent={executionIntent}
        error={executionIntentError}
        onConfirmationAcceptedChange={(value) => {
          setIntentConfirmation(value);
          setExecutionIntent(null);
          setExecutionIntentError("");
        }}
        onConfirmationTextChange={(value) => {
          setIntentConfirmationText(value);
          setExecutionIntent(null);
          setExecutionIntentError("");
        }}
        onCreate={() => {
          try {
            setExecutionIntent(
              buildKeywordExecutionIntent(preflightResult!, {
                confirmationAccepted: intentConfirmation,
                confirmationText: intentConfirmationText,
                preflightConfig: {
                  ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
                  allowedMallKeys: parseKeyList(allowedMallKeys),
                  maxRows: Math.max(0, Number.parseInt(maxRows, 10) || 0),
                  alreadyAppliedGoodsKeys: parseKeyList(
                    alreadyAppliedGoodsKeys,
                  ),
                },
              }),
            );
            setExecutionIntentError("");
          } catch (error) {
            setExecutionIntent(null);
            setExecutionIntentError(
              error instanceof Error
                ? error.message
                : "Execution intent could not be created.",
            );
          }
        }}
      />
    </>
  );
}

function ExecutionIntentSection({
  preflightResult,
  confirmationAccepted,
  confirmationText,
  intent,
  error,
  onConfirmationAcceptedChange,
  onConfirmationTextChange,
  onCreate,
}: {
  preflightResult: KeywordExecutionPreflightResult | null;
  confirmationAccepted: boolean;
  confirmationText: string;
  intent: KeywordExecutionIntentResult | null;
  error: string;
  onConfirmationAcceptedChange: (value: boolean) => void;
  onConfirmationTextChange: (value: string) => void;
  onCreate: () => void;
}) {
  const canCreate =
    Boolean(preflightResult) &&
    (preflightResult?.eligibleItems.length ?? 0) > 0 &&
    !preflightResult?.summary.maxRowsExceeded &&
    confirmationAccepted &&
    confirmationText === DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION;
  const intentJson = intent ? exportKeywordExecutionIntent(intent) : "";

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4 sm:p-5">
        <h2 className="font-semibold text-slate-950">Execution Intent</h2>
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          This only records final execution intent. It does not execute
          Shopling API updates.
        </div>
        <p className="mt-4 text-xs font-semibold text-slate-600">
          Required phrase
        </p>
        <p className="mt-1 rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
          {DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION}
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmationAccepted}
            onChange={(event) =>
              onConfirmationAcceptedChange(event.target.checked)
            }
            className="mt-1"
          />
          <span>I accept the final preview-only execution intent warning.</span>
        </label>
        <label className="mt-4 block text-xs font-semibold text-slate-600">
          Final confirmation text
          <input
            type="text"
            value={confirmationText}
            onChange={(event) => onConfirmationTextChange(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
          />
        </label>
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Create execution intent
        </button>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>

      {!intent ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Complete a valid preflight and exact final confirmation to create a
          non-executing intent artifact.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <IntentValue label="Intent ID" value={intent.intentId} />
            <IntentValue label="Created at" value={intent.createdAt} />
            <IntentValue
              label="Eligible items"
              value={String(intent.eligibleItemsSnapshot.length)}
            />
            <IntentValue
              label="Blocked snapshot"
              value={String(intent.blockedItemsSnapshot.length)}
            />
            <IntentValue label="Status" value={intent.status} />
            <IntentValue label="executionDisabled" value="true" />
            <IntentValue label="notExecuted" value="true" />
          </dl>
          <textarea
            aria-label="Execution intent JSON"
            readOnly
            value={intentJson}
            className="mt-5 min-h-64 w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(intentJson)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Copy execution intent JSON
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  `${intent.intentId}.json`,
                  intentJson,
                  "application/json",
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Download execution intent JSON
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function IntentValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-slate-900">{value}</dd>
    </div>
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
  onRun: (
    config: typeof DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  ) => void;
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
        <h2 className="font-semibold text-slate-950">Execution Preflight</h2>
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          Preview only. This does not execute Shopling API updates.
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Allowed mall keys
            <textarea
              value={allowedMallKeys}
              onChange={(event) => onAllowedMallKeysChange(event.target.value)}
              className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
              placeholder="one mall_key per line or comma-separated"
            />
            <span className="mt-1 block font-normal">
              Leave allowedMallKeys empty to block all rows.
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Already-applied goods keys
            <textarea
              value={alreadyAppliedGoodsKeys}
              onChange={(event) =>
                onAlreadyAppliedGoodsKeysChange(event.target.value)
              }
              className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs font-normal text-slate-900"
              placeholder="one goods_key per line or comma-separated"
            />
            <span className="mt-1 block font-normal">
              Already-applied goods_key examples can be entered here to prevent
              re-execution.
            </span>
          </label>
        </div>
        <label className="mt-4 block max-w-xs text-xs font-semibold text-slate-600">
          Maximum rows
          <input
            type="number"
            min="0"
            step="1"
            value={maxRows}
            onChange={(event) => onMaxRowsChange(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
          />
          <span className="mt-1 block font-normal">
            maxRows must be greater than 0 to allow any row.
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
            {DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG.confirmationText}
          </span>
        </label>
        <button
          type="button"
          disabled={!previewResult}
          onClick={() => onRun(config)}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Run preflight check
        </button>
      </div>

      {!result ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Generate the payload/XML preview, configure the fail-closed guards,
          and run the preflight check.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Eligible" value={result.summary.eligibleCount} />
            <SummaryCard label="Blocked" value={result.summary.blockedCount} />
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
                  <th className="px-3 py-2">Final title</th>
                  <th className="px-3 py-2">Final site_srch</th>
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
          Generate payload/XML preview
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Validate approved rows and create a proposed Shopling title and
          site_srch update preview.
        </p>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          This is preview only. No Shopling API execution is performed.
        </div>
        <button
          type="button"
          disabled={approvedCount === 0}
          onClick={onGenerate}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Generate payload/XML preview
        </button>
      </div>

      {!result ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Approve at least one reviewed row, then generate a non-executing
          preview.
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Approved rows" value={result.summary.approvedCount} />
            <SummaryCard
              label="Preview-ready rows"
              value={result.summary.previewReadyCount}
            />
            <SummaryCard label="Invalid rows" value={result.summary.invalidCount} />
            <SummaryCard
              label="Blocked / risk excluded"
              value={result.summary.blockedRiskCount}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Keys</th>
                  <th className="px-3 py-2">Final title</th>
                  <th className="px-3 py-2">Final site_srch</th>
                  <th className="px-3 py-2">Validation</th>
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
                        {item.payload_status.replaceAll("_", " ")}
                      </strong>
                      {[...item.validation_errors, ...item.validation_warnings].map(
                        (message) => (
                          <p key={message} className="mt-1 text-xs text-slate-600">
                            {message}
                          </p>
                        ),
                      )}
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

function ReviewRow({
  row,
  onUpdate,
}: {
  row: ReviewedKeywordRow;
  onUpdate: (
    update: Partial<
      Pick<
        ReviewedKeywordRow,
        "editedTitle" | "editedSiteSrch" | "reviewStatus"
      >
    >,
  ) => void;
}) {
  const editable = row.classification === "manual_review";
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">
            goods_key: {row.goodsKey || "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            mall_key: {row.mallKey || "—"} · source row {row.sourceRowIndex}
          </p>
        </div>
        <div className="flex gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classificationStyles[row.classification]}`}
          >
            {classificationLabels[row.classification]}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {row.reviewStatus}
          </span>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <Detail label="Current / original title" value={row.originalTitle} />
        <Detail label="Recommended title" value={row.recommendedTitle} />
        <Detail label="Recommended site_srch" value={row.recommendedSiteSrch} />
        <Detail
          label="Counts"
          value={`${row.siteSrchKeywordCount ?? "—"} keywords / ${row.verifiedKeywordCount ?? "—"} verified`}
        />
        <Detail label="Quality status" value={row.qualityStatus} />
        <Detail label="Confidence status" value={row.confidenceStatus} />
        <Detail label="Block reason" value={row.blockReason} />
        <Detail label="Warning flags" value={row.warningFlags} />
      </dl>

      {editable && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Edited title
            <input
              value={row.editedTitle}
              onChange={(event) => onUpdate({ editedTitle: event.target.value })}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Edited site_srch
            <textarea
              value={row.editedSiteSrch}
              onChange={(event) =>
                onUpdate({ editedSiteSrch: event.target.value })
              }
              className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500"
            />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onUpdate({ reviewStatus: "approved" })}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ reviewStatus: "hold" })}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Hold
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
          Reset edits
        </button>
      </div>
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
