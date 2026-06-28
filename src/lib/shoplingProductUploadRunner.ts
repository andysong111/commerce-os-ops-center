import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export const SHOPLING_PRODUCT_UPLOAD_CHANNELS = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
] as const;

export type ShoplingProductUploadChannel =
  | ""
  | (typeof SHOPLING_PRODUCT_UPLOAD_CHANNELS)[number];

export type ShoplingProductUploadInput = {
  rowExpression: string;
  channel: string;
  skip_if_goods_key?: boolean;
  dump?: boolean;
  sleep?: unknown;
};

export type ShoplingProductUploadResult = {
  status: "success" | "error" | "blocked" | "timeout" | "queued";
  message?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  exitCode?: number | null;
  commandPreview?: string;
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  rawDumpEnabled?: boolean;
  rawDumpReason?: string;
  githubActionsUrl?: string;
  requestId?: string;
};

const ROW_EXPRESSION_PATTERN = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const MAX_TARGET_COUNT = 300;
const DEFAULT_SLEEP = 1.2;
const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const RAW_DUMP_DISABLED_REASON = "민감정보 보호를 위해 원문 XML 덤프는 비활성화되어 있습니다.";
export const SHOPLING_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export const SHOPLING_PRODUCT_UPLOAD_ALL_CHANNEL_INPUT = "전체 6채널";

type ShoplingProductUploadDispatchConfig = {
  repo: string;
  workflow: string;
  ref: string;
  token: string;
};

export type ShoplingProductUploadActionsResult = {
  status: "success" | "pending" | "error";
  phase?: "request_sent" | "queued" | "running" | "waiting_artifact" | "completed_no_artifact" | "failed" | "artifact_ready" | "unknown";
  message?: string;
  runId?: number;
  runUrl?: string;
  runConclusion?: string | null;
  runStatus?: string;
  artifactName?: string;
  summary?: Record<string, unknown>;
  requestId?: string;
};

type GithubWorkflowRun = {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
};

type GithubArtifact = {
  name?: string;
  archive_download_url?: string;
};

function getRequiredGithubActionsConfig(): ShoplingProductUploadDispatchConfig {
  const repo = process.env.SHOPLING_UPLOAD_REPO?.trim();
  const workflow = process.env.SHOPLING_UPLOAD_WORKFLOW?.trim();
  const ref = process.env.SHOPLING_UPLOAD_REF?.trim();
  const token = process.env.GITHUB_ACTIONS_TOKEN?.trim();

  if (!repo) throw new Error("SHOPLING_UPLOAD_REPO 환경변수가 필요합니다.");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_UPLOAD_REPO는 owner/repo 형식이어야 합니다.");
  }
  if (!workflow) throw new Error("SHOPLING_UPLOAD_WORKFLOW 환경변수가 필요합니다.");
  if (!ref) throw new Error("SHOPLING_UPLOAD_REF 환경변수가 필요합니다.");
  if (!token) throw new Error("GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.");

  return { repo, workflow, ref, token };
}

export function buildShoplingProductUploadActionsRunsUrl(perPage = 10) {
  const config = getRequiredGithubActionsConfig();
  const [owner, repoName] = config.repo.split("/");
  const params = new URLSearchParams({
    branch: config.ref,
    event: "workflow_dispatch",
    per_page: String(perPage),
  });

  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params.toString()}`,
    token: config.token,
  };
}


export function generateShoplingProductUploadRequestId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `shopling-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function isValidShoplingRequestId(requestId: string) {
  return SHOPLING_REQUEST_ID_PATTERN.test(requestId);
}

function githubJsonHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGithubJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API 요청에 실패했습니다. status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`);
  }
  return text ? JSON.parse(text) : {};
}

const SHOPLING_RESULT_SUMMARY_EXACT_PATH = "output/github_actions/result_summary.json";
const SHOPLING_RESULT_SUMMARY_ROOT_PATH = "result_summary.json";
const SHOPLING_RESULT_SUMMARY_ENTRY_SUFFIX = "/result_summary.json";
const SHOPLING_RESULT_SUMMARY_ENTRY_DEBUG_LIMIT = 10;

function findShoplingResultSummaryPath(files: Record<string, Uint8Array>) {
  if (files[SHOPLING_RESULT_SUMMARY_ROOT_PATH]) {
    return SHOPLING_RESULT_SUMMARY_ROOT_PATH;
  }
  if (files[SHOPLING_RESULT_SUMMARY_EXACT_PATH]) {
    return SHOPLING_RESULT_SUMMARY_EXACT_PATH;
  }

  return Object.keys(files)
    .filter((entryName) => entryName.endsWith(SHOPLING_RESULT_SUMMARY_ENTRY_SUFFIX))
    .sort((left, right) => left.localeCompare(right))
    .at(0);
}

function formatArtifactEntryNamesForDebug(entryNames: string[]) {
  const safeEntryNames = entryNames
    .map((entryName) => entryName.replace(/[\r\n\t]/g, " "))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, SHOPLING_RESULT_SUMMARY_ENTRY_DEBUG_LIMIT);

  return safeEntryNames.length > 0 ? safeEntryNames.join(", ") : "(empty)";
}

function artifactContainsRequestId(files: Record<string, Uint8Array>, requestId: string) {
  const decoder = new TextDecoder();
  return Object.entries(files).some(([entryName, bytes]) => {
    if (entryName.includes(requestId)) return true;
    if (bytes.byteLength > 250_000) return false;
    try {
      return decoder.decode(bytes).includes(requestId);
    } catch {
      return false;
    }
  });
}

function extractShoplingUploadResultSummaryFromFiles(files: Record<string, Uint8Array>) {
  const summaryPath = findShoplingResultSummaryPath(files);
  if (!summaryPath) return undefined;
  const summaryText = new TextDecoder().decode(files[summaryPath]);
  return JSON.parse(summaryText) as Record<string, unknown>;
}

export function extractShoplingUploadResultSummary(zipBytes: Uint8Array) {
  const files = unzipSync(zipBytes);
  const summary = extractShoplingUploadResultSummaryFromFiles(files);
  if (!summary) {
    throw new Error(
      `GitHub Actions artifact에서 result_summary.json을 찾을 수 없습니다. artifact entries: ${formatArtifactEntryNamesForDebug(Object.keys(files))}`,
    );
  }
  return summary;
}

export async function fetchShoplingProductUploadActionsResult(requestId?: string): Promise<ShoplingProductUploadActionsResult> {
  if (requestId !== undefined && !isValidShoplingRequestId(requestId)) {
    return { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  }
  if (process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED !== "1") {
    return { status: "error", message: "SHOPLING_PRODUCT_UPLOAD_ENABLED=1 인 경우에만 최근 실행 결과를 가져올 수 있습니다.", requestId };
  }

  let runsRequest;
  try {
    runsRequest = buildShoplingProductUploadActionsRunsUrl(requestId ? 20 : 10);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "GitHub Actions 설정이 올바르지 않습니다.", requestId };
  }

  try {
    const runsResponse = await fetch(runsRequest.url, { headers: githubJsonHeaders(runsRequest.token) });
    const runsJson = await readGithubJson(runsResponse);
    const workflowRuns: GithubWorkflowRun[] = Array.isArray(runsJson.workflow_runs) ? runsJson.workflow_runs : [];

    if (!requestId) {
      const activeRun = workflowRuns.find((run) => run?.status === "queued" || run?.status === "in_progress");
      if (activeRun) {
        const runId = Number(activeRun.id);
        const phase = activeRun.status === "queued" ? "queued" : "running";
        return {
          status: "pending",
          phase,
          message: phase === "queued" ? "상품업로드 실행이 대기열에 있습니다. 곧 시작됩니다." : "상품업로드가 아직 진행 중입니다. 결과 파일이 준비되면 자동으로 다시 확인합니다.",
          requestId,
          runId: Number.isFinite(runId) ? runId : undefined,
          runUrl: typeof activeRun.html_url === "string" ? activeRun.html_url : undefined,
          runStatus: activeRun.status,
          runConclusion: typeof activeRun.conclusion === "string" ? activeRun.conclusion : null,
        };
      }
    }

    const completedRuns = workflowRuns.filter((run) => run?.status === "completed");
    if (completedRuns.length === 0) {
      return {
        status: "pending",
        phase: "request_sent",
        message: requestId
          ? "GitHub Actions 실행을 확인하는 중입니다. 현재 요청 ID와 일치하는 실행 결과를 찾고 있습니다."
          : "완료된 상품업로드 실행 결과가 아직 없습니다. 실행이 끝난 뒤 다시 확인하세요.",
        requestId,
      };
    }

    for (const completedRun of completedRuns) {
      const runId = Number(completedRun.id);
      if (!Number.isFinite(runId)) continue;
      const runConclusion = typeof completedRun.conclusion === "string" ? completedRun.conclusion : null;
      const runUrl = typeof completedRun.html_url === "string" ? completedRun.html_url : undefined;
      if (["failure", "cancelled", "timed_out"].includes(String(runConclusion ?? ""))) {
        if (requestId) continue;
        return {
          status: "error",
          phase: "failed",
          message: "상품업로드 실행이 실패했습니다. GitHub Actions 로그를 확인하세요.",
          runId,
          runUrl,
          runConclusion,
          runStatus: "completed",
        };
      }
      const artifactsUrl = `https://api.github.com/repos/${process.env.SHOPLING_UPLOAD_REPO?.trim()}/actions/runs/${runId}/artifacts`;
      const artifactsResponse = await fetch(artifactsUrl, { headers: githubJsonHeaders(runsRequest.token) });
      const artifactsJson = await readGithubJson(artifactsResponse);
      const artifacts: GithubArtifact[] = Array.isArray(artifactsJson.artifacts) ? artifactsJson.artifacts : [];
      const uploadArtifacts = artifacts.filter((item) => typeof item?.name === "string" && item.name.startsWith("shopling-upload-logs-queue-"));
      if (uploadArtifacts.length === 0) {
        if (requestId) continue;
        return {
          status: "pending",
          phase: "completed_no_artifact",
          message: "실행은 시작되었지만 결과 파일이 아직 준비되지 않았습니다.",
          runId,
          runUrl,
          runConclusion,
          runStatus: "completed",
        };
      }

      for (const artifact of uploadArtifacts) {
        if (!artifact.archive_download_url) continue;
        const zipResponse = await fetch(artifact.archive_download_url, { headers: githubJsonHeaders(runsRequest.token) });
        if (!zipResponse.ok) {
          if (requestId) continue;
          return {
            status: "pending",
            phase: "waiting_artifact",
            message: `GitHub Actions artifact 다운로드에 실패했습니다. status=${zipResponse.status}`,
            runId,
            runUrl,
            runConclusion,
            runStatus: "completed",
            artifactName: artifact.name,
          };
        }
        const zipBytes = new Uint8Array(await zipResponse.arrayBuffer());
        const files = unzipSync(zipBytes);
        const summary = extractShoplingUploadResultSummaryFromFiles(files);
        if (!summary) {
          if (requestId) {
            const artifactNameMatches = typeof artifact.name === "string" && artifact.name.includes(requestId);
            if (!artifactNameMatches && !artifactContainsRequestId(files, requestId)) continue;
            return {
              status: "error",
              phase: "completed_no_artifact",
              message: `현재 요청의 artifact에서 result_summary.json을 찾지 못했습니다. artifact entries: ${formatArtifactEntryNamesForDebug(Object.keys(files))}`,
              runId,
              runUrl,
              runConclusion,
              runStatus: "completed",
              artifactName: artifact.name,
              requestId,
            };
          }
          throw new Error(
            `GitHub Actions artifact에서 result_summary.json을 찾을 수 없습니다. artifact entries: ${formatArtifactEntryNamesForDebug(Object.keys(files))}`,
          );
        }
        const summaryRequestId = typeof summary.request_id === "string" ? summary.request_id : undefined;
        if (requestId && summaryRequestId !== requestId) continue;

        return {
          status: "success",
          phase: "artifact_ready",
          runId,
          runUrl,
          runConclusion,
          runStatus: "completed",
          artifactName: artifact.name,
          summary,
          requestId: summaryRequestId ?? requestId,
        };
      }
    }

    return {
      status: "pending",
      phase: requestId ? "request_sent" : "waiting_artifact",
      message: requestId
        ? "현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다."
        : "실행은 시작되었지만 결과 파일이 아직 준비되지 않았습니다.",
      requestId,
    };
  } catch (error) {
    return { status: "error", phase: "unknown", message: error instanceof Error ? error.message : "최근 실행 결과를 가져오는 중 오류가 발생했습니다.", requestId };
  }
}
export function buildShoplingProductUploadDispatchRequest(input: ShoplingProductUploadInput) {
  const rowExpression = input.rowExpression.trim();
  const channel = input.channel;

  if (!isValidRowExpression(rowExpression)) {
    throw new Error("실재고 시트 행 번호 형식이 올바르지 않습니다.");
  }
  if (!isValidShoplingProductUploadChannel(channel)) {
    throw new Error("지원하지 않는 채널입니다.");
  }

  const targetCount = estimateTargetCount(rowExpression, channel);
  if (targetCount > MAX_TARGET_COUNT) {
    throw new Error(`예상 실행 대상이 ${targetCount}건입니다. 최대 ${MAX_TARGET_COUNT}건까지만 실행할 수 있습니다.`);
  }

  const config = getRequiredGithubActionsConfig();
  const [owner, repoName] = config.repo.split("/");
  const workflowChannel = channel === "" ? SHOPLING_PRODUCT_UPLOAD_ALL_CHANNEL_INPUT : channel;
  const githubActionsUrl = `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`;
  const requestId = generateShoplingProductUploadRequestId();

  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    githubActionsUrl,
    token: config.token,
    requestId,
    body: {
      ref: config.ref,
      inputs: {
        row_expression: rowExpression,
        channel: workflowChannel,
        skip_if_goods_key: input.skip_if_goods_key === true,
        request_id: requestId,
      },
    },
    commandPreview: `GitHub Actions: ${config.workflow} row=${rowExpression} channel=${workflowChannel} skip_if_goods_key=${input.skip_if_goods_key === true} request_id=${requestId}`,
  };
}

export async function dispatchShoplingProductUploadActions(input: ShoplingProductUploadInput): Promise<ShoplingProductUploadResult> {
  let request;
  try {
    request = buildShoplingProductUploadDispatchRequest(input);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다." };
  }

  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${request.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
  });

  if (response.status !== 204 && response.status !== 200) {
    const errorText = await response.text();
    return {
      status: "error",
      message: `GitHub Actions 워크플로 실행 요청에 실패했습니다. status=${response.status}${errorText ? ` body=${errorText.slice(0, 500)}` : ""}`,
      commandPreview: request.commandPreview,
      githubActionsUrl: request.githubActionsUrl,
      requestId: request.requestId,
      stdout: "",
      stderr: "",
      rawDumpEnabled: false,
    };
  }

  return {
    status: "queued",
    message: "GitHub Actions 상품등록 워크플로 실행 요청이 전송되었습니다.",
    commandPreview: request.commandPreview,
    githubActionsUrl: request.githubActionsUrl,
    requestId: request.requestId,
    stdout: "",
    stderr: "",
    rawDumpEnabled: false,
  };
}

export function buildShoplingProductUploadSpawnOptions(engineDir: string) {
  return {
    cwd: engineDir,
    shell: false as const,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  };
}

export function isValidRowExpression(rowExpression: string) {
  return ROW_EXPRESSION_PATTERN.test(rowExpression);
}

export function isValidShoplingProductUploadChannel(
  channel: string,
): channel is ShoplingProductUploadChannel {
  return channel === "" || SHOPLING_PRODUCT_UPLOAD_CHANNELS.includes(channel as never);
}

export function normalizeSleep(value: unknown) {
  if (value === undefined || value === null || value === "") return DEFAULT_SLEEP;
  const sleep = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(sleep) || sleep < 0 || sleep > 10) {
    throw new Error("실행 간격 초는 0 이상 10 이하의 숫자여야 합니다.");
  }
  return sleep;
}

export function countRowsInExpression(rowExpression: string) {
  if (!isValidRowExpression(rowExpression)) {
    throw new Error("실재고 시트 행 번호 형식이 올바르지 않습니다.");
  }

  return rowExpression.split(",").reduce((total, part) => {
    const [startText, endText] = part.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (end < start) {
      throw new Error("행 범위의 종료 번호는 시작 번호보다 작을 수 없습니다.");
    }
    return total + (end - start + 1);
  }, 0);
}

export function estimateTargetCount(rowExpression: string, channel: string) {
  const rowCount = countRowsInExpression(rowExpression);
  const channelCount = channel === "" ? SHOPLING_PRODUCT_UPLOAD_CHANNELS.length : 1;
  return rowCount * channelCount;
}

function quotePreview(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildShoplingProductUploadCommand(input: ShoplingProductUploadInput) {
  const rowExpression = input.rowExpression.trim();
  const channel = input.channel;

  if (!isValidRowExpression(rowExpression)) {
    throw new Error("실재고 시트 행 번호 형식이 올바르지 않습니다.");
  }
  if (!isValidShoplingProductUploadChannel(channel)) {
    throw new Error("지원하지 않는 채널입니다.");
  }

  const sleep = normalizeSleep(input.sleep);
  const targetCount = estimateTargetCount(rowExpression, channel);
  if (targetCount > MAX_TARGET_COUNT) {
    throw new Error(`예상 실행 대상이 ${targetCount}건입니다. 최대 ${MAX_TARGET_COUNT}건까지만 실행할 수 있습니다.`);
  }

  const rawDumpAllowed = process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED === "1";
  const rawDumpEnabled = input.dump === true && rawDumpAllowed;
  const rawDumpReason = input.dump === true && !rawDumpAllowed ? RAW_DUMP_DISABLED_REASON : undefined;

  const args = ["run_batch.py", rowExpression];
  if (channel !== "") args.push("--channel", channel);
  if (input.skip_if_goods_key === true) args.push("--skip_if_goods_key");
  if (rawDumpEnabled) args.push("--dump");
  args.push("--sleep", String(sleep));

  return {
    args,
    commandPreview: ["python", "run_batch.py", quotePreview(rowExpression), ...(channel !== "" ? ["--channel", quotePreview(channel)] : []), ...(input.skip_if_goods_key === true ? ["--skip_if_goods_key"] : []), ...(rawDumpEnabled ? ["--dump"] : []), "--sleep", String(sleep)].join(" "),
    shell: false as const,
    targetCount,
    rawDumpEnabled,
    rawDumpReason,
  };
}

function appendCapped(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString();
  if (next.length <= MAX_OUTPUT_CHARS) return { value: next, truncated: false };
  return { value: next.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

export async function runShoplingProductUpload(input: ShoplingProductUploadInput): Promise<ShoplingProductUploadResult> {
  if (process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED !== "1") {
    return { status: "blocked", message: "SHOPLING_PRODUCT_UPLOAD_ENABLED=1 인 경우에만 실행할 수 있습니다." };
  }

  if (process.env.SHOPLING_PRODUCT_UPLOAD_RUN_MODE === "github_actions") {
    return dispatchShoplingProductUploadActions(input);
  }

  const engineDir = process.env.SHOPLING_PRODUCT_UPLOAD_ENGINE_DIR;
  const python = process.env.SHOPLING_PRODUCT_UPLOAD_PYTHON;
  if (!engineDir || !python) {
    return { status: "error", message: "외부 엔진 경로와 Python 실행 파일 환경변수가 필요합니다." };
  }
  if (!existsSync(path.join(engineDir, "run_batch.py"))) {
    return { status: "error", message: "SHOPLING_PRODUCT_UPLOAD_ENGINE_DIR에서 run_batch.py를 찾을 수 없습니다." };
  }

  let command;
  try {
    command = buildShoplingProductUploadCommand(input);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다." };
  }

  const start = Date.now();
  const startTime = new Date(start).toISOString();
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;

  return new Promise((resolve) => {
    const child = spawn(python, command.args, buildShoplingProductUploadSpawnOptions(engineDir));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      const appended = appendCapped(stdout, chunk);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });
    child.stderr?.on("data", (chunk) => {
      const appended = appendCapped(stderr, chunk);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const end = Date.now();
      resolve({ status: "error", message: error.message, startTime, endTime: new Date(end).toISOString(), durationMs: end - start, commandPreview: command.commandPreview, stdout, stderr, stdoutTruncated, stderrTruncated, rawDumpEnabled: command.rawDumpEnabled, rawDumpReason: command.rawDumpReason });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const end = Date.now();
      resolve({ status: timedOut ? "timeout" : exitCode === 0 ? "success" : "error", startTime, endTime: new Date(end).toISOString(), durationMs: end - start, exitCode, commandPreview: command.commandPreview, stdout, stderr, stdoutTruncated, stderrTruncated, rawDumpEnabled: command.rawDumpEnabled, rawDumpReason: command.rawDumpReason });
    });
  });
}
