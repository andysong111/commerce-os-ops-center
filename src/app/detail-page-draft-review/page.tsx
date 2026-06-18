"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { createEngineArtifactReviewSummary } from "@/lib/engineArtifactReview";
import {
  exportReviewedDetailPageDraft,
  parseDetailPageDraftReview,
  type DetailPageDraftParseResult,
  type ReviewStatus,
} from "@/lib/detailPageDraftReview";

type ImportedArtifactPayload = {
  kind: "detail_page_engine";
  source?: { repo?: string; runId?: number; artifactId?: number };
  files: Record<string, string>;
  generatedSourceFiles?: string[];
  requiresHumanReview: true;
};

function readImportedArtifactHandoff(): ImportedArtifactPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem("opsCenter.detailPageEngine.importedArtifact.v1");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ImportedArtifactPayload>;
    if (parsed.kind === "detail_page_engine" && parsed.requiresHumanReview === true && parsed.files) {
      return parsed as ImportedArtifactPayload;
    }
  } catch {
    return null;
  }
  return null;
}

const BATH001_RENDER_REPORT = `{
  "product_code": "BATH001",
  "rendered_block_count": 12,
  "rendered_image_count": 7,
  "generated_images_used": 4,
  "missing_roles": [],
  "warnings": [],
  "mvp_pass": true
}`;

const BATH001_SUMMARY = `{
  "sources": ["1688_snapshot", "generated_source"],
  "source_links": ["local-artifact-only"],
  "images_before": 3,
  "images_after": 7,
  "coverage_before": { "roles": 8 },
  "coverage_after": { "roles": 12 },
  "new_roles": ["lifestyle", "benefit"],
  "missing_roles": [],
  "collection_errors": []
}`;

const BATH001_HTML = `<main>
  <section><h1>BATH001 Bathroom Shelf Draft</h1></section>
  <section><p>Preview-only imported Detail Page Engine HTML.</p></section>
  <img src="generated_source/bath001-hero.png" alt="BATH001 generated hero" />
</main>`;

const reviewStatusLabels: Record<ReviewStatus, string> = {
  final_candidate: "Mark as final candidate",
  needs_manual_edit: "Mark as needs manual edit",
  hold_reject: "Hold / reject",
};

const reviewSummary = createEngineArtifactReviewSummary({
  source: "product-detail-page-auto",
  statuses: ["imported", "needs_review", "preview_ready", "export_ready", "execution_disabled"],
});

export default function DetailPageDraftReviewPage() {
  const [productCode, setProductCode] = useState("BATH001");
  const [html, setHtml] = useState("");
  const [renderReportText, setRenderReportText] = useState("");
  const [multiSourceSummaryText, setMultiSourceSummaryText] = useState("");
  const [generatedSourceListText, setGeneratedSourceListText] = useState("");
  const [result, setResult] = useState<DetailPageDraftParseResult | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("needs_manual_edit");
  const [memo, setMemo] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [importedArtifact] = useState<ImportedArtifactPayload | null>(() => readImportedArtifactHandoff());

  function loadImportedArtifact() {
    if (!importedArtifact?.files) return;
    setHtml(String(importedArtifact.files["detailpage_final.html"] ?? ""));
    setRenderReportText(String(importedArtifact.files["detailpage_render_report.json"] ?? ""));
    setMultiSourceSummaryText(String(importedArtifact.files["multi_source_summary.json"] ?? ""));
    setGeneratedSourceListText((importedArtifact.generatedSourceFiles ?? []).join("\n"));
    setResult(null);
    setReviewStatus("needs_manual_edit");
    setMemo("");
    setCopyStatus("가져온 상세페이지 결과물을 검토용으로 불러왔습니다. 자동 게시하지 않습니다. 검토 후 사용해야 합니다.");
  }

  const exportText = useMemo(() => {
    if (!result) return "";
    return exportReviewedDetailPageDraft({
      productCode: result.productCode,
      classification: result.classification,
      reviewStatus,
      memo,
      renderReportSnapshot: result.renderReport.data,
      multiSourceSummarySnapshot: result.multiSourceSummary.data,
      html: result.html,
      generatedSourceFiles: result.generatedSourceFiles,
    });
  }, [memo, result, reviewStatus]);

  function loadFile(event: ChangeEvent<HTMLInputElement>, setter: (value: string) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(setter);
  }

  function parsePreview() {
    setResult(parseDetailPageDraftReview({ productCode, html, renderReportText, multiSourceSummaryText, generatedSourceListText }));
    setCopyStatus("");
  }

  function loadBathSample() {
    setProductCode("BATH001");
    setHtml(BATH001_HTML);
    setRenderReportText(BATH001_RENDER_REPORT);
    setMultiSourceSummaryText(BATH001_SUMMARY);
    setGeneratedSourceListText("generated_source/bath001-hero.png\ngenerated_source/bath001-benefit.png");
    setResult(null);
  }

  return (
    <>
      <PageHeader
        title="Detail Page Draft Review / Preview"
        description="Import Detail Page Engine MVP outputs, preview generated HTML, inspect render reports, and mark drafts as final candidates."
      />

      <EngineSafetyBanner />

      <WhatThisPageDoes />

      {importedArtifact ? (
        <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
          <h2 className="font-semibold">가져온 상세페이지 결과물이 준비되었습니다.</h2>
          <p className="mt-1">자동 게시하지 않습니다. 검토 후 사용해야 합니다.</p>
          <button type="button" onClick={loadImportedArtifact} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">가져온 결과물 불러오기</button>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">Import product-detail-page-auto artifacts</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Run the external engine outside Commerce OS OPS CENTER, then paste or upload detailpage_final.html, detailpage_render_report.json, multi_source_summary.json, and an optional generated_source file list.
        </p>
        <label className="mt-4 block text-xs font-semibold text-slate-600" htmlFor="product-code">product_code</label>
        <input id="product-code" value={productCode} onChange={(event) => setProductCode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ImportField id="html" label="detailpage_final.html" value={html} onChange={setHtml} onFile={(event) => loadFile(event, setHtml)} />
          <ImportField id="report" label="detailpage_render_report.json" value={renderReportText} onChange={setRenderReportText} onFile={(event) => loadFile(event, setRenderReportText)} />
          <ImportField id="summary" label="multi_source_summary.json" value={multiSourceSummaryText} onChange={setMultiSourceSummaryText} onFile={(event) => loadFile(event, setMultiSourceSummaryText)} />
          <ImportField id="generated" label="generated_source file list (optional)" value={generatedSourceListText} onChange={setGeneratedSourceListText} onFile={(event) => loadFile(event, setGeneratedSourceListText)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={parsePreview} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Parse / Preview</button>
          <button type="button" onClick={loadBathSample} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Load BATH001 sample</button>
        </div>
      </section>

      {result ? <ReviewResult result={result} reviewStatus={reviewStatus} setReviewStatus={setReviewStatus} memo={memo} setMemo={setMemo} exportText={exportText} copyStatus={copyStatus} setCopyStatus={setCopyStatus} /> : null}
    </>
  );
}

function EngineSafetyBanner() {
  return (
    <section className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <h2 className="font-semibold">Engine Artifact Review safety status</h2>
      <p className="mt-1">
        This page reviews imported external engine outputs only. No external
        engine is executed from this page, no Shopling API call is made, and no
        production publishing occurs.
      </p>
      <p className="mt-1">
        Human approval is required before any future execution. Safety flags:
        externalEngineExecution={String(reviewSummary.safetyFlags.externalEngineExecution)},
        previewOnly={String(reviewSummary.safetyFlags.previewOnly)}.
      </p>
    </section>
  );
}

function WhatThisPageDoes() {
  return (
    <section className="mb-6 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <h2 className="font-semibold">What this page does</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Imports detailpage_final.html.</li>
          <li>Imports render report JSON.</li>
          <li>Imports multi-source summary JSON.</li>
          <li>Shows sandboxed preview.</li>
          <li>Allows human review memo/status.</li>
          <li>Exports reviewed draft artifact.</li>
        </ul>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h2 className="font-semibold text-slate-950">What this page does not do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Does not run product-detail-page-auto directly.</li>
          <li>Does not call 1688.</li>
          <li>Does not call OpenAI.</li>
          <li>Does not generate images.</li>
          <li>Does not publish product pages.</li>
          <li>Does not upload to sales channels.</li>
        </ul>
      </div>
    </section>
  );
}

function ImportField({ id, label, value, onChange, onFile }: { id: string; label: string; value: string; onChange: (value: string) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <div><div className="flex items-center justify-between gap-3"><label htmlFor={id} className="text-xs font-semibold text-slate-600">{label}</label><input type="file" onChange={onFile} className="max-w-44 text-xs text-slate-500" /></div><textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 min-h-40 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></div>;
}

function ReviewResult({ result, reviewStatus, setReviewStatus, memo, setMemo, exportText, copyStatus, setCopyStatus }: { result: DetailPageDraftParseResult; reviewStatus: ReviewStatus; setReviewStatus: (value: ReviewStatus) => void; memo: string; setMemo: (value: string) => void; exportText: string; copyStatus: string; setCopyStatus: (value: string) => void }) {
  const report = result.renderReport.data;
  const summary = result.multiSourceSummary.data;
  const missingRoles = [...(report?.missing_roles ?? []), ...(summary?.missing_roles ?? [])];
  return <div className="mt-6 space-y-6">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Draft summary">
      <SummaryCard label="product_code" value={result.productCode || "Missing"} />
      <SummaryCard label="classification" value={result.classification} />
      <SummaryCard label="mvp_pass" value={String(report?.mvp_pass ?? false)} />
      <SummaryCard label="rendered blocks" value={report?.rendered_block_count ?? 0} />
      <SummaryCard label="rendered images" value={report?.rendered_image_count ?? 0} />
      <SummaryCard label="generated images used" value={report?.generated_images_used ?? 0} />
      <SummaryCard label="missing roles" value={missingRoles.length} />
      <SummaryCard label="warnings" value={report?.warnings.length ?? 0} />
      <SummaryCard label="collection errors" value={summary?.collection_errors.length ?? 0} />
      {typeof report?.quality_score === "number" ? <SummaryCard label="quality score" value={report.quality_score} /> : null}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Validation</h2><List items={[...result.validationErrors, ...result.validationWarnings]} empty="No validation messages." /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Role coverage</h2><p className="mt-3 text-sm"><strong>selected_roles:</strong> {(report?.selected_roles ?? []).join(", ") || "None provided"}</p><p className="mt-2 text-sm"><strong>missing_roles:</strong> {missingRoles.join(", ") || "None"}</p><p className="mt-2 text-sm"><strong>new_roles:</strong> {(summary?.new_roles ?? []).join(", ") || "None"}</p></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Generated images</h2><p className="mt-1 text-sm text-amber-700">Generated images require human review before final use.</p><p className="mt-3 text-sm"><strong>generated_images_used:</strong> {report?.generated_images_used ?? 0}</p><List items={result.generatedSourceFiles} empty="No generated_source file names pasted." /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Artifact list</h2><List items={["detailpage_final.html", "detailpage_render_report.json", "multi_source_summary.json", "generated_source"]} /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Preview-only HTML</h2><p className="mt-1 text-sm text-slate-600">Sandboxed iframe preview. Scripts, forms, popups, and top navigation are not permitted.</p><iframe title="Detail page draft HTML preview" sandbox="" srcDoc={result.html} className="mt-4 h-[480px] w-full rounded-lg border border-slate-300 bg-white" /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Review decision (client-side only)</h2><div className="mt-3 flex flex-wrap gap-3">{(Object.keys(reviewStatusLabels) as ReviewStatus[]).map((status) => <label key={status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={reviewStatus === status} onChange={() => setReviewStatus(status)} />{reviewStatusLabels[status]}</label>)}</div><textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Reviewer memo" className="mt-4 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => { void navigator.clipboard.writeText(exportText).then(() => setCopyStatus("Reviewed draft JSON copied.")); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Copy reviewed JSON</button><a href={`data:application/json;charset=utf-8,${encodeURIComponent(exportText)}`} download={`${result.productCode || "detail-page-draft"}-review.json`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download reviewed JSON</a></div>{copyStatus ? <p className="mt-2 text-xs text-emerald-700">{copyStatus}</p> : null}</section>
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></article>;
}

function List({ items, empty = "None" }: { items: string[]; empty?: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-slate-500">{empty}</p> : <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}
