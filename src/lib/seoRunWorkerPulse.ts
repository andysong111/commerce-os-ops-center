import type { ProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import { processSeoRunQueue } from "@/lib/seoRunWorker";
import {
  claimSeoRunWorkerPulse,
  finishSeoRunWorkerPulse,
} from "@/lib/seoRunWorkerControl";

type SeoRunQueueResult = Awaited<ReturnType<typeof processSeoRunQueue>>;

export type SeoRunWorkerPulseResult = SeoRunQueueResult & {
  pulseClaimed: boolean;
  throttled: boolean;
};

type PulseOptions = {
  config?: ProductLaunchAdminConfig;
  workerId: string;
  maxJobs?: number;
  timeBudgetMs?: number;
  leaseSeconds?: number;
};

const SEO_RUN_BUSY_MAX_JOBS = 4;

let localPulsePromise: Promise<SeoRunWorkerPulseResult> | null = null;

export function runCoalescedSeoRunWorkerPulse(options: PulseOptions) {
  if (localPulsePromise) return localPulsePromise;
  localPulsePromise = runSeoRunWorkerPulse(options).finally(() => {
    localPulsePromise = null;
  });
  return localPulsePromise;
}

export async function runSeoRunWorkerPulse(
  options: PulseOptions,
): Promise<SeoRunWorkerPulseResult> {
  const config = options.config ?? requiredConfig();
  const leaseSeconds = Math.max(
    60,
    Math.min(600, Math.trunc(options.leaseSeconds ?? 300)),
  );
  const pulse = await claimSeoRunWorkerPulse(
    config,
    options.workerId,
    leaseSeconds,
  );
  if (pulse.claimed !== true) {
    await wakeOpsDispatchTask("seo-run-worker", 30).catch(() => false);
    return {
      workerId: options.workerId,
      claimedCount: 0,
      completedCount: 0,
      failedCount: 0,
      queuedCount: 0,
      autoQueuedRegistrationCount: 0,
      results: [],
      pulseClaimed: false,
      throttled: true,
    };
  }

  let storedResult: Record<string, unknown> = {};
  try {
    const result = await processSeoRunQueue({
      workerId: options.workerId,
      maxJobs: options.maxJobs,
      timeBudgetMs: options.timeBudgetMs,
    });
    const shouldWakeSoon =
      result.queuedCount > 0 ||
      result.claimedCount >=
        Math.max(1, Math.trunc(options.maxJobs ?? SEO_RUN_BUSY_MAX_JOBS));
    if (shouldWakeSoon) {
      await wakeOpsDispatchTask("seo-run-worker", 30).catch(() => false);
    }
    if (result.autoQueuedRegistrationCount > 0) {
      await wakeOpsDispatchTask("seo-run-worker", 0).catch(() => false);
    }
    storedResult = {
      ok: true,
      workerId: result.workerId,
      claimedCount: result.claimedCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      queuedCount: result.queuedCount,
      autoQueuedRegistrationCount: result.autoQueuedRegistrationCount,
    };
    return {
      ...result,
      pulseClaimed: true,
      throttled: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    storedResult = { ok: false, error: message.slice(0, 1000) };
    await wakeOpsDispatchTask("seo-run-worker", 60).catch(() => false);
    throw error;
  } finally {
    await finishSeoRunWorkerPulse(
      config,
      options.workerId,
      storedResult,
    ).catch((error) => {
      console.error("[seo-run-pulse] global lease release failed", error);
    });
  }
}

function requiredConfig() {
  const result = getProductLaunchAdminConfig();
  if (!result.ok) throw new Error(result.body.message);
  return result.value;
}
