"use client";

import Link from "next/link";
import { useState } from "react";
import type { EngineRunnerConfig, EngineRunnerMode } from "@/lib/engineRunnerTypes";

type DispatchResult = {
  repo: string;
  workflowFile: string;
  actionsUrl: string;
  expectedArtifactName: string;
  inputs?: Record<string, string>;
};

type RunArtifact = {
  id: number;
  name: string;
  expired: boolean;
  expected: boolean;
};

type RunnerRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  htmlUrl: string;
  artifacts: RunArtifact[];
};

type RunsResult = {
  status?: string;
  actionsUrl: string;
  expectedArtifactName: string;
  outputReviewRoute: string;
  runs: RunnerRun[];
  message?: string;
};

type Field = {
  name: string;
  label: string;
  type?: "input" | "textarea";
  placeholder?: string;
  helpText?: string;
  advanced?: boolean;
};

export function EngineRunnerConsole({
  config,
  tokenConfigured,
  safetyBanner,
  fields,
  reviewButtonLabel,
}: {
  config: EngineRunnerConfig;
  tokenConfigured: boolean;
  safetyBanner: string;
  fields: readonly Field[];
  reviewButtonLabel: string;
}) {
  const [preview, setPreview] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [runsResult, setRunsResult] = useState<RunsResult | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [importingArtifactId, setImportingArtifactId] = useState<number | null>(null);
  const [artifactImport, setArtifactImport] = useState<{ message: string; reviewRoute?: string } | null>(null);
  const previewData = preview ? JSON.parse(preview) as { repo: string; workflowFile: string; inputs: Record<string, string> } : null;

  const collectPayload = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const mode = formData.get("mode")?.toString() as EngineRunnerMode;
    const inputs = Object.fromEntries(
      fields.map((field) => [field.name, formData.get(field.name)?.toString() ?? ""]),
    );

    return { kind: config.kind, mode, inputs };
  };

  const refreshRuns = async () => {
    setRunsLoading(true);
    try {
      const response = await fetch(`/api/engine-runners/runs?kind=${config.kind}`);
      const data = await response.json();
      setRunsResult(data);
      if (!response.ok) {
        setMessage(data.message ?? "최근 실행 내역을 불러올 수 없습니다.");
      }
    } finally {
      setRunsLoading(false);
    }
  };

  const handoffStorageKey = config.kind === "keyword_engine"
    ? "opsCenter.keywordEngine.importedArtifact.v1"
    : "opsCenter.detailPageEngine.importedArtifact.v1";
  const importButtonLabel = "결과물 가져오기";
  const openReviewLabel = config.kind === "keyword_engine"
    ? "키워드 검토/승인 큐 열기"
    : "상세페이지 검토/미리보기 열기";
  const importSafetyText = config.kind === "keyword_engine"
    ? "가져온 결과물은 OPS CENTER 검토 화면에만 보관됩니다. Shopling에 자동 반영하지 않습니다."
    : "가져온 결과물은 OPS CENTER 검토 화면에만 보관됩니다. 자동 게시하지 않습니다.";
  const modeLabel = config.kind === "keyword_engine" ? "검토용 생성" : "검토용 상세페이지 생성";
  const mainFields = fields.filter((field) => !field.advanced);
  const advancedFields = fields.filter((field) => field.advanced);

  const importArtifact = async (run: RunnerRun, artifact: RunArtifact) => {
    setArtifactImport(null);
    setImportingArtifactId(artifact.id);
    try {
      const response = await fetch("/api/engine-runners/artifacts/import-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: config.kind, runId: run.id, artifactId: artifact.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setArtifactImport({ message: data.message ?? `Artifact import needs attention: ${(data.missingFiles ?? []).join(", ")}` });
        return;
      }
      const handoffPayload = {
        kind: data.kind,
        source: data.source,
        files: data.files,
        generatedSourceFiles: data.generatedSourceFiles,
        importedAt: new Date().toISOString(),
        notAppliedToShopling: true,
        notPublished: true,
        requiresHumanReview: true,
      };
      window.sessionStorage.setItem(handoffStorageKey, JSON.stringify(handoffPayload));
      setArtifactImport({ message: "결과물을 가져와 검토용으로 준비했습니다.", reviewRoute: data.reviewRoute });
    } catch {
      setArtifactImport({ message: "결과물을 가져오지 못했습니다." });
    } finally {
      setImportingArtifactId(null);
    }
  };

  const postRunnerRequest = async (endpoint: string, form: HTMLFormElement) => {
    setMessage("");
    setDispatchResult(null);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload(form)),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.message ?? "실행 요청에 실패했습니다.");
      return;
    }

    setPreview(JSON.stringify(data, null, 2));
    if (endpoint.endsWith("dispatch-preview")) {
      setMessage("실행 전 미리보기를 생성했습니다.");
      return;
    }
    setDispatchResult(data);
    setMessage("실행 요청 완료. GitHub는 run id를 즉시 반환하지 않습니다. 잠시 후 실행 상태 새로고침을 눌러 확인하세요.");
    window.setTimeout(() => {
      void refreshRuns();
    }, 5000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
        {safetyBanner}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">{config.label}</h2>
          <p className="mt-1 text-sm text-slate-600">
            실행 대상 repo: {config.repo} / {config.intendedWorkflowFile}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            실행 로그 보기: <Link className="font-semibold text-blue-700 underline" href={config.actionsUrl}>{config.actionsUrl}</Link>
          </p>
          <p className="mt-1 text-xs text-slate-500">GitHub는 실행 요청 후 run id를 즉시 반환하지 않습니다. 실행 로그에서 상태를 확인하고 결과물은 OPS CENTER 검토 화면으로 가져와 사람이 검토합니다.</p>
        </div>

        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          {[mainFields, advancedFields].map((group, groupIndex) => groupIndex === 0 ? (
            <div key="main" className="space-y-4">{group.map((field) => <FieldControl key={field.name} field={field} />)}</div>
          ) : group.length ? (
            <details key="advanced" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">고급 옵션</summary>
              <div className="mt-4 space-y-4">{group.map((field) => <FieldControl key={field.name} field={field} />)}</div>
            </details>
          ) : null)}

          <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
            실행 모드: {modeLabel}
            <input type="hidden" name="mode" value={config.supportedModes[0]} />
          </div>

          {!tokenConfigured ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">GitHub 실행 토큰이 설정되지 않았습니다</p> : null}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch-preview", event.currentTarget.form!)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">실행 전 미리보기</button>
            <button type="button" disabled={!tokenConfigured} onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch", event.currentTarget.form!)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">엔진 실행 요청</button>
            <Link href={config.outputReviewRoute} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{reviewButtonLabel}</Link>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">최근 실행 내역</h2>
            <p className="mt-1 text-sm text-slate-600">최근 workflow 상태와 예상 결과물 생성 여부를 확인합니다.</p>
          </div>
          <button type="button" onClick={refreshRuns} disabled={runsLoading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{runsLoading ? "새로고침 중…" : "실행 상태 새로고침"}</button>
        </div>
        {runsResult?.status === "not_configured" ? <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">GitHub Actions 실행 모니터링이 아직 설정되지 않았습니다.</p> : null}
        <div className="mt-4 space-y-3">
          {runsResult?.runs.map((run) => {
            const expectedArtifact = run.artifacts.find((artifact) => artifact.expected);
            return (
              <article key={run.id} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>상태: <strong>{translateRunValue(run.status)}</strong></span>
                  <span>결과: <strong className={run.conclusion === "failure" ? "text-red-700" : ""}>{translateRunValue(run.conclusion ?? "pending")}</strong></span>
                  <span>생성 시간: {run.createdAt}</span>
                  <Link className="font-semibold text-blue-700 underline" href={run.htmlUrl}>실행 로그 보기</Link>
                </div>
                <p className="mt-2 font-medium">{expectedArtifact ? "예상 결과물이 있습니다" : "아직 결과물이 없습니다"}</p>
                {expectedArtifact ? (
                  <div className="mt-1 text-emerald-800">
                    <p>결과물: {expectedArtifact.name}{expectedArtifact.expired ? " (expired)" : ""}</p>
                    <p>{importSafetyText}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={expectedArtifact.expired || importingArtifactId === expectedArtifact.id} onClick={() => importArtifact(run, expectedArtifact)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{importingArtifactId === expectedArtifact.id ? "가져오는 중…" : importButtonLabel}</button>
                      <Link className="font-semibold text-blue-700 underline" href={config.outputReviewRoute}>다음 단계: {reviewButtonLabel}</Link>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">실행 후 예상 결과물</h2>
        <p className="mt-2 text-sm font-medium text-slate-700">결과물 이름: {config.expectedArtifactName}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{config.expectedArtifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}</ul>
      </section>

      {artifactImport ? <p className="text-sm font-medium text-emerald-800">{artifactImport.message} {artifactImport.reviewRoute ? <Link className="ml-2 font-semibold text-blue-700 underline" href={artifactImport.reviewRoute}>{openReviewLabel}</Link> : null}</p> : null}
      {message ? <p className="text-sm font-medium text-slate-700">{message}</p> : null}
      {dispatchResult ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <h2 className="font-semibold">실행 요청 완료</h2>
          <p>실행 대상 repo: {dispatchResult.repo}</p>
          <p>workflow: {dispatchResult.workflowFile}</p>
          <p>예상 결과물: {dispatchResult.expectedArtifactName}</p>
          {dispatchResult.inputs?.product_code ? <p>product_code: {dispatchResult.inputs.product_code}</p> : null}
          {dispatchResult.inputs?.goods_key ? <p>goods_key: {dispatchResult.inputs.goods_key}</p> : null}
          <p>GitHub는 run id를 즉시 반환하지 않습니다. 잠시 후 실행 상태 새로고침을 눌러 확인하세요.</p>
          <p>다음 단계: 결과물이 준비되면 {reviewButtonLabel}</p>
          <Link className="font-semibold text-blue-700 underline" href={String(dispatchResult.actionsUrl)}>외부 repo 실행 로그 보기</Link>
        </section>
      ) : null}
      {previewData ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
          <h2 className="font-semibold">실행 전 미리보기</h2>
          <p>실행 대상 repo: {previewData.repo}</p>
          <p>workflow: {previewData.workflowFile}</p>
          {config.kind === "keyword_engine" ? (
            <>
              <p>goods_key: {previewData.inputs.goods_key}</p>
              <p>seed keyword: {previewData.inputs.seed_keyword || "자동"}</p>
              <p>mode: 검토용 생성</p>
              <p>expected artifact: keyword-engine-mvp-output</p>
              <p>next review page: 키워드 검토/승인 큐</p>
            </>
          ) : (
            <>
              <p>source_link: {previewData.inputs.source_link}</p>
              <p>product_code: {previewData.inputs.product_code}</p>
              <p>mode: 검토용 상세페이지 생성</p>
              <p>expected artifact: detail-page-engine-output</p>
              <p>next review page: 상세페이지 검토/미리보기</p>
            </>
          )}
        </section>
      ) : null}
      {preview ? <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{preview}</pre> : null}
    </div>
  );
}


function FieldControl({ field }: { field: Field }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {field.label}
      {field.type === "textarea" ? (
        <textarea name={field.name} placeholder={field.placeholder} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      ) : (
        <input name={field.name} placeholder={field.placeholder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      )}
      {field.helpText ? <span className="mt-1 block text-xs font-normal text-slate-500">{field.helpText}</span> : null}
    </label>
  );
}

function translateRunValue(value: string | null) {
  if (value === "completed") return "완료";
  if (value === "in_progress") return "실행 중";
  if (value === "pending") return "대기 중";
  if (value === "success") return "성공";
  if (value === "failure") return "실패";
  return value ?? "알 수 없음";
}
