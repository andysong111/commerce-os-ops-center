import assert from "node:assert/strict";
import test from "node:test";

import {
  findActiveMarketAutoRunOverlap,
  marketAutoContinuationAllowed,
  marketAutoRunIdSetsEqual,
  marketAutoRunIdSetsOverlap,
  marketOnlyLedgerSafety,
  remainingMarketAutoRunIds,
  verifiedMarketOnlyUploadJob,
} from "../src/lib/shoplingMarketAutoResumePolicy.ts";

function verifiedJob(productIndex) {
  const rows = Array.from({ length: 6 }, (_, channelIndex) => ({
    status: "success",
    channel_key: `channel-${channelIndex + 1}`,
    goods_key: String(100000 + productIndex * 10 + channelIndex),
  }));
  return {
    id: `00000000-0000-4000-8000-${String(productIndex).padStart(12, "0")}`,
    status: "success",
    result: {
      success_count: 6,
      failed_count: 0,
      rows,
      readback_verification: {
        verified: true,
        expectedCount: 6,
        verifiedCount: 6,
        missingCount: 0,
      },
    },
  };
}

test("521 복구 대상 38상품은 기존 228 goods_key만으로 마켓전송 재개가 가능하다", () => {
  const verified = Array.from({ length: 38 }, (_, index) =>
    verifiedMarketOnlyUploadJob(verifiedJob(index + 1)),
  );
  assert.equal(verified.every(Boolean), true);
  const goodsKeys = verified.flatMap((job) => job?.goodsKeys ?? []);
  assert.equal(goodsKeys.length, 228);
  assert.equal(new Set(goodsKeys).size, 228);

  const safety = marketOnlyLedgerSafety(goodsKeys, []);
  assert.equal(safety.safe, true);
  assert.equal(safety.pendingCount, 228);
  assert.equal(safety.completedCount, 0);
});

test("실상품 재조회가 하나라도 불완전하면 마켓전송만 재개에서 제외한다", () => {
  const job = verifiedJob(1);
  job.result.readback_verification.verified = false;
  job.result.readback_verification.verifiedCount = 5;
  job.result.readback_verification.missingCount = 1;
  assert.equal(verifiedMarketOnlyUploadJob(job), null);
});

test("이미 전송 중이거나 확인필요인 goods_key는 중복 전송을 차단한다", () => {
  const goodsKeys = ["100001", "100002", "100003"];
  const safety = marketOnlyLedgerSafety(goodsKeys, [
    { goods_key: "100001", status: "sent", market_status: "sent" },
    { goods_key: "100002", status: "claimed", market_status: "pending" },
    { goods_key: "100003", status: "confirm_needed", market_status: "confirm_needed" },
  ]);
  assert.equal(safety.safe, false);
  assert.equal(safety.completedCount, 1);
  assert.equal(safety.busyCount, 1);
  assert.equal(safety.blockedCount, 1);
});

test("같은 토큰의 재시도는 같은 RUN 집합만 허용하고 다른 활성 작업은 겹침을 감지한다", () => {
  const original = ["seo-run-b", "seo-run-a"];
  assert.equal(marketAutoRunIdSetsEqual(original, ["seo-run-a", "seo-run-b"]), true);
  assert.equal(marketAutoRunIdSetsEqual(original, ["seo-run-a"]), false);
  assert.equal(marketAutoRunIdSetsOverlap(original, ["seo-run-c", "seo-run-b"]), true);
  assert.equal(marketAutoRunIdSetsOverlap(original, ["seo-run-c"]), false);
});

test("작업번호 3e2ada48 회귀: 살아 있는 기존 작업은 새 중복 생성 대신 재연결 대상으로 찾는다", () => {
  const rows = [
    {
      id: "3e2ada48-0000-4000-8000-000000000001",
      state: "market_ready",
      run_ids: ["seo-run-existing-a", "seo-run-existing-b"],
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      state: "completed",
      run_ids: ["seo-run-terminal"],
    },
  ];

  assert.equal(
    findActiveMarketAutoRunOverlap(rows, ["seo-run-new", "seo-run-existing-b"])?.id,
    "3e2ada48-0000-4000-8000-000000000001",
  );
  assert.equal(findActiveMarketAutoRunOverlap(rows, ["seo-run-terminal"]), null);
  assert.equal(findActiveMarketAutoRunOverlap(rows, ["seo-run-new"]), null);
});

test("활성 작업이 끝나면 그 작업에 포함되지 않은 신규 RUN만 후속 등록한다", () => {
  assert.deepEqual(
    remainingMarketAutoRunIds(
      ["seo-run-existing-a", "seo-run-new", "seo-run-new", "seo-run-existing-b"],
      ["seo-run-existing-a", "seo-run-existing-b"],
    ),
    ["seo-run-new"],
  );
  assert.deepEqual(
    remainingMarketAutoRunIds(
      ["seo-run-existing-a", "seo-run-existing-b"],
      ["seo-run-existing-b", "seo-run-existing-a"],
    ),
    [],
  );
});

test("후속 신규 등록은 정상 종료 또는 확인필요 종료 뒤에만 허용한다", () => {
  assert.equal(marketAutoContinuationAllowed("completed"), true);
  assert.equal(marketAutoContinuationAllowed("completed_with_exceptions"), true);
  assert.equal(marketAutoContinuationAllowed("exception"), false);
  assert.equal(marketAutoContinuationAllowed("cancelled"), false);
  assert.equal(marketAutoContinuationAllowed("market_running"), false);
});

test("원클릭 UI는 생성 전에 활성 중복을 재연결하고 409 경합도 같은 복구 경로로 처리한다", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /findActiveMarketAutoRunOverlap/);
  assert.match(source, /activeOverlap && await resumeActiveOverlap\(activeOverlap\)/);
  assert.match(source, /startError\.status === 409/);
  assert.match(source, /새 중복 작업은 만들지 않았습니다/);
});

test("활성 작업과 신규 등록이 겹치면 종료 뒤 남은 RUN을 단일 후속 작업으로 자동 연결한다", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /remainingMarketAutoRunIds\(\s*runIds,\s*activeRunIds/);
  assert.match(source, /continuationMode/);
  assert.match(source, /continuationRunIds/);
  assert.match(source, /handoffRecoveryInFlightRef\.current/);
  assert.match(source, /기존 작업 완료 확인 · 신규 \$\{continuationRunIds\.length\}개 등록을 자동으로 시작합니다/);
  assert.match(source, /retryError\.message\.includes\("마켓전송 작업이 이미 진행 중"\)/);
  assert.match(source, /기존 작업 종료를 기다린 뒤 신규 등록을 자동 재시도합니다/);

  const terminalBranch = source.indexOf("if (current && terminalState(text(current.state)))");
  const successorCreate = source.indexOf("createOrResumeOrchestration(mode, runIds, token)", terminalBranch);
  assert.ok(terminalBranch >= 0);
  assert.ok(successorCreate > terminalBranch);
});
