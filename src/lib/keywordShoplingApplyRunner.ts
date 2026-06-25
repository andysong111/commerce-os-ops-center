import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

export const KEYWORD_SHOPLING_APPLY_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
export const KEYWORD_SHOPLING_APPLY_ARTIFACT_NAME = "keyword-shopling-apply-result";
export const KEYWORD_SHOPLING_APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING";

type Config = { repo: string; workflow: string; ref: string; token: string };
type Mode = "dry_run" | "apply";
type GithubWorkflowRun = { id?: number; status?: string; conclusion?: string | null; html_url?: string };
type GithubArtifact = { name?: string; archive_download_url?: string };
export type KeywordApplySummary = Partial<Record<"request_id" | "mode" | "status" | "created_at", unknown>> & Partial<Record<"input_item_count" | "valid_item_count" | "blocked_item_count" | "applied_item_count" | "failed_item_count", unknown>> & { dry_run?: unknown; warnings?: unknown };
export type KeywordApplyRow = Record<string, unknown>;

function getConfig(): Config {
  const repo = process.env.KEYWORD_SHOPLING_APPLY_REPO?.trim();
  const workflow = process.env.KEYWORD_SHOPLING_APPLY_WORKFLOW?.trim();
  const ref = process.env.KEYWORD_SHOPLING_APPLY_REF?.trim();
  const token = process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN?.trim();
  if (!repo) throw new Error("KEYWORD_SHOPLING_APPLY_REPO 환경변수가 필요합니다.");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("KEYWORD_SHOPLING_APPLY_REPO는 owner/repo 형식이어야 합니다.");
  if (!workflow) throw new Error("KEYWORD_SHOPLING_APPLY_WORKFLOW 환경변수가 필요합니다.");
  if (!ref) throw new Error("KEYWORD_SHOPLING_APPLY_REF 환경변수가 필요합니다.");
  if (!token) throw new Error("KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN 환경변수가 필요합니다.");
  return { repo, workflow, ref, token };
}
function headers(token: string) { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }; }
async function readJson(response: Response) { const text = await response.text(); if (!response.ok) throw new Error(`GitHub API 요청에 실패했습니다. status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`); return text ? JSON.parse(text) : {}; }
export function generateKeywordShoplingApplyRequestId(now = new Date()) { return `keyword-apply-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(3).toString("hex")}`; }
export function isValidKeywordShoplingApplyRequestId(requestId: string) { return KEYWORD_SHOPLING_APPLY_REQUEST_ID_PATTERN.test(requestId); }
function enabled() { return process.env.KEYWORD_SHOPLING_APPLY_ENABLED === "1"; }

function itemCountFromPlan(json: string) { try { const parsed = JSON.parse(json); if (Array.isArray(parsed)) return parsed.length; return Array.isArray(parsed?.eligibleItems) ? parsed.eligibleItems.length : undefined; } catch { return undefined; } }
async function safeGithubErrorBodyPreview(response: Response) {
  try {
    const text = await response.text();
    if (!text) return "";
    return text
      .replace(/execution_plan_json/gi, "[redacted_plan]")
      .replace(/(token|authorization|password|secret|credential)([\s"':=]+)[^\s"',}]+/gi, "$1$2[redacted]")
      .slice(0, 500);
  } catch {
    return "";
  }
}
export function validateKeywordShoplingApplyInput(input: { execution_plan_json?: unknown; mode?: unknown; confirmation_text?: unknown; max_items?: unknown }) {
  if (typeof input.execution_plan_json !== "string" || input.execution_plan_json.trim().length === 0) throw new Error("execution_plan_json이 필요합니다.");
  JSON.parse(input.execution_plan_json);
  if (input.mode !== "dry_run" && input.mode !== "apply") throw new Error("mode는 dry_run 또는 apply여야 합니다.");
  const maxItems = Number(input.max_items);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("max_items는 1부터 100 사이의 정수여야 합니다.");
  const confirmationText = typeof input.confirmation_text === "string" ? input.confirmation_text.trim() : "";
  if (input.mode === "apply" && confirmationText !== KEYWORD_SHOPLING_APPLY_CONFIRMATION_TEXT) throw new Error("실제 반영은 정확한 확인문구가 필요합니다.");
  return { executionPlanJson: input.execution_plan_json, mode: input.mode as Mode, confirmationText, maxItems, itemCount: itemCountFromPlan(input.execution_plan_json) };
}

export function buildKeywordShoplingApplyDispatchRequest(input: { execution_plan_json?: unknown; mode?: unknown; confirmation_text?: unknown; max_items?: unknown }) {
  const parsed = validateKeywordShoplingApplyInput(input);
  const config = getConfig(); const [owner, repoName] = config.repo.split("/"); const requestId = generateKeywordShoplingApplyRequestId();
  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    githubActionsUrl: `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`,
    token: config.token,
    requestId,
    body: { ref: config.ref, inputs: { execution_plan_json: parsed.executionPlanJson, mode: parsed.mode, confirmation_text: parsed.confirmationText, request_id: requestId, max_items: String(parsed.maxItems) } },
    commandPreview: `GitHub Actions: workflow=${config.workflow} mode=${parsed.mode} item_count=${parsed.itemCount ?? "unknown"} max_items=${parsed.maxItems} request_id=${requestId}`,
  };
}
export async function dispatchKeywordShoplingApplyActions(input: { execution_plan_json?: unknown; mode?: unknown; confirmation_text?: unknown; max_items?: unknown }) {
  if (!enabled()) return { status: "error", message: "KEYWORD_SHOPLING_APPLY_ENABLED=1 인 경우에만 실행할 수 있습니다." };
  let req; try { req = buildKeywordShoplingApplyDispatchRequest(input); } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다." }; }
  const response = await fetch(req.url, { method: "POST", headers: { ...headers(req.token), "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
  if (response.status !== 204 && response.status !== 200) {
    const bodyPreview = await safeGithubErrorBodyPreview(response);
    return { status: "error", message: `GitHub Actions 워크플로 실행 요청에 실패했습니다. status=${response.status}${bodyPreview ? ` body=${bodyPreview}` : ""}`, requestId: req.requestId, githubActionsUrl: req.githubActionsUrl, commandPreview: req.commandPreview };
  }
  return { status: "queued", requestId: req.requestId, githubActionsUrl: req.githubActionsUrl, commandPreview: req.commandPreview, message: "GitHub Actions 키워드 샵플링 반영 워크플로 실행 요청이 전송되었습니다." };
}

function safeJson(value: unknown): KeywordApplySummary { const allowed = ["request_id", "mode", "status", "input_item_count", "valid_item_count", "blocked_item_count", "applied_item_count", "failed_item_count", "dry_run", "warnings", "created_at"]; const out: KeywordApplySummary = {}; if (value && typeof value === "object" && !Array.isArray(value)) for (const key of allowed) (out as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key]; return out; }
function safeRow(row: unknown): KeywordApplyRow | null { if (!row || typeof row !== "object" || Array.isArray(row)) return null; const allowed = ["goods_key", "mall_key", "title_update_status", "site_srch_update_status", "code", "msg", "dry_run", "warning_flags", "reasons"]; const out: KeywordApplyRow = {}; for (const key of allowed) if (key in row) out[key] = (row as Record<string, unknown>)[key]; return out; }
function parseJsonl(text: string) { return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { try { return safeRow(JSON.parse(line)); } catch { return null; } }).filter((row): row is KeywordApplyRow => Boolean(row)); }
function find(files: Record<string, Uint8Array>, name: string) { return files[`output/shopling_apply/${name}`] ? `output/shopling_apply/${name}` : Object.keys(files).find((path) => path.endsWith(`/output/shopling_apply/${name}`) || path.endsWith(`/${name}`) || path === name); }
export function extractKeywordShoplingApplyArtifact(zipBytes: Uint8Array) {
  const files = unzipSync(zipBytes); const decoder = new TextDecoder();
  const summaryPath = find(files, "result_summary.json"); if (!summaryPath) throw new Error("artifact에서 result_summary.json을 찾을 수 없습니다.");
  const read = (name: string) => { const path = find(files, name); return path ? decoder.decode(files[path]) : ""; };
  return { summary: safeJson(JSON.parse(decoder.decode(files[summaryPath]))), applyResults: parseJsonl(read("apply_results.jsonl")), verifyResults: parseJsonl(read("verify_results.jsonl")), blockedItems: parseJsonl(read("blocked_items.jsonl")) };
}
export async function fetchKeywordShoplingApplyActionsResult(requestId?: string, mode?: Mode) {
  if (requestId && !isValidKeywordShoplingApplyRequestId(requestId)) return { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  if (mode !== undefined && mode !== "dry_run" && mode !== "apply") return { status: "error", message: "mode는 dry_run 또는 apply여야 합니다.", requestId };
  if (!enabled()) return { status: "error", message: "KEYWORD_SHOPLING_APPLY_ENABLED=1 인 경우에만 최근 실행 결과를 가져올 수 있습니다.", requestId };
  const config = getConfig(); const [owner, repoName] = config.repo.split("/");
  const params = new URLSearchParams({ branch: config.ref, event: "workflow_dispatch", per_page: requestId ? "30" : "10" });
  try {
    const runsJson = await readJson(await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params}`, { headers: headers(config.token) }));
    const completedRuns = (Array.isArray(runsJson.workflow_runs) ? runsJson.workflow_runs : []).filter((run: GithubWorkflowRun) => run?.status === "completed");
    for (const run of completedRuns) {
      const runId = Number(run.id); if (!Number.isFinite(runId)) continue;
      const artifactsJson = await readJson(await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/runs/${runId}/artifacts`, { headers: headers(config.token) }));
      const artifact = (Array.isArray(artifactsJson.artifacts) ? artifactsJson.artifacts : []).find((item: GithubArtifact) => item?.name === KEYWORD_SHOPLING_APPLY_ARTIFACT_NAME);
      if (!artifact?.archive_download_url) continue;
      const zipResponse = await fetch(artifact.archive_download_url, { headers: headers(config.token) }); if (!zipResponse.ok) continue;
      const extracted = extractKeywordShoplingApplyArtifact(new Uint8Array(await zipResponse.arrayBuffer()));
      const summaryRequestId = typeof extracted.summary.request_id === "string" ? extracted.summary.request_id : undefined; if (requestId && summaryRequestId !== requestId) continue;
      const summaryMode = typeof extracted.summary.mode === "string" ? extracted.summary.mode : undefined;
      if (mode && summaryMode !== mode) {
        if (requestId) return { status: "pending", requestId, message: mode === "apply" ? "가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다. 실제 반영 실행 요청 ID를 확인하세요." : "가져온 결과가 dry_run 결과가 아닙니다." };
        continue;
      }
      return { status: "success", requestId: summaryRequestId ?? requestId, runId, runUrl: run.html_url, runStatus: "completed", runConclusion: typeof run.conclusion === "string" ? run.conclusion : null, artifactName: artifact.name, ...extracted };
    }
    return { status: "pending", requestId, message: "GitHub Actions 실행 또는 결과 artifact가 아직 준비되지 않았습니다. 잠시 후 다시 확인하세요." };
  } catch (error) { return { status: "error", requestId, message: error instanceof Error ? error.message : "최근 실행 결과를 가져오는 중 오류가 발생했습니다." }; }
}
