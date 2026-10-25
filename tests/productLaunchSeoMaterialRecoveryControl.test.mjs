import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  combineRecoveryReports,
  failedRecoveryBatchReport,
  readyRecoveryModelNumbers,
  recoveryModelStatus,
  recoveryRowSummary,
} from "../public/product-launch-tracker-app/seo-material-recovery-control.js";

test("확실한 자료 반영은 복구 후 준비완료 모델만 선택한다", () => {
  const report = {
    results: [
      { modelNumber: "AAA097", status: "ready_after_recovery", changed: true },
      { modelNumber: "AAA162", status: "partially_recovered", changed: true },
      { modelNumber: "AAA410", status: "unresolved", changed: false },
      { modelNumber: "AAA097", status: "ready_after_recovery", changed: true },
    ],
  };

  assert.deepEqual(readyRecoveryModelNumbers(report), ["AAA097"]);
  assert.equal(recoveryModelStatus(report, "AAA162"), "partially_recovered");
  assert.equal(recoveryModelStatus(report, "AAA999"), "");
});

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

test("일부 복구 행은 채운 값과 아직 부족한 값을 함께 보여준다", () => {
  const row = recoveryRowSummary({
    modelNumber: "AAA452",
    productName: "반자동 책갈피 3P 색상랜덤",
    status: "partially_recovered",
    changedFields: ["orderOptions"],
    unresolved: ["상세페이지 HTML이 없습니다.", "기준 판매가가 없습니다."],
  });

  assert.equal(
    row.detail,
    "보완: orderOptions · 남음: 상세페이지 HTML이 없습니다. · 기준 판매가가 없습니다.",
  );
});

test("상품출시 화면은 SEO 재료를 상품별로 다시 검사한 뒤 반영한다", async () => {
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
  assert.match(control, /RECOVERY_REQUEST_TIMEOUT_MS = 90_000/);
  assert.match(control, /RECOVERY_PREVIEW_ATTEMPTS = 2/);
  assert.match(control, /자료 조회가 90초를 넘었습니다/);
  assert.match(control, /pageSize: "100"/);
  assert.match(control, /item\?\.readiness\?\.ready === true/);
  assert.match(control, /자료 조회 개별 재검사/);
  assert.match(control, /requestRecoveryPreview\(\[target\.modelNumber\]\)/);
  assert.match(control, /failedRecoveryBatchReport\(\[target\], targetError\)/);
  assert.match(control, /sourceFailureCount: sum\("sourceFailureCount"\)/);
  assert.match(control, /failedBatchCount: batches\.filter/);
  assert.match(control, /requestRecoveryPreview\(modelNumbers\)/);
  assert.match(control, /for \(const \[index, modelNumber\] of modelNumbers\.entries\(\)\)/);
  assert.match(control, /requestRecoveryPreview\(\[modelNumber\]\)/);
  assert.match(control, /readyRecoveryModelNumbers\(latest\)\.includes\(modelNumber\)/);
  assert.match(control, /latestStatus === "already_ready"/);
  assert.match(control, /준비완료 \$\{readyCount\}건 반영/);
  assert.match(control, /const applyFailures = \[\]/);
  assert.match(control, /applyFailures\.push/);
  assert.match(control, /은 다시 검사합니다/);
  assert.match(control, /자료원 조회 실패/);
  assert.match(control, /modelNumbers: \[modelNumber\]/);
  assert.match(control, /expectedPlanHash: text\(latest\?\.planHash\)/);
  assert.match(control, /확실한 자료만 반영/);
  assert.match(control, /credentials: "same-origin"/);
  assert.doesNotMatch(control, /window\.location\.reload\(\).*requestRecovery/);
});
