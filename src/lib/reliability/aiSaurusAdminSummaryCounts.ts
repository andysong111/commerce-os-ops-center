import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const AI_SAURUS_SOURCE = "ai-saurus";
const ACTIVE_INCIDENT_STATES = ["open", "monitoring"] as const;
const APPLIED_IMPROVEMENT_STATES = [
  "policy_active",
  "applied",
  "measuring",
  "verified",
] as const;
const ACTIVE_AUTOFIX_STATES = [
  "queued",
  "claimed",
  "patch_ready",
  "validating",
  "pr_open",
] as const;

type CountResult = {
  error: { message: string } | null;
  count: number | null;
};

function requireExactCount(result: CountResult, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.count === null || !Number.isFinite(result.count)) {
    throw new Error(`${label}: exact count unavailable`);
  }
  return result.count;
}

/**
 * Exact counters for the AI-Saurus reliability admin bridge.
 *
 * The detail loader intentionally caps row payloads for a bounded admin response.
 * These HEAD + count=exact queries keep KPI totals independent from those display
 * limits, so queued recoveries and future high-volume incident histories are not
 * silently undercounted.
 */
export async function loadAiSaurusReliabilityExactSummaryCounts() {
  const client = await createSupabaseAdminClient();
  if (!client) throw new Error("Supabase admin client is unavailable");

  const [
    activeIncidentsResult,
    repeatedIncidentsResult,
    learningCasesResult,
    appliedImprovementsResult,
    approvalRequiredResult,
    verifiedImprovementsResult,
    regressedImprovementsResult,
    autofixActiveResult,
    autofixQuarantinedResult,
    recoveryQueuedResult,
    recoveryApprovalRequiredResult,
  ] = await Promise.all([
    client
      .from("reliability_incidents")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .in("status", ACTIVE_INCIDENT_STATES),
    client
      .from("reliability_incidents")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .in("status", ACTIVE_INCIDENT_STATES)
      .gt("occurrence_count", 1),
    client
      .from("reliability_learning_cases")
      .select("id,reliability_incidents!inner(source_system)", {
        count: "exact",
        head: true,
      })
      .eq("reliability_incidents.source_system", AI_SAURUS_SOURCE),
    client
      .from("reliability_improvements")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .in("status", APPLIED_IMPROVEMENT_STATES),
    client
      .from("reliability_improvements")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .eq("requires_approval", true),
    client
      .from("reliability_improvements")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .eq("status", "verified"),
    client
      .from("reliability_improvements")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .eq("status", "regressed"),
    client
      .from("reliability_autofix_jobs")
      .select("id,reliability_improvements!inner(source_system)", {
        count: "exact",
        head: true,
      })
      .eq("reliability_improvements.source_system", AI_SAURUS_SOURCE)
      .in("status", ACTIVE_AUTOFIX_STATES),
    client
      .from("reliability_autofix_jobs")
      .select("id,reliability_improvements!inner(source_system)", {
        count: "exact",
        head: true,
      })
      .eq("reliability_improvements.source_system", AI_SAURUS_SOURCE)
      .eq("status", "quarantined"),
    client
      .from("reliability_recovery_queue")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .eq("status", "queued"),
    client
      .from("reliability_recovery_queue")
      .select("id", { count: "exact", head: true })
      .eq("source_system", AI_SAURUS_SOURCE)
      .eq("status", "approval_required"),
  ]);

  return {
    activeIncidents: requireExactCount(activeIncidentsResult, "active incidents"),
    repeatedIncidents: requireExactCount(repeatedIncidentsResult, "repeated incidents"),
    learningCases: requireExactCount(learningCasesResult, "learning cases"),
    appliedImprovements: requireExactCount(
      appliedImprovementsResult,
      "applied improvements",
    ),
    approvalRequired: requireExactCount(approvalRequiredResult, "approval required"),
    verifiedImprovements: requireExactCount(
      verifiedImprovementsResult,
      "verified improvements",
    ),
    regressedImprovements: requireExactCount(
      regressedImprovementsResult,
      "regressed improvements",
    ),
    autofixActive: requireExactCount(autofixActiveResult, "active autofix jobs"),
    autofixQuarantined: requireExactCount(
      autofixQuarantinedResult,
      "quarantined autofix jobs",
    ),
    recoveryQueued: requireExactCount(recoveryQueuedResult, "queued recoveries"),
    recoveryApprovalRequired: requireExactCount(
      recoveryApprovalRequiredResult,
      "recovery approvals",
    ),
  };
}
