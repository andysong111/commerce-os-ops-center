import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  collectKeywordElonBulkSource,
  composeKeywordElonBulkFinal,
  type KeywordElonBulkComposeInput,
  type KeywordElonBulkFinalInput,
} from "@/lib/keywordEngineElonBulkFinal";
import { generateSafeBulkKeywordSupplements } from "@/lib/keywordEngineElonBulkKeywordRecovery";
import { discoverKeywordElonCandidatesResilient } from "@/lib/keywordEngineElonLabV2Discovery";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import { scoreKeywordElonCandidatesBatched } from "@/lib/keywordEngineElonLabV2Scoring";
import {
  analyzeKeywordElonIdentity,
  generateKeywordElonTitle,
} from "@/lib/keywordEngineElonLabV2Server";
import { expandKeywordElonFromPassing } from "@/lib/keywordEngineElonLabV2Step3";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";
import {
  normalizeKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
} from "@/lib/keywordEngineElonLabV2Selection";
import {
  claimNextLegacySeoRunJob,
  patchClaimedLegacySeoRunJob,
} from "@/lib/legacySeoRunJobServer";
import {
  getProductLaunchAdminConfig,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import type { SeoRunJobRow } from "@/lib/seoRunJobServer";

const LEASE_SECONDS = 420;
const EXPANSION_ROUNDS = 3;
const DEFAULT_TIME_BUDGET_MS = 240_000;
const MAX_JOBS_PER_TICK = 2;

type UnknownRecord = Record<string, unknown>;
type Step4FilterResult = {
  allowedCount: number;
  removedCount: number;
  allowedKeys: string[];
  removedKeys: string[];
  decisions: unknown[];
  warnings?: string[];
};

type LegacySeoRunProcessResult = {
  runId: string;
  status: SeoRunJobRow["status"];
  stage: SeoRunJobRow["stage"];
  error?: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringList(value: unknown, limit = 2000) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = text(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 체크포인트가 없습니다.`);
  }
  return value as T;
}

function requireCandidates(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} 후보 체크포인트가 없습니다.`);
  return value as KeywordElonCandidate[];
}

function inputFromJob(job: SeoRunJobRow) {
  const input = record(job.input_payload);
  const result: KeywordElonBulkFinalInput = {
    launchItemId: text(input.launchItemId) || job.launch_item_id,
    modelNumber: text(input.modelNumber) || job.model_number,
    productName: text(input.productName) || job.product_name,
    sourceUrl: text(input.sourceUrl) || job.source_url,
    optionText: text(input.optionText),
    supportingText: text(input.supportingText),
    mallTitleCategory: text(input.mallTitleCategory),
    customBlockedTerms: stringList(input.customBlockedTerms, 200),
    variationSeed: text(input.variationSeed) || job.run_id,
    excludedMallTitles: stringList(input.excludedMallTitles, 1200),
  };
  if (!result.launchItemId || !result.sourceUrl) {
    throw new Error("이전상품 SEO RUN 입력에 상품 ID 또는 원본 식별자가 없습니다.");
  }
  return result;
}

function mergeLegacyEvidenceIntoSource(
  source: KeywordElonSourceDraft,
  input: KeywordElonBulkFinalInput,
  mode: "1688_server" | "tracker_fallback",
): KeywordElonSourceDraft {
  const sourceOption = text(source.optionText);
  const legacyOption = text(input.optionText);
  const sourceSupporting = text(source.supportingText);
  const legacySupporting = text(input.supportingText);
  const optionText = [sourceOption, legacyOption]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n");
  const supportingText = [sourceSupporting, legacySupporting]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(" · ")
    .slice(0, 14_000);
  const warnings = [
    ...(source.warnings ?? []),
    "LEGACY_SHOPLING_EVIDENCE_MERGED",
    mode === "1688_server"
      ? "LEGACY_SOURCE:1688_PLUS_SHOPLING"
      : "LEGACY_SOURCE:SHOPLING_FALLBACK",
  ].filter((value, index, all) => value && all.indexOf(value) === index);
  return {
    ...source,
    optionText,
    supportingText,
    warnings,
  };
}

function seedRows(candidates: KeywordElonCandidate[]) {
  return uniqueKeywordElonCanonical(
    candidates
      .filter(
        (row) =>
          row.safetyPass && row.qualityScore >= KEYWORD_ELON_V2_DEFAULT_CUTOFF,
      )
      .sort(
        (a, b) =>
          b.qualityScore - a.qualityScore ||
          (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
      )
      .map((row) => row.searchKeyword || row.searchKey || row.keyword),
    8,
  );
}

function blockedKeysFromFilter(result: Step4FilterResult) {
  return (Array.isArray(result.decisions) ? result.decisions : [])
    .map(record)
    .filter((row) => row.blocked === true)
    .map((row) => text(row.searchKey) || text(row.keyword))
    .filter(Boolean);
}

function nextLease() {
  return new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();
}

function retryableError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    "timeout",
    "timed out",
    "aborted",
    "fetch failed",
    "network",
    "econnreset",
    "econnrefused",
    "429",
    "502",
    "503",
    "504",
    "temporar",
    "rate limit",
    "schema cache",
    "pgrst002",
  ].some((token) => message.includes(token));
}

function retryDelayMs(attemptCount: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

function minimumStageStartBudgetMs(stage: SeoRunJobRow["stage"]) {
  return {
    collect_source: 50_000,
    analyze_identity: 70_000,
    discover_keywords: 130_000,
    score_keywords: 190_000,
    expand_keywords: 190_000,
    filter_keywords: 100_000,
    generate_title: 75_000,
    compose_final: 100_000,
    completed: 0,
  }[stage];
}

async function composeFinalWithRecovery(input: KeywordElonBulkComposeInput) {
  try {
    return composeKeywordElonBulkFinal(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/FINAL 검색어가 10개가 아닙니다/.test(message)) throw error;
    const supplementalSearchKeywords = await generateSafeBulkKeywordSupplements({
      identity: input.identity,
      source: input.source,
      productName: input.productName,
      customBlockedTerms: input.customBlockedTerms ?? [],
    });
    if (!supplementalSearchKeywords.length) throw error;
    return composeKeywordElonBulkFinal({ ...input, supplementalSearchKeywords });
  }
}

async function checkpoint(
  config: ProductLaunchAdminConfig,
  job: SeoRunJobRow,
  workerId: string,
  patch: UnknownRecord,
) {
  return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
    ...patch,
    error_message: "",
    lease_until: nextLease(),
  });
}

async function executeStage(
  config: ProductLaunchAdminConfig,
  job: SeoRunJobRow,
  workerId: string,
): Promise<SeoRunJobRow> {
  const input = inputFromJob(job);
  const state = record(job.checkpoint_payload);

  if (job.stage === "collect_source") {
    const collected = await collectKeywordElonBulkSource(input);
    const mergedSource = mergeLegacyEvidenceIntoSource(
      collected.source,
      input,
      collected.mode,
    );
    return checkpoint(config, job, workerId, {
      stage: "analyze_identity",
      stage_index: 1,
      progress_percent: 10,
      message:
        collected.mode === "1688_server"
          ? "1688 + Shopling 원본 병합 완료 · 상품 정체성 분석 대기"
          : "Shopling 대체 원본 구성 완료 · 상품 정체성 분석 대기",
      checkpoint_payload: {
        ...state,
        source: mergedSource,
        collectionMode: collected.mode,
        legacySourceMode:
          collected.mode === "1688_server"
            ? "1688_plus_shopling"
            : "shopling_fallback",
      },
    });
  }

  const source = requireObject<KeywordElonSourceDraft>(state.source, "원본 수집");
  const collectionMode =
    text(state.collectionMode) === "1688_server"
      ? "1688_server"
      : "tracker_fallback";

  if (job.stage === "analyze_identity") {
    const identity = await analyzeKeywordElonIdentity(source);
    return checkpoint(config, job, workerId, {
      stage: "discover_keywords",
      stage_index: 2,
      progress_percent: 22,
      message: "STEP 1 정체성 분석 완료 · 시장어 발굴 대기",
      checkpoint_payload: { ...state, identity },
    });
  }

  const identity = requireObject<KeywordElonIdentity>(state.identity, "STEP 1 정체성");

  if (job.stage === "discover_keywords") {
    const discovery = await discoverKeywordElonCandidatesResilient(source, identity);
    return checkpoint(config, job, workerId, {
      stage: "score_keywords",
      stage_index: 3,
      progress_percent: 35,
      message: `STEP 2 시장어 ${discovery.candidates.length}개 발굴 완료 · 점수화 대기`,
      checkpoint_payload: { ...state, discovery },
    });
  }

  const discovery = requireObject<KeywordElonDiscovery>(state.discovery, "STEP 2 시장어");

  if (job.stage === "score_keywords") {
    const scored = await scoreKeywordElonCandidatesBatched({
      source,
      identity,
      discovery,
      shoplingCategory: text(input.mallTitleCategory),
    });
    return checkpoint(config, job, workerId, {
      stage: "expand_keywords",
      stage_index: 4,
      progress_percent: 48,
      message: `STEP 2 후보 ${scored.candidates.length}개 점수화 완료 · 확장 round 1 대기`,
      checkpoint_payload: {
        ...state,
        candidates: scored.candidates,
        expansionRound: 1,
      },
    });
  }

  let candidates = requireCandidates(state.candidates, "STEP 2 점수화");

  if (job.stage === "expand_keywords") {
    const round = Math.max(1, Math.floor(Number(state.expansionRound) || 1));
    if (round > EXPANSION_ROUNDS) {
      return checkpoint(config, job, workerId, {
        stage: "filter_keywords",
        stage_index: 5,
        progress_percent: 70,
        message: "STEP 3 확장 완료 · 금지키워드 검사 대기",
      });
    }
    const seeds = seedRows(candidates);
    if (!seeds.length) {
      return checkpoint(config, job, workerId, {
        stage: "filter_keywords",
        stage_index: 5,
        progress_percent: 70,
        message: "STEP 3 확장 seed 없음 · 금지키워드 검사 대기",
        checkpoint_payload: { ...state, expansionRound: EXPANSION_ROUNDS + 1 },
      });
    }
    const expanded = await expandKeywordElonFromPassing({
      identity,
      seedKeywords: seeds,
      existingDiscovery: discovery,
      existingCandidates: candidates,
      round,
    });
    let nextDiscovery = discovery;
    if (expanded.newCandidateCount && expanded.discovery.candidates.length) {
      const scored = await scoreKeywordElonCandidatesBatched({
        source,
        identity,
        discovery: expanded.discovery,
        shoplingCategory: text(input.mallTitleCategory),
      });
      candidates = mergeKeywordElonCandidates(candidates, scored.candidates);
      nextDiscovery = mergeKeywordElonDiscovery(discovery, expanded.discovery);
    }
    const nextRound = round + 1;
    return checkpoint(config, job, workerId, {
      stage: nextRound > EXPANSION_ROUNDS ? "filter_keywords" : "expand_keywords",
      stage_index: nextRound > EXPANSION_ROUNDS ? 5 : 4,
      progress_percent: Math.min(70, 48 + round * 7),
      message:
        nextRound > EXPANSION_ROUNDS
          ? `STEP 3 round ${round} 완료 · 금지키워드 검사 대기`
          : `STEP 3 round ${round} 완료 · round ${nextRound} 대기`,
      checkpoint_payload: {
        ...state,
        discovery: nextDiscovery,
        candidates,
        expansionRound: nextRound,
      },
    });
  }

  if (job.stage === "filter_keywords") {
    const finalCandidates = selectKeywordElonStep4Union(
      candidates,
      normalizeKeywordElonSelectionThresholds(),
    );
    if (!finalCandidates.length) {
      throw new Error("STEP 4에 전달할 월검색량/정확성 통과 후보가 없습니다.");
    }
    const filterResult = await filterKeywordElonProhibitedKeywords({
      identity,
      candidates: finalCandidates,
      customBlockedTerms: input.customBlockedTerms ?? [],
    });
    const allowedSet = new Set(stringList(filterResult.allowedKeys));
    const allowedCandidates = finalCandidates.filter((candidate) =>
      allowedSet.has(
        compactKeywordElonKey(
          candidate.searchKeyword || candidate.searchKey || candidate.keyword,
        ),
      ),
    );
    if (!allowedCandidates.length) {
      throw new Error("금지키워드 제거 후 사용할 SEO 재료가 없습니다.");
    }
    return checkpoint(config, job, workerId, {
      stage: "generate_title",
      stage_index: 6,
      progress_percent: 78,
      message: `STEP 4 완료 · 안전 후보 ${allowedCandidates.length}개 · FINAL 상품명 생성 대기`,
      checkpoint_payload: {
        ...state,
        finalCandidates,
        filterResult,
        allowedCandidates,
      },
    });
  }

  const filterResult = requireObject<Step4FilterResult>(state.filterResult, "STEP 4 필터");
  const allowedCandidates = requireCandidates(state.allowedCandidates, "STEP 4 허용 후보");

  if (job.stage === "generate_title") {
    const titleResult = await generateKeywordElonTitle({
      source,
      identity,
      candidates: allowedCandidates,
      cutoff: 0,
    });
    return checkpoint(config, job, workerId, {
      stage: "compose_final",
      stage_index: 7,
      progress_percent: 88,
      message: "FINAL 기본 상품명 생성 완료 · 검색어 10개/쇼핑몰 29개 조립 대기",
      checkpoint_payload: { ...state, titleResult },
    });
  }

  if (job.stage === "compose_final") {
    const titleResult = requireObject<KeywordElonTitleResult>(state.titleResult, "FINAL 상품명");
    const result = await composeFinalWithRecovery({
      ...input,
      source,
      collectionMode,
      identity,
      candidates,
      allowedKeys: stringList(filterResult.allowedKeys),
      blockedKeys: blockedKeysFromFilter(filterResult),
      finalMaterialCount:
        Math.max(0, Math.floor(Number(filterResult.allowedCount) || 0)) ||
        allowedCandidates.length,
      titleResult,
    });
    return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
      status: "ready",
      stage: "completed",
      stage_index: 8,
      progress_percent: 100,
      message: "이전상품 FINAL 완료 · 전용 원장에 결과 보존",
      result_payload: result,
      error_message: "",
      lease_owner: null,
      lease_until: null,
      completed_at: new Date().toISOString(),
    });
  }

  return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
    status: "ready",
    stage: "completed",
    progress_percent: 100,
    message: "이전상품 FINAL 완료",
    error_message: "",
    lease_owner: null,
    lease_until: null,
    completed_at: job.completed_at ?? new Date().toISOString(),
  });
}

async function requeueAtBudgetBoundary(
  config: ProductLaunchAdminConfig,
  job: SeoRunJobRow,
  workerId: string,
) {
  return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
    status: "queued",
    message: `${job.message || job.stage} · 체크포인트 저장 완료, 다음 서버 실행에서 이어갑니다.`,
    error_message: "",
    not_before: new Date().toISOString(),
    lease_owner: null,
    lease_until: null,
  });
}

async function failOrRetry(
  config: ProductLaunchAdminConfig,
  job: SeoRunJobRow,
  workerId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const canRetry =
    retryableError(error) && job.attempt_count < Math.max(1, job.max_attempts);
  if (canRetry) {
    return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
      status: "queued",
      message: `일시 오류 · ${job.stage} 체크포인트에서 자동 재시도 대기`,
      error_message: message.slice(0, 2000),
      not_before: new Date(Date.now() + retryDelayMs(job.attempt_count)).toISOString(),
      lease_owner: null,
      lease_until: null,
    });
  }
  return patchClaimedLegacySeoRunJob(config, job.run_id, workerId, {
    status: "failed",
    message: `이전상품 서버 실행 중단 · ${job.stage} 체크포인트 보존`,
    error_message: message.slice(0, 2000),
    lease_owner: null,
    lease_until: null,
    completed_at: new Date().toISOString(),
  });
}

async function processClaimedJob(
  config: ProductLaunchAdminConfig,
  initialJob: SeoRunJobRow,
  workerId: string,
  deadline: number,
): Promise<LegacySeoRunProcessResult> {
  let job = initialJob;
  try {
    while (
      job.status === "running" &&
      job.stage !== "completed" &&
      Date.now() + minimumStageStartBudgetMs(job.stage) < deadline
    ) {
      job = await executeStage(config, job, workerId);
    }
    if (job.status === "running" && job.stage !== "completed") {
      job = await requeueAtBudgetBoundary(config, job, workerId);
    }
    return { runId: job.run_id, status: job.status, stage: job.stage };
  } catch (error) {
    try {
      const failed = await failOrRetry(config, job, workerId, error);
      return {
        runId: failed.run_id,
        status: failed.status,
        stage: failed.stage,
        error: failed.error_message,
      };
    } catch (persistError) {
      return {
        runId: job.run_id,
        status: "running",
        stage: job.stage,
        error:
          persistError instanceof Error ? persistError.message : String(persistError),
      };
    }
  }
}

export async function processLegacySeoRunQueue(options: {
  workerId?: string;
  maxJobs?: number;
  timeBudgetMs?: number;
} = {}) {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) throw new Error(configResult.body.message);
  const config = configResult.value;
  const workerId =
    text(options.workerId) ||
    `legacy-seo-run:${process.env.VERCEL_REGION || "local"}:${crypto.randomUUID()}`;
  const maxJobs = Math.max(1, Math.min(6, Math.trunc(options.maxJobs ?? MAX_JOBS_PER_TICK)));
  const timeBudgetMs = Math.max(
    20_000,
    Math.min(280_000, Math.trunc(options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)),
  );
  const deadline = Date.now() + timeBudgetMs;
  const claimed: SeoRunJobRow[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextLegacySeoRunJob(
      config,
      `${workerId}:${index + 1}`,
      LEASE_SECONDS,
    );
    if (!job) break;
    claimed.push(job);
  }
  const settled = await Promise.allSettled(
    claimed.map((job, index) =>
      processClaimedJob(config, job, `${workerId}:${index + 1}`, deadline),
    ),
  );
  const results: LegacySeoRunProcessResult[] = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const job = claimed[index];
    return {
      runId: job.run_id,
      status: "running",
      stage: job.stage,
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    };
  });
  return {
    workerId,
    claimedCount: claimed.length,
    completedCount: results.filter((row) => row.status === "ready").length,
    failedCount: results.filter((row) => row.status === "failed").length,
    queuedCount: results.filter((row) => row.status === "queued").length,
    results,
  };
}
