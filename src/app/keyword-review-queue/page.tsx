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
        onGenerate={() =>
          setPayloadPreview(buildKeywordShoplingPayloadPreview(rows))
        }
      />
    </>
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
