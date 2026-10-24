import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  combineRecoveryReports,
  failedRecoveryBatchReport,
} from "../public/product-launch-tracker-app/seo-material-recovery-control.js";

test("자료원 한 묶음이 실패해도 성공한 SEO 복구 결과를 보존한다", () => {
  const successful = {
    requestedCount: 1,
    changedCount: 1,
    readyAfterCount: 1,
    unresolvedCount: 0,
    receiptPendingCount: 0,
    results: [{ modelNumber: "AAA097", changed: true }],
  };
  const failed = failedRecoveryBatchReport(
    [{ modelNumber: "AAA220", productName: "늘어나는 대형샤워볼80g 색상랜덤" }],
    new Error("자료 조회 시간 초과"),
  );
  const report = combineRecoveryReports([
    { failed: false, report: successful },
    { failed: true, report: failed },
  ]);

  assert.equal(report.requestedCount, 2);
  assert.equal(report.changedCount, 1);
  assert.equal(report.readyAfterCount, 1);
  assert.equal(report.unresolvedCount, 1);
  assert.equal(report.sourceFailureCount, 1);
  assert.equal(report.failedBatchCount, 1);
  assert.equal(report.results[1].modelNumber, "AAA220");
  assert.match(report.results[1].unresolved[0], /자료원 조회 실패/);
});

test("상품출시 화면은 SEO 재료를 미리 검사한 뒤 같은 계획만 반영한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const control = await readFile(
    new URL(
      "../public/product-launch-tracker-app/seo-material-recovery-control.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(app, /seo-material-recovery-control\.js/);
  assert.match(control, /seo-material-recovery/);
  assert.match(control, /action: "preview"/);
  assert.match(control, /action: "apply"/);
  assert.match(control, /RECOVERY_BATCH_SIZE = 6/);
  assert.match(control, /RECOVERY_REQUEST_TIMEOUT_MS = 25_000/);
  assert.match(control, /pageSize: "100"/);
  assert.match(control, /item\?\.readiness\?\.ready === true/);
  assert.match(control, /failedRecoveryBatchReport\(batchTargets, error\)/);
  assert.match(control, /sourceFailureCount: sum\("sourceFailureCount"\)/);
  assert.match(control, /failedBatchCount: batches\.filter/);
  assert.match(control, /batch\?\.failed === true/);
  assert.match(control, /자료원 조회 실패/);
  assert.match(control, /modelNumbers: list\(batch\?\.modelNumbers\)/);
  assert.match(control, /reportSignature\(latest\) !== text\(batch\?\.signature\)/);
  assert.match(control, /expectedPlanHash: text\(latest\?\.planHash\)/);
  assert.match(control, /확실한 자료만 반영/);
  assert.match(control, /credentials: "same-origin"/);
  assert.doesNotMatch(control, /window\.location\.reload\(\).*requestRecovery/);
});
