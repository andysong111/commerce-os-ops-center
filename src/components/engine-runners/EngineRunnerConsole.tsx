"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { persistGeneratedDetailPageProductCode } from "@/lib/engineRunnerFormState";
import { addEngineRunnerHistoryItem } from "@/lib/engineRunnerHistory";
import { formatBrowserLocalDateTime } from "@/lib/browserTime";
import { EngineRunnerHistoryPreview } from "./EngineRunnerHistoryPreview";
import type {
  EngineRunnerConfig,
  EngineRunnerMode,
} from "@/lib/engineRunnerTypes";

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
  helpText?: string;
};

const HIDDEN_KEYWORD_RUN_IDS_STORAGE_KEY = "commerce-os:hidden-keyword-run-ids";

function readHiddenKeywordRunIds() {
  if (typeof window === "undefined") return new Set<number>();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(HIDDEN_KEYWORD_RUN_IDS_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.map((id) => Number(id)).filter(Number.isFinite)
        : [],
    );
  } catch {
    return new Set<number>();
  }
}

function persistHiddenKeywordRunIds(ids: Set<number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    HIDDEN_KEYWORD_RUN_IDS_STORAGE_KEY,
    JSON.stringify([...ids]),
  );
}

function describeRunStatus(status: string | null, conclusion: string | null) {
  if (status === "completed" && conclusion === "success") return "실행 성공";
  if (status === "completed" && conclusion === "failure") return "실행 실패";
  if (status === "completed") return `실행 완료 (${conclusion ?? "결과 대기"})`;
  if (status === "in_progress" || status === "queued" || status === "pending")
    return "실행 중입니다";
  return status ?? "상태를 확인하고 있습니다";
}

export function EngineRunnerConsole({
  config,
  tokenConfigured,
  safetyBanner,
  fields,
}: {
  config: EngineRunnerConfig;
  tokenConfigured: boolean;
  safetyBanner: string;
  fields: readonly Field[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(
    null,
  );
  const [runsResult, setRunsResult] = useState<RunsResult | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [importingArtifactId, setImportingArtifactId] = useState<number | null>(
    null,
  );
  const [artifactImport, setArtifactImport] = useState<{
    state: "loading" | "success" | "error";
    message: string;
    reviewRoute?: string;
    missingFiles?: string[];
    summary?: {
      totalRows: number;
      autoRows: number;
      manualRows: number;
      blockedRows: number;
    };
  } | null>(null);
  const [runFilter, setRunFilter] = useState<
    "all" | "success" | "failure" | "artifact"
  >("all");
  const [hiddenKeywordRunIds, setHiddenKeywordRunIds] = useState<Set<number>>(
    () =>
      config.kind === "keyword_engine" ? readHiddenKeywordRunIds() : new Set(),
  );

  const collectPayload = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const mode = formData.get("mode")?.toString() as EngineRunnerMode;
    const inputs = Object.fromEntries(
      fields.map((field) => [
        field.name,
        formData.get(field.name)?.toString() ?? "",
      ]),
    );

    return { kind: config.kind, mode, inputs };
  };

  const refreshRuns = async () => {
    setRunsLoading(true);
    try {
      const response = await fetch(
        `/api/engine-runners/runs?kind=${config.kind}`,
      );
      const data = await response.json();
      setRunsResult(data);
      if (!response.ok) {
        setMessage(data.message ?? "최근 실행 내역을 불러오지 못했습니다.");
      }
    } finally {
      setRunsLoading(false);
    }
  };

  const handoffStorageKey =
    config.kind === "keyword_engine"
      ? "opsCenter.keywordEngine.importedArtifact.v1"
      : "opsCenter.detailPageEngine.importedArtifact.v1";
  const isKeywordRunner = config.kind === "keyword_engine";
  const operationSummary = isKeywordRunner
    ? "샵플링 상품코드(goods_key)를 입력하고 키워드 엔진을 실행하세요. 결과물이 생성되면 키워드 검토 단계로 가져와 검토합니다."
    : "1688 상품 링크를 입력하고 상세페이지 엔진을 실행하세요. 상품코드는 비워두면 자동 생성됩니다. 결과물이 생성되면 상세페이지 검토/미리보기로 가져와 확인합니다.";
  const stepLabels = isKeywordRunner
    ? ["상품번호 입력", "키워드 엔진 실행", "결과물 가져와서 검토"]
    : ["1688 링크 입력", "상세페이지 엔진 실행", "결과물 가져와서 검토"];
  const importButtonLabel = isKeywordRunner
    ? "결과 가져오기 및 검토 시작"
    : "결과물 가져와서 검토하기";
  const openReviewLabel = "검토 화면 열기";
  const reviewScreenLabel = "검토 화면 열기";
  const importSafetyText = isKeywordRunner
    ? "가져온 키워드는 샵플링에 자동 반영되지 않습니다. 검토/승인 큐에서 사람이 확인해야 합니다."
    : "가져온 상세페이지는 자동 게시되지 않습니다. 검토/미리보기 화면에서 사람이 확인해야 합니다.";
  const dispatchButtonLabel = isKeywordRunner
    ? "키워드 엔진 실행하기"
    : "상세페이지 엔진 실행하기";
  const emptyRunsMessage = isKeywordRunner
    ? "아직 실행 내역이 없습니다. 상품번호를 입력하고 키워드 엔진을 실행해 주세요."
    : "아직 실행 내역이 없습니다. 1688 링크를 입력하고 상세페이지 엔진을 실행해 주세요.";
  const prioritizedRuns = runsResult?.runs
    ? [...runsResult.runs].sort((left, right) => {
        const score = (run: RunnerRun) =>
          run.artifacts.some((artifact) => artifact.expected)
            ? 3
            : ["in_progress", "queued", "pending"].includes(run.status ?? "")
              ? 2
              : run.status === "completed" && run.conclusion === "failure"
                ? 1
                : 0;
        return score(right) - score(left);
      })
    : [];
  const visiblePrioritizedRuns = isKeywordRunner
    ? prioritizedRuns.filter((run) => !hiddenKeywordRunIds.has(run.id))
    : prioritizedRuns;
  const latestRun = visiblePrioritizedRuns[0];
  const latestExpectedArtifact = latestRun?.artifacts.find(
    (artifact) => artifact.expected,
  );
  const filteredRuns = visiblePrioritizedRuns.filter((run) => {
    if (runFilter === "success")
      return run.status === "completed" && run.conclusion === "success";
    if (runFilter === "failure")
      return run.status === "completed" && run.conclusion === "failure";
    if (runFilter === "artifact")
      return run.artifacts.some((artifact) => artifact.expected);
    return true;
  });
  function hideKeywordRun(runId: number) {
    const next = new Set(hiddenKeywordRunIds);
    next.add(runId);
    setHiddenKeywordRunIds(next);
    persistHiddenKeywordRunIds(next);
  }

  function clearHiddenKeywordRuns() {
    setHiddenKeywordRunIds(new Set());
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(HIDDEN_KEYWORD_RUN_IDS_STORAGE_KEY);
    }
  }

  const activeStep =
    artifactImport?.state === "success" && artifactImport.reviewRoute
      ? 4
      : latestExpectedArtifact
        ? 3
        : preview || dispatchResult
          ? 2
          : 1;

  const importArtifact = async (run: RunnerRun, artifact: RunArtifact) => {
    setImportingArtifactId(artifact.id);
    setArtifactImport({
      state: "loading",
      message:
        "GitHub Actions 산출물을 가져오는 중입니다. 잠시만 기다려 주세요.",
    });
    const reportImportError = (diagnostic: {
      status?: number;
      message?: string;
      missingFiles?: string[];
    }) => {
      const missingFiles = diagnostic.missingFiles?.filter(Boolean) ?? [];
      const safeMessage =
        diagnostic.message?.trim() ||
        (missingFiles.length > 0
          ? "검토용 파일을 찾지 못했습니다."
          : "결과물 가져오기에 실패했습니다.");
      setArtifactImport({
        state: "error",
        message: `${safeMessage} 다시 실행 결과 확인하기를 누른 뒤 재시도해 주세요.`,
        missingFiles,
      });
      if (process.env.NODE_ENV === "development") {
        console.error("Keyword artifact import failed", {
          status: diagnostic.status,
          message: safeMessage,
          missingFiles,
        });
      }
    };
    try {
      const response = await fetch(
        "/api/engine-runners/artifacts/import-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: config.kind,
            runId: run.id,
            artifactId: artifact.id,
          }),
        },
      );
      const data = await response.json().catch(() => ({
        ok: false,
        message: "GitHub artifact를 다운로드하지 못했습니다.",
      }));
      if (!response.ok || !data.ok) {
        reportImportError({
          status: response.status,
          message: data.message,
          missingFiles: Array.isArray(data.missingFiles)
            ? data.missingFiles
            : undefined,
        });
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
      window.sessionStorage.setItem(
        handoffStorageKey,
        JSON.stringify(handoffPayload),
      );
      addEngineRunnerHistoryItem({
        kind: config.kind,
        type: "artifact_imported",
        title: isKeywordRunner
          ? "키워드 결과물 가져오기 완료"
          : "상세페이지 결과물 가져오기 완료",
        summary: isKeywordRunner
          ? "키워드 엔진 결과물을 검토/승인 큐로 가져왔습니다."
          : "상세페이지 엔진 결과물을 검토/미리보기 화면으로 가져왔습니다.",
        input: {},
        github: {
          runId: run.id,
          artifactId: artifact.id,
          artifactName: artifact.name,
        },
        reviewRoute: data.reviewRoute,
        status: "imported",
      });
      const countCsvRows = (value: unknown) =>
        Math.max(
          0,
          String(value ?? "")
            .split("\n")
            .filter((line) => line.trim()).length - 1,
        );
      const autoRows = countCsvRows(
        data.files?.["keyword_mvp_approval_sheet.csv"],
      );
      const manualRows = countCsvRows(
        data.files?.["keyword_mvp_manual_candidates.csv"],
      );
      const reviewRoute = isKeywordRunner
        ? `${data.reviewRoute}?from=keyword-runner`
        : data.reviewRoute;
      setArtifactImport({
        state: "success",
        message: isKeywordRunner
          ? "결과물을 가져왔습니다. 검토 화면으로 이동합니다."
          : "산출물을 가져와 검수용으로 보관했습니다.",
        reviewRoute,
        summary: isKeywordRunner
          ? {
              totalRows: autoRows + manualRows,
              autoRows,
              manualRows,
              blockedRows: 0,
            }
          : undefined,
      });
      if (isKeywordRunner && typeof router?.push === "function") {
        try {
          router.push(reviewRoute);
        } catch (navigationError) {
          if (process.env.NODE_ENV === "development") {
            console.error("Keyword artifact review navigation failed", {
              message:
                navigationError instanceof Error
                  ? navigationError.message
                  : "router.push failed",
            });
          }
        }
      }
    } catch (error) {
      reportImportError({
        message:
          error instanceof Error && error.message
            ? error.message
            : "GitHub artifact를 다운로드하지 못했습니다.",
      });
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
      persistGeneratedDetailPageProductCode(config.kind, form, data);
      setMessage("입력값을 확인했습니다.");
      return;
    }
    setDispatchResult(data);
    const formData = new FormData(form);
    addEngineRunnerHistoryItem({
      kind: config.kind,
      type: "dispatch_requested",
      title: isKeywordRunner
        ? "키워드 엔진 실행 요청"
        : "상세페이지 엔진 실행 요청",
      summary: isKeywordRunner
        ? `상품번호 ${formData.get("goods_key")?.toString() ?? ""} 기준으로 키워드 엔진 실행을 요청했습니다.`
        : "1688 링크 기준으로 상세페이지 엔진 실행을 요청했습니다.",
      input: isKeywordRunner
        ? {
            goodsKey: formData.get("goods_key")?.toString() ?? "",
            seedKeyword: formData.get("seed_keyword")?.toString() || undefined,
          }
        : {
            sourceLink: formData.get("source_link")?.toString() ?? "",
            productCode: formData.get("product_code")?.toString() || undefined,
          },
      github: {
        repo: data.repo,
        workflowFile: data.workflowFile,
        actionsUrl: data.actionsUrl,
      },
      status: "requested",
    });
    setMessage(
      "실행을 요청했습니다. GitHub는 run id를 즉시 반환하지 않습니다. 몇 초 뒤 실행 결과 확인하기를 눌러주세요.",
    );
    window.setTimeout(() => {
      void refreshRuns();
    }, 5000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
        {safetyBanner}
      </div>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-blue-950">오늘 할 일</h2>
        <p className="mt-2 text-sm text-blue-900">{operationSummary}</p>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const isActive = activeStep === stepNumber;
          const isDone = activeStep > stepNumber;
          return (
            <div
              key={label}
              className={`rounded-xl border p-4 text-sm shadow-sm ${isActive ? "border-blue-500 bg-blue-50 text-blue-950" : isDone ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-600"}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">
                Step {stepNumber}
              </p>
              <p className="mt-1 font-bold">{label}</p>
            </div>
          );
        })}
        <div
          className={`rounded-xl border p-4 text-sm shadow-sm ${activeStep === 4 ? "border-emerald-500 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-500"}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide">Done</p>
          <p className="mt-1 font-bold">검토 화면으로 이동</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => event.preventDefault()}
        >
          {fields.map((field) => (
            <label
              key={field.name}
              className="block text-sm font-medium text-slate-700"
            >
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
              {field.helpText ? (
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  {field.helpText}
                </span>
              ) : null}
            </label>
          ))}

          <label className="block text-sm font-medium text-slate-700">
            실행 모드
            <select
              name="mode"
              defaultValue={config.supportedModes[0]}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {config.supportedModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "generate_artifacts"
                    ? "검토용 상세페이지 생성"
                    : mode}
                </option>
              ))}
            </select>
          </label>

          {!tokenConfigured ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
              GitHub dispatch token이 설정되지 않았습니다.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {!preview ? (
              <button
                type="button"
                onClick={(event) =>
                  postRunnerRequest(
                    "/api/engine-runners/dispatch-preview",
                    event.currentTarget.form!,
                  )
                }
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                입력값 확인
              </button>
            ) : null}
            {preview && !dispatchResult ? (
              <button
                type="button"
                disabled={!tokenConfigured}
                onClick={(event) =>
                  postRunnerRequest(
                    "/api/engine-runners/dispatch",
                    event.currentTarget.form!,
                  )
                }
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {dispatchButtonLabel}
              </button>
            ) : null}
            {dispatchResult && !latestExpectedArtifact ? (
              <button
                type="button"
                onClick={refreshRuns}
                disabled={runsLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                {runsLoading ? "확인 중…" : "실행 결과 확인하기"}
              </button>
            ) : null}
            {artifactImport?.reviewRoute ? (
              <Link
                href={artifactImport.reviewRoute}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
              >
                {reviewScreenLabel}
              </Link>
            ) : null}
            {preview ? (
              <button
                type="button"
                onClick={(event) =>
                  postRunnerRequest(
                    "/api/engine-runners/dispatch-preview",
                    event.currentTarget.form!,
                  )
                }
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                입력값 다시 확인
              </button>
            ) : null}
            {!artifactImport?.reviewRoute ? (
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-500">
                아직 가져온 결과물이 없습니다. 먼저 결과물을 가져와 주세요.
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              최근 엔진 실행 결과
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              엔진 실행이 끝났는지, 가져올 결과물이 준비됐는지 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshRuns}
            disabled={runsLoading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            {runsLoading ? "확인 중…" : "실행 결과 확인하기"}
          </button>
        </div>
        <p className="mt-2 text-xs font-medium text-slate-500">
          표시 시간은 현재 브라우저 시간대 기준입니다.
        </p>
        {isKeywordRunner ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <p>
              GitHub 실행 기록은 삭제되지 않고, 이 브라우저의 OPS CENTER
              목록에서만 숨겨집니다.
            </p>
            <button
              type="button"
              onClick={clearHiddenKeywordRuns}
              disabled={hiddenKeywordRunIds.size === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              숨긴 목록 초기화
            </button>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: "전체", value: "all" },
            { label: "성공", value: "success" },
            { label: "실패", value: "failure" },
            { label: "결과물 있음", value: "artifact" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRunFilter(option.value as typeof runFilter)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${runFilter === option.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {latestExpectedArtifact ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            가져올 결과물이 준비되었습니다. 아래 버튼을 눌러 검토 단계로
            가져오세요.
          </p>
        ) : null}
        {latestRun?.status === "completed" &&
        latestRun.conclusion === "failure" ? (
          isKeywordRunner ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <h3 className="font-bold">환경변수 설정이 필요합니다</h3>
              <p className="mt-1">
                키워드 엔진 실패 로그에 LOGIN_ID, COMPANY_ID, API_AUTH_KEY,
                SHOPLING_BASE_URL 또는 필수 환경 변수 누락이 표시되면 GitHub
                Actions Secrets 설정이 필요합니다.
              </p>
              <p className="mt-1 text-red-800">설정 후 다시 실행하면 됩니다.</p>
              <Link
                href="/engine-env-setup"
                className="mt-3 inline-block rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white"
              >
                엔진 환경변수 설정하기
              </Link>
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              이 실행은 실패했습니다. 같은 상품을 다시 실행할 수 있으며, 이전
              실패 이력은 결과물 가져오기에 영향을 주지 않습니다.
            </p>
          )
        ) : null}
        {runsResult?.status === "not_configured" ? (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
            GitHub Actions 실행 모니터링이 아직 설정되지 않았습니다.
          </p>
        ) : null}
        {runsResult && visiblePrioritizedRuns.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">
            {emptyRunsMessage}
          </p>
        ) : null}
        <div className="mt-4 space-y-3">
          {filteredRuns.map((run) => {
            const expectedArtifact = run.artifacts.find(
              (artifact) => artifact.expected,
            );
            return (
              <article
                key={run.id}
                className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700"
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <strong>
                      {describeRunStatus(run.status, run.conclusion)}
                    </strong>
                  </span>
                  <span>생성: {formatBrowserLocalDateTime(run.createdAt)}</span>
                  <Link
                    className="font-semibold text-blue-700 underline"
                    href={run.htmlUrl}
                  >
                    자세한 실행 로그 보기
                  </Link>
                  {isKeywordRunner ? (
                    <button
                      type="button"
                      onClick={() => hideKeywordRun(run.id)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                    >
                      목록에서 숨기기
                    </button>
                  ) : null}
                </div>
                <p
                  className={`mt-2 font-medium ${expectedArtifact ? "text-emerald-800" : "text-slate-600"}`}
                >
                  {expectedArtifact
                    ? "가져올 결과물이 준비되었습니다"
                    : run.status === "completed" && run.conclusion === "failure"
                      ? "이전 실패 이력"
                      : "아직 가져올 결과물이 없습니다"}
                </p>
                {!expectedArtifact ? (
                  <p className="mt-1 text-slate-500">
                    {run.status === "completed" && run.conclusion === "failure"
                      ? "이 실행은 실패했습니다. 같은 상품을 다시 실행할 수 있으며, 이전 실패 이력은 결과물 가져오기에 영향을 주지 않습니다."
                      : "엔진 실행이 끝나기 전에는 결과물이 보이지 않을 수 있습니다. 잠시 후 다시 확인해 주세요."}
                  </p>
                ) : null}
                {expectedArtifact ? (
                  <div className="mt-1 text-emerald-800">
                    <p>
                      산출물: {expectedArtifact.name}
                      {expectedArtifact.expired ? " (만료됨)" : ""}
                    </p>
                    <p>{importSafetyText}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          expectedArtifact.expired ||
                          importingArtifactId === expectedArtifact.id
                        }
                        onClick={() => importArtifact(run, expectedArtifact)}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {importingArtifactId === expectedArtifact.id
                          ? "결과 가져오는 중..."
                          : importButtonLabel}
                      </button>
                      {artifactImport?.state === "success" &&
                      artifactImport.reviewRoute ? (
                        <Link
                          className="font-semibold text-blue-700 underline"
                          href={artifactImport.reviewRoute}
                        >
                          검토 화면으로 이동
                        </Link>
                      ) : (
                        <span className="text-xs font-semibold text-slate-500">
                          {importingArtifactId === expectedArtifact.id
                            ? "결과물을 가져오는 중입니다."
                            : "누르면 결과물을 가져온 뒤 검토 화면으로 이동합니다."}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {artifactImport ? (
        <section
          className={`rounded-xl border p-4 text-sm ${
            artifactImport.state === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <h2 className="font-semibold">
            {artifactImport.state === "error"
              ? "결과물 가져오기 실패"
              : isKeywordRunner
                ? "키워드 검토 단계"
                : "가져오기 완료"}
          </h2>
          <p className="mt-1 font-medium">{artifactImport.message}</p>
          {artifactImport.missingFiles?.length ? (
            <p className="mt-1">
              누락된 파일: {artifactImport.missingFiles.join(", ")}
            </p>
          ) : null}
          {artifactImport.summary ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <span>전체 행 수: {artifactImport.summary.totalRows}</span>
              <span>자동 적용 후보 수: {artifactImport.summary.autoRows}</span>
              <span>수동 검토 수: {artifactImport.summary.manualRows}</span>
              <span>차단/위험 수: {artifactImport.summary.blockedRows}</span>
            </div>
          ) : null}
          {artifactImport.reviewRoute ? (
            <Link
              className="mt-3 inline-block rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white"
              href={artifactImport.reviewRoute}
            >
              {openReviewLabel}
            </Link>
          ) : (
            <p className="mt-2">
              아직 가져온 결과물이 없습니다. 먼저 결과물을 가져와 주세요.
            </p>
          )}
        </section>
      ) : null}
      {message ? (
        <p className="text-sm font-medium text-slate-700">{message}</p>
      ) : null}
      {dispatchResult ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <h2 className="font-semibold">실행 요청 완료</h2>
          <p>
            GitHub는 run id를 즉시 반환하지 않습니다. 몇 초 뒤 실행 결과
            확인하기를 눌러주세요.
          </p>
          <p>
            다음 단계: 결과물이 준비된 뒤 결과 가져오기 및 검토 시작을
            눌러주세요.
          </p>
        </section>
      ) : null}

      <EngineRunnerHistoryPreview kind={config.kind} />

      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          기술 정보 보기
        </summary>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <p>
            실행 대상: {config.repo} / {config.intendedWorkflowFile}
          </p>
          <p>
            Actions 페이지:{" "}
            <Link
              className="font-semibold text-blue-700 underline"
              href={config.actionsUrl}
            >
              {config.actionsUrl}
            </Link>
          </p>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              실행 후 예상 산출물
            </h2>
            <p className="mt-2 font-medium">
              산출물 이름: {config.expectedArtifactName}
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {config.expectedArtifacts.map((artifact) => (
                <li key={artifact}>{artifact}</li>
              ))}
            </ul>
          </div>
          {preview ? (
            <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
              {preview}
            </pre>
          ) : (
            <p className="text-xs text-slate-500">
              raw JSON/debug output은 입력값 확인 후 여기에 표시됩니다.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
