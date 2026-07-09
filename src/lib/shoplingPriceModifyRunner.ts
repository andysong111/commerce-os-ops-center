import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

export const SHOPLING_PRICE_MODIFY_BATCH = "80";
export const SHOPLING_PRICE_MODIFY_MALL_COUNT = 24;
export const SHOPLING_PRICE_MODIFY_MAX_GOODS_KEY_COUNT = 50;
export const SHOPLING_PRICE_MODIFY_MAX_TARGET_COUNT = 1200;
export const SHOPLING_PRICE_MODIFY_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const GOODS_KEY_PATTERN = /^\d+$/;
const ARTIFACT_NAME = "shopling-price-modify-result-summary";

export const SHOPLING_PRICE_MODIFY_ALLOWED_MALLS = [
  ["SMALL_00001", "옥션"], ["SMALL_00002", "지마켓"], ["SMALL_00003", "11번가"], ["SMALL_00004", "스마트스토어"],
  ["SMALL_00005", "GS SHOP"], ["SMALL_00012", "쿠팡"], ["SMALL_00014", "카페24(1.9)"], ["SMALL_00019", "신세계몰"],
  ["SMALL_00069", "도매꾹"], ["SMALL_00071", "도매창고"], ["SMALL_00101", "카카오톡 스토어"], ["SMALL_00107", "오너클랜"],
  ["SMALL_00112", "에이블리"], ["SMALL_00116", "셀파"], ["SMALL_00130", "롯데ON"], ["SMALL_00165", "셀링콕"],
  ["SMALL_00168", "인큐텐"], ["SMALL_00179", "투비즈온"], ["SMALL_00180", "도매아토즈"], ["SMALL_00186", "AliExpress"],
  ["SMALL_00188", "셀리어스"], ["SMALL_00190", "도매의신"], ["SMALL_00191", "TEMU"], ["SMALL_00194", "토스쇼핑"],
] as const;
const ALLOWED_MALL_KEYS = new Set<string>(SHOPLING_PRICE_MODIFY_ALLOWED_MALLS.map(([mallKey]) => mallKey));
const ROUND_UP_UNITS = new Set([0, 1, 10, 100, 1000]);
export type ShoplingPriceModifyPolicyOverride = { mall_key: string; multiplier: number; add: number; subtract: number; round_up_unit: number };

type Config = { repo: string; workflow: string; ref: string; token: string };
export type ShoplingPriceModifySummary = {
  schema_version?: unknown;
  source?: unknown;
  run_mode?: unknown;
  request_id?: unknown;
  goods_keys?: unknown;
  goods_key_count?: unknown;
  estimated_mall_update_count?: unknown;
  batch?: unknown;
  status?: unknown;
  exit_code?: unknown;
  ok_count?: unknown;
  fail_count?: unknown;
  errors?: unknown;
  created_at?: unknown;
  policy_override_count?: unknown;
  policy_overrides?: unknown;
  consumer_price_input?: unknown;
  sell_price_input?: unknown;
  purchase_price_input?: unknown;
  three_column_payload_count?: unknown;
  missing_consumer_price_count?: unknown;
  missing_purchase_price_count?: unknown;
  blocked_missing_base_price_count?: unknown;
  auto_price_policy_used?: unknown;
  base_price_input_required?: unknown;
};
export type ShoplingPriceModifyActionsResult = {
  status: "success" | "pending" | "error";
  message?: string;
  requestId?: string;
  runId?: number;
  runUrl?: string;
  runConclusion?: string | null;
  runStatus?: string;
  artifactName?: string;
  summary?: ShoplingPriceModifySummary;
};

type GithubWorkflowRun = { id?: number; status?: string; conclusion?: string | null; html_url?: string };
type GithubArtifact = { name?: string; archive_download_url?: string };

function getConfig(): Config {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const workflow = process.env.SHOPLING_PRICE_MODIFY_WORKFLOW?.trim();
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN?.trim() || process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo) throw new Error("SHOPLING_PRICE_MODIFY_REPO 환경변수가 필요합니다.");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("SHOPLING_PRICE_MODIFY_REPO는 owner/repo 형식이어야 합니다.");
  if (!workflow) throw new Error("SHOPLING_PRICE_MODIFY_WORKFLOW 환경변수가 필요합니다.");
  if (!ref) throw new Error("SHOPLING_PRICE_MODIFY_REF 환경변수가 필요합니다.");
  if (!token) throw new Error("SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN 또는 GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.");
  return { repo, workflow, ref, token };
}

export function parseShoplingPriceModifyGoodsKeys(input: string) {
  const tokens = input.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error("goods_key를 입력하세요.");
  const seen = new Set<string>();
  const goodsKeys: string[] = [];
  for (const token of tokens) {
    if (!GOODS_KEY_PATTERN.test(token)) throw new Error("goods_key는 숫자만 입력할 수 있습니다.");
    if (!seen.has(token)) {
      seen.add(token);
      goodsKeys.push(token);
    }
  }
  if (goodsKeys.length > SHOPLING_PRICE_MODIFY_MAX_GOODS_KEY_COUNT) throw new Error(`goods_key는 최대 ${SHOPLING_PRICE_MODIFY_MAX_GOODS_KEY_COUNT}개까지 입력할 수 있습니다.`);
  const estimatedTargetCount = goodsKeys.length * SHOPLING_PRICE_MODIFY_MALL_COUNT;
  if (estimatedTargetCount > SHOPLING_PRICE_MODIFY_MAX_TARGET_COUNT) throw new Error(`예상 수정 대상이 ${estimatedTargetCount}건입니다. 최대 ${SHOPLING_PRICE_MODIFY_MAX_TARGET_COUNT}건까지만 실행할 수 있습니다.`);
  return { goodsKeys, goodsKeysCsv: goodsKeys.join(","), goodsKeyCount: goodsKeys.length, estimatedTargetCount };
}


export function validateShoplingPriceModifyPolicyOverrides(input: unknown): ShoplingPriceModifyPolicyOverride[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("커스텀 가격정책은 배열 형식이어야 합니다.");
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`커스텀 가격정책 ${index + 1}번째 항목이 올바르지 않습니다.`);
    const record = item as Record<string, unknown>;
    const allowedKeys = ["mall_key", "multiplier", "add", "subtract", "round_up_unit"];
    if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw new Error("커스텀 가격정책에 허용되지 않은 필드가 있습니다.");
    const mallKey = record.mall_key;
    if (typeof mallKey !== "string" || !ALLOWED_MALL_KEYS.has(mallKey)) throw new Error("커스텀 가격정책의 쇼핑몰 선택값이 올바르지 않습니다.");
    if (seen.has(mallKey)) throw new Error("같은 쇼핑몰을 중복 선택할 수 없습니다.");
    seen.add(mallKey);
    const multiplier = record.multiplier;
    const add = record.add;
    const subtract = record.subtract;
    const roundUpUnit = record.round_up_unit;
    if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) throw new Error("곱하기 값은 0보다 크고 10 이하인 숫자여야 합니다.");
    if (typeof add !== "number" || !Number.isInteger(add) || add < 0 || add > 10000000) throw new Error("더하기 값은 0부터 10000000까지의 정수여야 합니다.");
    if (typeof subtract !== "number" || !Number.isInteger(subtract) || subtract < 0 || subtract > 10000000) throw new Error("빼기 값은 0부터 10000000까지의 정수여야 합니다.");
    if (typeof roundUpUnit !== "number" || !ROUND_UP_UNITS.has(roundUpUnit)) throw new Error("올림단위는 0, 1, 10, 100, 1000 중 하나여야 합니다.");
    return { mall_key: mallKey, multiplier, add, subtract, round_up_unit: roundUpUnit };
  });
}

export function generateShoplingPriceModifyRequestId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `price-modify-${timestamp}-${randomBytes(3).toString("hex")}`;
}
export function isValidShoplingPriceModifyRequestId(requestId: string) { return SHOPLING_PRICE_MODIFY_REQUEST_ID_PATTERN.test(requestId); }
function headers(token: string) { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }; }
async function readJson(response: Response) { const text = await response.text(); if (!response.ok) throw new Error(`GitHub API 요청에 실패했습니다. status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`); return text ? JSON.parse(text) : {}; }

export function buildShoplingPriceModifyActionsRunsUrl(perPage = 10) {
  const config = getConfig(); const [owner, repoName] = config.repo.split("/");
  const params = new URLSearchParams({ branch: config.ref, event: "workflow_dispatch", per_page: String(perPage) });
  return { url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params.toString()}`, token: config.token };
}

export function validateGoodsKeyGroupJson(input?: unknown) {
  if (input === undefined || input === null || input === "") return "";
  if (typeof input !== "string") throw new Error("goods_key_group_json은 JSON 문자열이어야 합니다.");
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("goods_key_group_json은 객체 JSON이어야 합니다.");
  const allowedGroups = new Set(["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]);
  const normalized: Record<string, string> = {};
  for (const [goodsKey, group] of Object.entries(parsed as Record<string, unknown>)) {
    if (!GOODS_KEY_PATTERN.test(goodsKey)) throw new Error("goods_key_group_json의 키는 숫자 goods_key여야 합니다.");
    if (typeof group !== "string" || !allowedGroups.has(group)) throw new Error("goods_key_group_json의 상품그룹 값이 올바르지 않습니다.");
    normalized[goodsKey] = group;
  }
  return JSON.stringify(normalized);
}

export function buildShoplingPriceModifyDispatchRequest(goodsKeyInput: string, policyOverridesInput?: unknown, goodsKeyGroupJsonInput?: unknown, basePriceInput?: { base_consumer_price?: unknown; base_sell_price?: unknown; base_purchase_price?: unknown; base_prices_json?: unknown }) {
  const parsed = parseShoplingPriceModifyGoodsKeys(goodsKeyInput);
  const policyOverrides = validateShoplingPriceModifyPolicyOverrides(policyOverridesInput);
  const policyOverridesJson = policyOverrides.length > 0 ? JSON.stringify(policyOverrides) : "";
  const goodsKeyGroupJson = validateGoodsKeyGroupJson(goodsKeyGroupJsonInput);
  const baseConsumerPrice = typeof basePriceInput?.base_consumer_price === "string" || typeof basePriceInput?.base_consumer_price === "number" ? String(basePriceInput.base_consumer_price).trim() : "";
  const baseSellPrice = typeof basePriceInput?.base_sell_price === "string" || typeof basePriceInput?.base_sell_price === "number" ? String(basePriceInput.base_sell_price).trim() : "";
  const basePurchasePrice = typeof basePriceInput?.base_purchase_price === "string" || typeof basePriceInput?.base_purchase_price === "number" ? String(basePriceInput.base_purchase_price).trim() : "";
  const basePricesJson = typeof basePriceInput?.base_prices_json === "string" ? basePriceInput.base_prices_json.trim() : "";
  const config = getConfig(); const [owner, repoName] = config.repo.split("/");
  const requestId = generateShoplingPriceModifyRequestId();
  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    githubActionsUrl: `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`,
    token: config.token,
    requestId,
    body: { ref: config.ref, inputs: { goods_keys: parsed.goodsKeysCsv, request_id: requestId, batch: SHOPLING_PRICE_MODIFY_BATCH, policy_overrides_json: policyOverridesJson, goods_key_group_json: goodsKeyGroupJson, base_consumer_price: baseConsumerPrice, base_sell_price: baseSellPrice, base_purchase_price: basePurchasePrice, base_prices_json: basePricesJson } },
    commandPreview: `GitHub Actions: ${config.workflow} goods_keys=${parsed.goodsKeysCsv} batch=${SHOPLING_PRICE_MODIFY_BATCH} policy_override_count=${policyOverrides.length} goods_key_group_count=${goodsKeyGroupJson ? Object.keys(JSON.parse(goodsKeyGroupJson)).length : 0} base_price_inputs=${[baseConsumerPrice, baseSellPrice, basePurchasePrice].filter(Boolean).length} base_prices_json=${basePricesJson ? "provided" : "empty"} request_id=${requestId}`,
  };
}

export async function dispatchShoplingPriceModifyActions(goodsKeyInput: string, policyOverridesInput?: unknown, goodsKeyGroupJsonInput?: unknown, basePriceInput?: { base_consumer_price?: unknown; base_sell_price?: unknown; base_purchase_price?: unknown; base_prices_json?: unknown }) {
  if (process.env.SHOPLING_PRICE_MODIFY_ENABLED !== "1") return { status: "error", message: "SHOPLING_PRICE_MODIFY_ENABLED=1 인 경우에만 실행할 수 있습니다." };
  let request; try { request = buildShoplingPriceModifyDispatchRequest(goodsKeyInput, policyOverridesInput, goodsKeyGroupJsonInput, basePriceInput); } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다." }; }
  const response = await fetch(request.url, { method: "POST", headers: { ...headers(request.token), "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
  if (response.status !== 204 && response.status !== 200) return { status: "error", message: `GitHub Actions 워크플로 실행 요청에 실패했습니다. status=${response.status}`, commandPreview: request.commandPreview, githubActionsUrl: request.githubActionsUrl, requestId: request.requestId };
  return { status: "queued", requestId: request.requestId, message: "GitHub Actions 가격설정 워크플로 실행 요청이 전송되었습니다.", githubActionsUrl: request.githubActionsUrl, commandPreview: request.commandPreview };
}

function findSummaryPath(files: Record<string, Uint8Array>) { return files["result_summary.json"] ? "result_summary.json" : files["output/github_actions/result_summary.json"] ? "output/github_actions/result_summary.json" : Object.keys(files).filter((name) => name.endsWith("/result_summary.json")).sort().at(0); }
export function extractShoplingPriceModifyResultSummary(zipBytes: Uint8Array) { const files = unzipSync(zipBytes); const path = findSummaryPath(files); if (!path) throw new Error("GitHub Actions artifact에서 result_summary.json을 찾을 수 없습니다."); return JSON.parse(new TextDecoder().decode(files[path])) as ShoplingPriceModifySummary; }

export async function fetchShoplingPriceModifyActionsResult(requestId?: string): Promise<ShoplingPriceModifyActionsResult> {
  if (requestId && !isValidShoplingPriceModifyRequestId(requestId)) return { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  if (process.env.SHOPLING_PRICE_MODIFY_ENABLED !== "1") return { status: "error", message: "SHOPLING_PRICE_MODIFY_ENABLED=1 인 경우에만 최근 실행 결과를 가져올 수 있습니다.", requestId };
  let runsRequest; try { runsRequest = buildShoplingPriceModifyActionsRunsUrl(requestId ? 20 : 10); } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "GitHub Actions 설정이 올바르지 않습니다.", requestId }; }
  try {
    const runsJson = await readJson(await fetch(runsRequest.url, { headers: headers(runsRequest.token) }));
    const completedRuns = (Array.isArray(runsJson.workflow_runs) ? runsJson.workflow_runs : []).filter((run: GithubWorkflowRun) => run?.status === "completed");
    for (const run of completedRuns) {
      const runId = Number(run.id); if (!Number.isFinite(runId)) continue;
      const artifactsJson = await readJson(await fetch(`https://api.github.com/repos/${process.env.SHOPLING_PRICE_MODIFY_REPO?.trim()}/actions/runs/${runId}/artifacts`, { headers: headers(runsRequest.token) }));
      const artifact = (Array.isArray(artifactsJson.artifacts) ? artifactsJson.artifacts : []).find((item: GithubArtifact) => item?.name === ARTIFACT_NAME);
      if (!artifact?.archive_download_url) continue;
      const zipResponse = await fetch(artifact.archive_download_url, { headers: headers(runsRequest.token) });
      if (!zipResponse.ok) continue;
      const summary = extractShoplingPriceModifyResultSummary(new Uint8Array(await zipResponse.arrayBuffer()));
      const summaryRequestId = typeof summary.request_id === "string" ? summary.request_id : undefined;
      if (requestId && summaryRequestId !== requestId) continue;
      return { status: "success", requestId: summaryRequestId ?? requestId, runId, runUrl: run.html_url, runConclusion: typeof run.conclusion === "string" ? run.conclusion : null, runStatus: "completed", artifactName: artifact.name, summary };
    }
    return { status: "pending", message: "해당 요청 추적 ID의 완료 결과가 아직 없습니다. GitHub Actions 실행이 끝난 뒤 다시 확인하세요.", requestId };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "최근 실행 결과를 가져오는 중 오류가 발생했습니다.", requestId }; }
}
