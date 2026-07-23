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
  importedAt?: string;
  finalHtml?: string;
  fullImageHtml?: string;
  finalImageUrl?: string;
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
  final_candidate: "최종 후보로 표시",
  needs_manual_edit: "수정 필요",
  hold_reject: "보류",
};

const reviewSummary = createEngineArtifactReviewSummary({
  source: "product-detail-page-auto",
  statuses: ["imported", "needs_review", "preview_ready", "export_ready", "execution_disabled"],
});

export default function DetailPageDraftReviewPage() {
  const [productCode, setProductCode] = useState("BATH001");
  const [html, setHtml] = useState("");
  const [fullImageHtml, setFullImageHtml] = useState("");
  const [renderReportText, setRenderReportText] = useState("");
  const [multiSourceSummaryText, setMultiSourceSummaryText] = useState("");
  const [fullImageReportText, setFullImageReportText] = useState("");
  const [fullImageManifestText, setFullImageManifestText] = useState("");
  const [copywriterReportText, setCopywriterReportText] = useState("");
  const [polishedBlueprintText, setPolishedBlueprintText] = useState("");
  const [generatedSourceListText, setGeneratedSourceListText] = useState("");
  const [result, setResult] = useState<DetailPageDraftParseResult | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("needs_manual_edit");
  const [memo, setMemo] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [importedArtifact] = useState<ImportedArtifactPayload | null>(() => readImportedArtifactHandoff());

  function loadImportedArtifact() {
    if (!importedArtifact?.files) return;
    setHtml(String(importedArtifact.files["detailpage_shopling_FINAL.html"] ?? importedArtifact.files["detailpage_final.html"] ?? importedArtifact.finalHtml ?? ""));
    setFullImageHtml(String(importedArtifact.files["detailpage_shopling_FULL_IMAGE.html"] ?? importedArtifact.fullImageHtml ?? ""));
    setRenderReportText(String(importedArtifact.files["detailpage_render_report.json"] ?? ""));
    setMultiSourceSummaryText(String(importedArtifact.files["multi_source_summary.json"] ?? ""));
    setFullImageReportText(String(importedArtifact.files["shopling_section_image_export_report.json"] ?? ""));
    setFullImageManifestText(String(importedArtifact.files["shopling_full_image_manifest.json"] ?? ""));
    setCopywriterReportText(String(importedArtifact.files["copywriter_v2_report.json"] ?? ""));
    setPolishedBlueprintText(String(importedArtifact.files["narrative_blueprint_v2.polished.json"] ?? ""));
    setGeneratedSourceListText((importedArtifact.generatedSourceFiles ?? []).join("\n"));
    setResult(null);
    setReviewStatus("needs_manual_edit");
    setMemo("");
    setCopyStatus("Imported detail page engine artifact loaded for human review. Nothing was published.");
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
    setResult(parseDetailPageDraftReview({ productCode, html, fullImageHtml, renderReportText, multiSourceSummaryText, fullImageReportText, fullImageManifestText, copywriterReportText, polishedBlueprintText, generatedSourceListText }));
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
        title="상세페이지 최종 산출물"
        description="1688 링크로 외부 Detail Page Engine을 실행한 뒤 OPS CENTER에서 artifact만 가져와 최종 HTML/JPG를 검토합니다."
      />

      <EngineSafetyBanner />

      <WhatThisPageDoes />

      {importedArtifact ? (
        <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
          <h2 className="font-semibold">Imported detail page engine artifact is ready.</h2>
          <p className="mt-1">The artifact is staged in this browser session only and requires human review. Nothing is published or uploaded to sales channels.</p>
          <button type="button" onClick={loadImportedArtifact} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Load imported artifact</button>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">Import product-detail-page-auto artifacts</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          product-detail-page-auto는 외부 GitHub Actions에서만 실행됩니다. OPS CENTER는 artifact를 가져와 사람이 검토하며, 권장 운영 파일은 detailpage_shopling_FINAL.html입니다.
        </p>
        <label className="mt-4 block text-xs font-semibold text-slate-600" htmlFor="product-code">product_code</label>
        <input id="product-code" value={productCode} onChange={(event) => setProductCode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ImportField id="html" label="detailpage_shopling_FINAL.html / detailpage_final.html" value={html} onChange={setHtml} onFile={(event) => loadFile(event, setHtml)} />
          <ImportField id="full-image-html" label="detailpage_shopling_FULL_IMAGE.html" value={fullImageHtml} onChange={setFullImageHtml} onFile={(event) => loadFile(event, setFullImageHtml)} />
          <ImportField id="report" label="detailpage_render_report.json" value={renderReportText} onChange={setRenderReportText} onFile={(event) => loadFile(event, setRenderReportText)} />
          <ImportField id="summary" label="multi_source_summary.json" value={multiSourceSummaryText} onChange={setMultiSourceSummaryText} onFile={(event) => loadFile(event, setMultiSourceSummaryText)} />
          <ImportField id="image-report" label="shopling_section_image_export_report.json" value={fullImageReportText} onChange={setFullImageReportText} onFile={(event) => loadFile(event, setFullImageReportText)} />
          <ImportField id="manifest" label="shopling_full_image_manifest.json" value={fullImageManifestText} onChange={setFullImageManifestText} onFile={(event) => loadFile(event, setFullImageManifestText)} />
          <ImportField id="copywriter" label="copywriter_v2_report.json" value={copywriterReportText} onChange={setCopywriterReportText} onFile={(event) => loadFile(event, setCopywriterReportText)} />
          <ImportField id="blueprint" label="narrative_blueprint_v2.polished.json" value={polishedBlueprintText} onChange={setPolishedBlueprintText} onFile={(event) => loadFile(event, setPolishedBlueprintText)} />
          <ImportField id="generated" label="generated_source file list (optional)" value={generatedSourceListText} onChange={setGeneratedSourceListText} onFile={(event) => loadFile(event, setGeneratedSourceListText)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={parsePreview} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Parse / Preview</button>
          <button type="button" onClick={loadBathSample} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Load BATH001 sample</button>
        </div>
      </section>

      {result ? <ReviewResult result={result} importedAt={importedArtifact?.importedAt} reviewStatus={reviewStatus} setReviewStatus={setReviewStatus} memo={memo} setMemo={setMemo} exportText={exportText} copyStatus={copyStatus} setCopyStatus={setCopyStatus} /> : null}
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

function ReviewResult({ result, importedAt, reviewStatus, setReviewStatus, memo, setMemo, exportText, copyStatus, setCopyStatus }: { result: DetailPageDraftParseResult; importedAt?: string; reviewStatus: ReviewStatus; setReviewStatus: (value: ReviewStatus) => void; memo: string; setMemo: (value: string) => void; exportText: string; copyStatus: string; setCopyStatus: (value: string) => void }) {
  const report = result.renderReport.data;
  const summary = result.multiSourceSummary.data;
  const production = result.production;
  const imageReport = production.fullImageReport.data ?? production.fullImageManifest.data;
  const copywriter = production.copywriterReport.data;
  const missingRoles = [...(report?.missing_roles ?? []), ...(summary?.missing_roles ?? [])];
  const reportSummary = JSON.stringify({
    product_code: result.productCode,
    production_ready: production.productionReady,
    full_image_width: imageReport?.full_image_width,
    full_image_format: imageReport?.full_image_format,
    copy_quality_score: copywriter?.copy_quality_score,
    final_defects: copywriter?.total_final_defects,
  }, null, 2);
  return <div className="mt-6 space-y-6">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Draft summary">
      <SummaryCard label="product_code" value={result.productCode || "Missing"} />
      <SummaryCard label="production_ready" value={String(production.productionReady)} />
      <SummaryCard label="full_image_width" value={imageReport?.full_image_width ?? "-"} />
      <SummaryCard label="full_image_format" value={imageReport?.full_image_format || "-"} />
      <SummaryCard label="copy_quality_score" value={copywriter?.copy_quality_score ?? "-"} />
      <SummaryCard label="final defects" value={copywriter?.total_final_defects ?? "-"} />
      <SummaryCard label="artifact imported time" value={importedAt || "-"} />
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

    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">최종 산출물 preview</h2>
        {production.finalImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- External artifact preview URLs are operator-supplied and should not be proxied/optimized.
          <img src={production.finalImageUrl} alt="상세페이지 최종 JPG preview" className="mt-4 max-w-full rounded-lg border border-slate-300" />
        ) : <iframe title="Detail page draft HTML preview" sandbox="" srcDoc={production.finalHtml} className="mt-4 h-[640px] w-full rounded-lg border border-slate-300 bg-white" />}
        {!production.finalImageUrl ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">최종 이미지 URL이 없어 HTML sandbox preview를 표시합니다. JPG 다운로드는 비활성화됩니다.</p> : null}
      </div>
      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-slate-950">Action panel</h2>
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={() => copyText(production.finalHtml, "샵플링 HTML 복사 완료", setCopyStatus)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">샵플링 HTML 복사</button>
          <button type="button" onClick={() => copyText(production.finalImageUrl, "이미지 주소 복사 완료", setCopyStatus)} disabled={!production.finalImageUrl} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">이미지 주소 복사</button>
          {production.finalImageUrl ? <a href={production.finalImageUrl} download target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-semibold">JPG 열기/다운로드</a> : <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500">JPG 다운로드 비활성화: 이미지 URL 없음</span>}
          <button type="button" onClick={() => copyText(reportSummary, "Report summary copied", setCopyStatus)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Copy report summary</button>
          <button type="button" onClick={() => setReviewStatus("final_candidate")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">최종 후보로 표시</button>
          <button type="button" onClick={() => setReviewStatus("needs_manual_edit")} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800">수정 필요</button>
          <button type="button" onClick={() => setReviewStatus("hold_reject")} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800">보류</button>
        </div>
        {copyStatus ? <p className="mt-2 text-xs text-emerald-700">{copyStatus}</p> : null}
      </aside>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Validation</h2><List items={[...result.validationErrors, ...result.validationWarnings]} empty="No validation messages." /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Role coverage</h2><p className="mt-3 text-sm"><strong>selected_roles:</strong> {(report?.selected_roles ?? []).join(", ") || "None provided"}</p><p className="mt-2 text-sm"><strong>missing_roles:</strong> {missingRoles.join(", ") || "None"}</p><p className="mt-2 text-sm"><strong>new_roles:</strong> {(summary?.new_roles ?? []).join(", ") || "None"}</p></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Generated images</h2><p className="mt-1 text-sm text-amber-700">Generated images require human review before final use.</p><p className="mt-3 text-sm"><strong>generated_images_used:</strong> {report?.generated_images_used ?? 0}</p><List items={result.generatedSourceFiles} empty="No generated_source file names pasted." /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Artifact list</h2><List items={["detailpage_shopling_FINAL.html", "detailpage_shopling_FULL_IMAGE.html", "shopling_section_image_export_report.json", "shopling_full_image_manifest.json", "copywriter_v2_report.json", "narrative_blueprint_v2.polished.json", "shopling_full_page_image/detailpage_full_1000.jpg (metadata only)", "detailpage_final.html", "detailpage_render_report.json", "multi_source_summary.json", "generated_source"]} /></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Report tabs</h2><div className="mt-3 grid gap-4 lg:grid-cols-4"><ReportBlock title="최종 산출물" text={production.finalHtml} /><ReportBlock title="카피 품질" text={production.copywriterReport.rawText} /><ReportBlock title="이미지/업로드" text={production.fullImageReport.rawText || production.fullImageManifest.rawText} /><ReportBlock title="원본 리포트 JSON" text={JSON.stringify({ renderReport: report, multiSourceSummary: summary, polishedBlueprint: production.polishedBlueprint.data }, null, 2)} /></div></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="font-semibold text-slate-950">Review decision (client-side only)</h2><div className="mt-3 flex flex-wrap gap-3">{(Object.keys(reviewStatusLabels) as ReviewStatus[]).map((status) => <label key={status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={reviewStatus === status} onChange={() => setReviewStatus(status)} />{reviewStatusLabels[status]}</label>)}</div><textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Reviewer memo" className="mt-4 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => { void navigator.clipboard.writeText(exportText).then(() => setCopyStatus("Reviewed draft JSON copied.")); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Copy reviewed JSON</button><a href={`data:application/json;charset=utf-8,${encodeURIComponent(exportText)}`} download={`${result.productCode || "detail-page-draft"}-review.json`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download reviewed JSON</a></div>{copyStatus ? <p className="mt-2 text-xs text-emerald-700">{copyStatus}</p> : null}</section>
  </div>;
}

function copyText(text: string, message: string, setCopyStatus: (value: string) => void) {
  if (!text) {
    setCopyStatus("복사할 값이 없습니다.");
    return;
  }
  void navigator.clipboard.writeText(text).then(() => setCopyStatus(message));
}

function ReportBlock({ title, text }: { title: string; text: string }) {
  return <article><h3 className="text-sm font-semibold text-slate-950">{title}</h3><pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50">{text || "No data"}</pre></article>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></article>;
}

function List({ items, empty = "None" }: { items: string[]; empty?: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-slate-500">{empty}</p> : <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}
