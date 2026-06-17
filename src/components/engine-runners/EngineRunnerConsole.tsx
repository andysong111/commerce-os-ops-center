"use client";

import Link from "next/link";
import { useState } from "react";
import type { EngineRunnerConfig, EngineRunnerMode } from "@/lib/engineRunnerTypes";

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

  const collectPayload = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const mode = formData.get("mode")?.toString() as EngineRunnerMode;
    const inputs = Object.fromEntries(
      fields.map((field) => [field.name, formData.get(field.name)?.toString() ?? ""]),
    );

    return { kind: config.kind, mode, inputs };
  };

  const postRunnerRequest = async (endpoint: string, form: HTMLFormElement) => {
    setMessage("");
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
    setMessage(endpoint.endsWith("dispatch-preview") ? "Dispatch preview generated." : "Dispatch request accepted.");
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
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => event.preventDefault()}
        >
          {fields.map((field) => (
            <label key={field.name} className="block text-sm font-medium text-slate-700">
              {field.label}
              {field.type === "textarea" ? (
                <textarea
                  name={field.name}
                  placeholder={field.placeholder}
                  className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              ) : (
                <input
                  name={field.name}
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              )}
            </label>
          ))}

          <label className="block text-sm font-medium text-slate-700">
            Mode
            <select
              name="mode"
              defaultValue={config.supportedModes[0]}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {config.supportedModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>

          {!tokenConfigured ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
              GitHub dispatch token not configured
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch-preview", event.currentTarget.form!)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Preview dispatch
            </button>
            <button
              type="button"
              disabled={!tokenConfigured}
              onClick={(event) => postRunnerRequest("/api/engine-runners/dispatch", event.currentTarget.form!)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Dispatch GitHub Actions run
            </button>
            <Link
              href={config.outputReviewRoute}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {reviewButtonLabel}
            </Link>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Expected artifacts after run</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {config.expectedArtifacts.map((artifact) => (
            <li key={artifact}>{artifact}</li>
          ))}
        </ul>
      </section>

      {message ? <p className="text-sm font-medium text-slate-700">{message}</p> : null}
      {preview ? (
        <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{preview}</pre>
      ) : null}
    </div>
  );
}
