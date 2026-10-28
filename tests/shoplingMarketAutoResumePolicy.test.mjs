import assert from "node:assert/strict";
import test from "node:test";

import {
  marketAutoRunIdSetsEqual,
  marketAutoRunIdSetsOverlap,
  marketOnlyLedgerSafety,
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
