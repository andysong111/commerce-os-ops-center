import { after, NextRequest } from "next/server";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  listSeoRunJobs,
  patchOwnedSeoRunJobs,
  readSeoRunJobById,
  type SeoRunJobRow,
} from "@/lib/seoRunJobServer";
import { runCoalescedSeoRunWorkerPulse } from "@/lib/seoRunWorkerPulse";
import {
  mergeSeoProhibitedKeywordLists,
  mergeSeoProhibitedKeywordPolicy,
  readCombinedSeoProhibitedKeywordTerms,
} from "@/lib/seoProhibitedKeywordPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const CUSTOM_BLOCKED_LIMIT = 200;
const MAX_TARGETS = 250;
const READ_CONCURRENCY = 8;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringList(value: unknown, limit = CUSTOM_BLOCKED_LIMIT) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = text(entry).normalize("NFKC").replace(/\s+/g, " ").slice(0, 60);
    const key = normalized.toLocaleLowerCase("ko-KR");
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>,
) {
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), values.length) }, () => runner()),
  );
}

function canRewindToStep4(job: SeoRunJobRow) {
  if (job.stage_index < 5) return false;
  const checkpoint = record(job.checkpoint_payload);
  return (
    Array.isArray(checkpoint.candidates) &&
    Object.keys(record(checkpoint.source)).length > 0 &&
    Object.keys(record(checkpoint.identity)).length > 0
  );
}

function scheduleWorker(userId: string, maxJobs: number) {
  after(async () => {
    await runCoalescedSeoRunWorkerPulse({
      workerId: `blocked-terms:${userId.slice(0, 8)}:${crypto.randomUUID()}`,
      maxJobs: Math.max(1, Math.min(2, maxJobs)),
      timeBudgetMs: 240_000,
      leaseSeconds: 300,
    }).catch((error) => {
      console.error("[seo-run-custom-blocked-terms] background worker failed", error);
    });
  });
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  try {
    const customBlockedTerms = await readCombinedSeoProhibitedKeywordTerms(
      authenticated.value.identity.userId,
    );
    return Response.json({
      ok: true,
      customBlockedTerms,
      termCount: customBlockedTerms.length,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_PROHIBITED_KEYWORD_POLICY_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "금지키워드 정책을 읽지 못했습니다.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const body = record(await request.json().catch(() => ({})));
  const requestedTerms = stringList(body.customBlockedTerms);
  const policy = await mergeSeoProhibitedKeywordPolicy({
    ownerId: context.identity.userId,
    terms: requestedTerms,
    source: "commerce-os-manual-keyword-panel",
    sourceReference: `manual:${new Date().toISOString().slice(0, 10)}`,
  });
  const customBlockedTerms = mergeSeoProhibitedKeywordLists(
    await readCombinedSeoProhibitedKeywordTerms(context.identity.userId),
    policy.terms,
  );

  const current = await listSeoRunJobs(context, {
    includeArchived: false,
    limit: 600,
  });

  const skippedRegistration = current.filter((job) =>
    ["submitting", "queued", "running", "success"].includes(job.registration_status),
  );
  const skippedRunning = current.filter(
    (job) =>
      job.status === "running" &&
      !["submitting", "queued", "running", "success"].includes(job.registration_status),
  );
  const targets = current
    .filter(
      (job) =>
        !["submitting", "queued", "running", "success"].includes(job.registration_status) &&
        job.status !== "running" &&
        job.status !== "cancelled",
    )
    .slice(0, MAX_TARGETS);

  let updatedOnlyCount = 0;
  let requeuedCount = 0;
  let skippedOwnershipCount = 0;
  let skippedCheckpointCount = 0;
  const now = new Date().toISOString();

  await mapLimit(targets, READ_CONCURRENCY, async (summary) => {
    const full = await readSeoRunJobById(context.config, summary.run_id);
    if (!full || full.owner_id !== context.identity.userId) {
      skippedOwnershipCount += 1;
      return;
    }

    const inputPayload = {
      ...record(full.input_payload),
      customBlockedTerms,
    };
    const rewind = canRewindToStep4(full);
    const patch: UnknownRecord = { input_payload: inputPayload };

    if (rewind) {
      Object.assign(patch, {
        status: "queued",
        stage: "filter_keywords",
        stage_index: 5,
        progress_percent: 70,
        message: "직접 금지키워드 적용 · STEP 4부터 서버 재검증 대기",
        result_payload: {},
        error_message: "",
        attempt_count: 0,
        not_before: now,
        lease_owner: null,
        lease_until: null,
        completed_at: null,
      });
    } else if (full.stage_index >= 5) {
      skippedCheckpointCount += 1;
    }

    const saved = await patchOwnedSeoRunJobs(context, [full.run_id], patch);
    if (!saved.length) return;
    if (rewind) requeuedCount += 1;
    else updatedOnlyCount += 1;
  });

  if (requeuedCount > 0) scheduleWorker(context.identity.userId, requeuedCount);

  return Response.json({
    ok: true,
    customBlockedTerms,
    addedTerms: policy.addedTerms,
    termCount: customBlockedTerms.length,
    targetCount: targets.length,
    updatedOnlyCount,
    requeuedCount,
    skippedRunningCount: skippedRunning.length,
    skippedRegistrationCount: skippedRegistration.length,
    skippedOwnershipCount,
    skippedCheckpointCount,
    message: `직접 금지키워드 ${customBlockedTerms.length}개를 저장 가능한 미등록 RUN에 적용했습니다.`,
  });
}
