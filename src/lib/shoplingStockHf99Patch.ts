const API_RESULT_GUARD = `    if (!payload.result.goodsKeys.length || !Array.isArray(payload.result.receipts)) {
      throw new Error("Shopling API 검증 goods key 또는 실행 영수증이 없습니다.");
    }
    return payload.result;`;

const API_RESULT_GUARD_PATCH = `    if (!Array.isArray(payload.result.receipts)) {
      throw new Error("Shopling API 실행 영수증 형식이 올바르지 않습니다.");
    }
    const endedOnlyHf99 = Boolean(
      payload.result.noActionableGoodsKeys === true &&
      payload.result.goodsKeys.length === 0 &&
      payload.result.receipts.length === 0 &&
      Array.isArray(payload.result.transmissions) &&
      payload.result.transmissions.length === 0 &&
      Number(payload.result.skippedEndedCount || 0) > 0
    );
    if (!payload.result.goodsKeys.length && !endedOnlyHf99) {
      throw new Error("Shopling API 검증 goods key가 없습니다.");
    }
    return payload.result;`;

const ACTIONABLE_SPLIT_MARKER = `
    let job;
    try {
      job = buildCoalescedJob(jobs, apiResults);`;

const ACTIONABLE_SPLIT_PATCH = `
    const actionableJobsHf99 = [];
    const actionableApiResultsHf99 = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const result = apiResults[index];
      if (result?.noActionableGoodsKeys === true) {
        const skippedEndedGoodsKeys = Array.isArray(result.skippedEndedGoodsKeys)
          ? result.skippedEndedGoodsKeys
          : [];
        post({
          type: RESULT,
          jobId: jobs[index]?.jobId || "",
          job: jobs[index] || null,
          outcome: "SUCCEEDED",
          message: \`${"${jobs[index]?.barcode || \"B코드\"}"} · 판매종료(E) ${"${skippedEndedGoodsKeys.length}"}건은 변경·전송 대상에서 제외했습니다. 처리할 나머지 Shopling 상품이 없어 A21 전송은 실행하지 않았습니다.\`,
          evidence: {
            code: "HF99_ENDED_ONLY_NO_TRANSMISSION",
            browserMutationStarted: false,
            shoplingTransmissionStarted: false,
            skippedEndedGoodsKeys,
          },
          finishedAt: Date.now(),
        });
        continue;
      }
      actionableJobsHf99.push(jobs[index]);
      actionableApiResultsHf99.push(result);
    }
    if (!actionableJobsHf99.length) return;

    let job;
    try {
      job = buildCoalescedJob(actionableJobsHf99, actionableApiResultsHf99);`;

const PLAN_FAILURE_MARKER = `    } catch (error) {
      await failJobs(jobs, String(error?.message || error), {
        code: "SHOPLING_STOCK_STATE_COALESCED_PLAN_FAILED",`;

const PLAN_FAILURE_PATCH = `    } catch (error) {
      await failJobs(actionableJobsHf99, String(error?.message || error), {
        code: "SHOPLING_STOCK_STATE_COALESCED_PLAN_FAILED",`;

const PROGRESS_MESSAGE_MARKER = `          jobs.length > 1
            ? \`동일 모델 B코드 ${"${jobs.length}"}건 API 선적용 완료 · 중복 없이 A21 1회 전송을 시작했습니다.\``;

const PROGRESS_MESSAGE_PATCH = `          actionableJobsHf99.length > 1
            ? \`동일 모델 B코드 ${"${actionableJobsHf99.length}"}건 API 선적용 완료 · 중복 없이 A21 1회 전송을 시작했습니다.\``;

const TEST_HOOK_MARKER = `      normalizedCoalescedJobs,
      buildCoalescedJob,
      postResultForJobs,`;

const TEST_HOOK_PATCH = `      normalizedCoalescedJobs,
      buildCoalescedJob,
      postResultForJobs,
      applyStockStateApi,
      startFromOps,`;

export function patchHf99EndedProductSkip(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  for (const marker of [
    API_RESULT_GUARD,
    ACTIONABLE_SPLIT_MARKER,
    PLAN_FAILURE_MARKER,
    PROGRESS_MESSAGE_MARKER,
    TEST_HOOK_MARKER,
  ]) {
    if (!normalized.includes(marker)) {
      throw new Error("shopling_stock_hf99_patch_checkpoint_mismatch");
    }
  }

  const patched = normalized
    .replace(API_RESULT_GUARD, API_RESULT_GUARD_PATCH)
    .replace(ACTIONABLE_SPLIT_MARKER, ACTIONABLE_SPLIT_PATCH)
    .replace(PLAN_FAILURE_MARKER, PLAN_FAILURE_PATCH)
    .replace(PROGRESS_MESSAGE_MARKER, PROGRESS_MESSAGE_PATCH)
    .replace(TEST_HOOK_MARKER, TEST_HOOK_PATCH);

  for (const guard of [
    "HF99_ENDED_ONLY_NO_TRANSMISSION",
    "shoplingTransmissionStarted: false",
    "actionableJobsHf99",
    "noActionableGoodsKeys === true",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf99_guard_missing:${guard}`);
    }
  }
  return patched;
}
