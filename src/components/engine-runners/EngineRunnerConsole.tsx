"use client";

import Link from "next/link";
import { useState } from "react";
import type { EngineRunnerConfig, EngineRunnerMode } from "@/lib/engineRunnerTypes";

type DispatchResult = {
  repo: string;
  workflowFile: string;
  actionsUrl: string;
  expectedArtifactName: string;
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
        setMessage(data.message ?? "Could not load recent runs.");
      }
    } finally {
      setRunsLoading(false);
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
      setMessage(data.message ?? "Runner request failed.");
      return;
    }

    setPreview(JSON.stringify(data, null, 2));
    if (endpoint.endsWith("dispatch-preview")) {
      setMessage("Dispatch preview generated.");
      return;
    }
    setDispatchResult(data);
    setMessage("Dispatch requested. GitHub does not return a run id immediately. Wait a few seconds, then click Refresh runs.");
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
            Dispatch target: {config.repo} / {config.intendedWorkflowFile}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Actions page: <Link className="font-semibold text-blue-700 underline" href={config.actionsUrl}>{config.actionsUrl}</Link>
          </p>
          <p className="mt-1 text-xs text-slate-500">GitHub accepts dispatch requests without returning a run id immediately. Open the Actions page to monitor the run. Artifact import will be added in a later PR.</p>
        </div>

        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          {fields.map((field) => (
            <label key={field.name} className="block text-sm font-medium text-slate-700">
              {field.label}
              {field.type === "textarea" ? (
                <textarea name={field.name} placeholder={field.placeholder} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              ) : (
                <input name={field.name} placeholder={field.placeholder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              )}
            </label>
          ))}

          <label className="block text-sm font-medium text-slate-700">
            Mode
            <select name="mode" defaultValue={config.supportedModes[0]} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {config.supportedModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>

          {!tokenConfigured ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">GitHub dispatch token not configured</p> : null}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch-preview", event.currentTarget.form!)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Preview dispatch</button>
            <button type="button" disabled={!tokenConfigured} onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch", event.currentTarget.form!)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Dispatch GitHub Actions run</button>
            <Link href={config.outputReviewRoute} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{reviewButtonLabel}</Link>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Recent GitHub Actions runs</h2>
            <p className="mt-1 text-sm text-slate-600">Check recent workflow status and whether the expected artifact exists.</p>
          </div>
          <button type="button" onClick={refreshRuns} disabled={runsLoading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{runsLoading ? "Refreshing…" : "Refresh runs"}</button>
        </div>
        {runsResult?.status === "not_configured" ? <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">GitHub Actions run monitoring is not configured yet.</p> : null}
        <div className="mt-4 space-y-3">
          {runsResult?.runs.map((run) => {
            const expectedArtifact = run.artifacts.find((artifact) => artifact.expected);
            return (
              <article key={run.id} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>Status: <strong>{run.status ?? "unknown"}</strong></span>
                  <span>Conclusion: <strong className={run.conclusion === "failure" ? "text-red-700" : ""}>{run.conclusion ?? "pending"}</strong></span>
                  <span>Created: {run.createdAt}</span>
                  <Link className="font-semibold text-blue-700 underline" href={run.htmlUrl}>Actions link</Link>
                </div>
                <p className="mt-2 font-medium">Expected artifact {expectedArtifact ? "found" : "not found"}</p>
                {expectedArtifact ? (
                  <div className="mt-1 text-emerald-800">
                    <p>Artifact: {expectedArtifact.name}{expectedArtifact.expired ? " (expired)" : ""}</p>
                    <p>Artifact import will be added next.</p>
                    <Link className="font-semibold text-blue-700 underline" href={config.outputReviewRoute}>Next step: {reviewButtonLabel}</Link>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Expected artifacts after run</h2>
        <p className="mt-2 text-sm font-medium text-slate-700">Artifact name: {config.expectedArtifactName}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{config.expectedArtifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}</ul>
      </section>

      {message ? <p className="text-sm font-medium text-slate-700">{message}</p> : null}
      {dispatchResult ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <h2 className="font-semibold">Dispatch requested</h2>
          <p>External repo: {dispatchResult.repo}</p>
          <p>Workflow file: {dispatchResult.workflowFile}</p>
          <p>Expected artifact name: {dispatchResult.expectedArtifactName}</p>
          <p>GitHub does not return a run id immediately. Wait a few seconds, then click Refresh runs.</p>
          <p>Next step: open {reviewButtonLabel} after artifacts are ready.</p>
          <Link className="font-semibold text-blue-700 underline" href={String(dispatchResult.actionsUrl)}>Open external repo Actions page</Link>
        </section>
      ) : null}
      {preview ? <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{preview}</pre> : null}
    </div>
  );
}
