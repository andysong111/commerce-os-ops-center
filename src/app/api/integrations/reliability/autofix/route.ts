import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import { claimReliabilityAutofixIdempotently } from "@/lib/reliability/reliabilityAutofixClaim";
import { requestReliabilityAutofixProposal } from "@/lib/reliability/reliabilityAutofixOpenAi";
import {
  assertAutofixJobEligible,
  type ReliabilityAutofixContextFile,
  type ReliabilityAutofixJob,
} from "@/lib/reliability/reliabilityAutofixPolicy";
import { verifyReliabilityGithubOidc } from "@/lib/reliability/reliabilityGithubOidc";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeJob(rowValue: unknown): ReliabilityAutofixJob {
  const row = object(rowValue);
  const job: ReliabilityAutofixJob = {
    job_id: text(row.job_id, 100),
    improvement_id: text(row.improvement_id, 100),
    incident_id: text(row.incident_id, 100),
    target_repo: text(row.target_repo, 300),
    engine: text(row.engine, 250),
    error_code: row.error_code == null ? null : text(row.error_code, 200),
    title: text(row.title, 600),
    fact_summary: text(row.fact_summary, 2_000),
    root_cause: text(row.root_cause, 4_000),
    change_summary: text(row.change_summary, 4_000),
    prevention_rule: text(row.prevention_rule, 4_000),
    expected_effect: text(row.expected_effect, 4_000),
    improvement_kind: text(row.improvement_kind, 100),
    safe_action: text(row.safe_action, 100),
    risk_level: text(row.risk_level, 100),
    confidence: number(row.confidence),
    target_test_name:
      row.target_test_name == null ? null : text(row.target_test_name, 500),
    protected_invariant: text(row.protected_invariant, 2_000),
    occurrence_count: Math.max(0, Math.trunc(number(row.occurrence_count))),
  };
  for (const key of ["job_id", "improvement_id", "incident_id", "target_repo", "engine"] as const) {
    if (!job[key]) throw new Error(`자동수정 작업의 ${key} 값이 비어 있습니다.`);
  }
  assertAutofixJobEligible(job);
  return job;
}

async function adminClient() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("OPS Supabase 관리자 연결이 없습니다.");
  return admin;
}

async function loadClaimedJob(
  jobId: string,
  repository: string,
  runId: string,
): Promise<ReliabilityAutofixJob> {
  const admin = await adminClient();
  const jobResult = await admin
    .from("reliability_autofix_jobs")
    .select("id,improvement_id,target_repo,status,claimed_by,github_run_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobResult.error) throw new Error(`자동수정 작업 조회 실패: ${jobResult.error.message}`);
  const jobRow = object(jobResult.data);
  if (!jobRow.id) throw new Error("자동수정 작업을 찾지 못했습니다.");
  if (
    text(jobRow.target_repo, 300) !== repository ||
    text(jobRow.claimed_by, 300) !== repository ||
    text(jobRow.github_run_id, 100) !== runId ||
    text(jobRow.status, 100) !== "claimed"
  ) {
    throw new Error("현재 GitHub Actions 실행이 소유한 자동수정 작업이 아닙니다.");
  }

  const improvementResult = await admin
    .from("reliability_improvements")
    .select(
      "id,incident_id,target_repo,engine,error_code,title,fact_summary,root_cause,change_summary,prevention_rule,expected_effect,improvement_kind,safe_action,risk_level,confidence,target_test_name,regression_case_id,metadata",
    )
    .eq("id", text(jobRow.improvement_id, 100))
    .maybeSingle();
  if (improvementResult.error) {
    throw new Error(`자동수정 개선안 조회 실패: ${improvementResult.error.message}`);
  }
  const improvement = object(improvementResult.data);
  if (!improvement.id) throw new Error("자동수정 개선안을 찾지 못했습니다.");

  let protectedInvariant = "";
  const regressionId = text(improvement.regression_case_id, 100);
  if (regressionId) {
    const regression = await admin
      .from("reliability_regression_cases")
      .select("protected_invariant")
      .eq("id", regressionId)
      .maybeSingle();
    if (!regression.error) {
      protectedInvariant = text(object(regression.data).protected_invariant, 2_000);
    }
  }
  const metadata = object(improvement.metadata);
  return normalizeJob({
    job_id: jobId,
    improvement_id: improvement.id,
    incident_id: improvement.incident_id,
    target_repo: improvement.target_repo,
    engine: improvement.engine,
    error_code: improvement.error_code,
    title: improvement.title,
    fact_summary: improvement.fact_summary,
    root_cause: improvement.root_cause,
    change_summary: improvement.change_summary,
    prevention_rule: improvement.prevention_rule,
    expected_effect: improvement.expected_effect,
    improvement_kind: improvement.improvement_kind,
    safe_action: improvement.safe_action,
    risk_level: improvement.risk_level,
    confidence: improvement.confidence,
    target_test_name: improvement.target_test_name,
    protected_invariant: protectedInvariant,
    occurrence_count: metadata.occurrenceCount,
  });
}

async function findClaimedJobForRun(
  repository: string,
  runId: string,
): Promise<ReliabilityAutofixJob | null> {
  const admin = await adminClient();
  const result = await admin
    .from("reliability_autofix_jobs")
    .select("id")
    .eq("target_repo", repository)
    .eq("claimed_by", repository)
    .eq("github_run_id", runId)
    .eq("status", "claimed")
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new Error(`기존 자동수정 작업 조회 실패: ${result.error.message}`);
  }
  const jobId = text(object(result.data).id, 100);
  return jobId ? loadClaimedJob(jobId, repository, runId) : null;
}

function parseFiles(value: unknown): ReliabilityAutofixContextFile[] {
  if (!Array.isArray(value)) throw new Error("자동수정 코드 문맥이 없습니다.");
  return value.slice(0, 20).map((entry) => {
    const row = object(entry);
    return {
      path: text(row.path, 500),
      content: String(row.content ?? "").slice(0, 30_000),
    };
  });
}

async function ensureJobOwnership(jobId: string, repository: string, runId: string) {
  const admin = await adminClient();
  const result = await admin
    .from("reliability_autofix_jobs")
    .select("id,target_repo,claimed_by,github_run_id,status")
    .eq("id", jobId)
    .maybeSingle();
  if (result.error) throw new Error(`자동수정 작업 확인 실패: ${result.error.message}`);
  const row = object(result.data);
  if (!row.id) throw new Error("자동수정 작업을 찾지 못했습니다.");
  if (
    text(row.target_repo, 300) !== repository ||
    text(row.claimed_by, 300) !== repository ||
    text(row.github_run_id, 100) !== runId
  ) {
    throw new Error("현재 GitHub Actions 실행이 소유한 작업이 아닙니다.");
  }
  return admin;
}

export async function POST(request: Request) {
  try {
    const identity = await verifyReliabilityGithubOidc(request.headers.get("authorization"));
    const body = object(await request.json());
    const action = text(body.action, 80);

    if (action === "claim") {
      const claim = await claimReliabilityAutofixIdempotently<ReliabilityAutofixJob>({
        findExisting: () => findClaimedJobForRun(identity.repository, identity.runId),
        claimFresh: async () => {
          const admin = await adminClient();
          const result = await admin.rpc("claim_reliability_autofix_job", {
            p_repo: identity.repository,
            p_run_id: identity.runId,
          });
          if (result.error) {
            throw new Error(`자동수정 작업 가져오기 실패: ${result.error.message}`);
          }
          const rows = Array.isArray(result.data) ? result.data : [];
          return rows.length ? normalizeJob(rows[0]) : null;
        },
      });
      return Response.json(
        { ok: true, job: claim.job, recovered: claim.recovered },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const jobId = text(body.job_id, 100);
    if (!jobId) throw new Error("job_id가 없습니다.");

    if (action === "generate") {
      const job = await loadClaimedJob(jobId, identity.repository, identity.runId);
      const proposal = await requestReliabilityAutofixProposal(
        job,
        parseFiles(body.files),
        text(body.revision_feedback, 1_000),
      );
      return Response.json(
        { ok: true, job_id: jobId, proposal },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (action === "finish") {
      const admin = await ensureJobOwnership(jobId, identity.repository, identity.runId);
      const status = text(body.status, 80);
      const result = await admin.rpc("finish_reliability_autofix_job", {
        p_job_id: jobId,
        p_status: status,
        p_branch_name: text(body.branch_name, 300) || null,
        p_pr_number: body.pr_number == null ? null : Math.trunc(number(body.pr_number)),
        p_commit_sha: text(body.commit_sha, 100) || null,
        p_merge_sha: text(body.merge_sha, 100) || null,
        p_patch_summary: text(body.patch_summary, 2_000) || null,
        p_changed_paths: Array.isArray(body.changed_paths) ? body.changed_paths : [],
        p_error: body.error == null
          ? null
          : redactReliabilityText(body.error, 2_000),
      });
      if (result.error) throw new Error(`자동수정 상태 저장 실패: ${result.error.message}`);
      return Response.json(
        { ok: true, result: result.data },
        { headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { ok: false, code: "UNSUPPORTED_ACTION" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = redactReliabilityText(
      error instanceof Error ? error.message : String(error ?? "unknown error"),
      1_500,
    );
    const unauthorized = /OIDC|허용되지 않은 GitHub|소유한 작업/.test(message);
    return Response.json(
      { ok: false, code: unauthorized ? "UNAUTHORIZED" : "AUTOFIX_ERROR", message },
      {
        status: unauthorized ? 401 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
