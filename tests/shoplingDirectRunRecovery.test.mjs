import assert from "node:assert/strict";
import test from "node:test";
import { recoverLatestPendingDirectJobs } from "../src/lib/shoplingDirectRunRecovery.ts";

test("recovers only pending direct jobs from the latest saved command request", () => {
  const recovered = recoverLatestPendingDirectJobs({
    ok: true,
    retransmission: {
      latest: {
        requestId: "unified-command:new",
        pendingCount: 1,
        startedCount: 0,
        exceptionCount: 0,
      },
    },
    jobs: [
      {
        jobId: "new-1",
        barcode: "BAF1-1",
        retransmissionRequestId: "unified-command:new",
        directOperatorCommand: true,
      },
      {
        jobId: "old-1",
        barcode: "OLD-1",
        retransmissionRequestId: "unified-command:old",
        directOperatorCommand: true,
      },
      {
        jobId: "automatic-1",
        barcode: "AUTO-1",
        retransmissionRequestId: "unified-command:new",
        directOperatorCommand: false,
      },
    ],
  });

  assert.equal(recovered?.requestId, "unified-command:new");
  assert.deepEqual(recovered?.jobs.map((job) => job.barcode), ["BAF1-1"]);
});

test("does not offer retry without a latest pending direct command", () => {
  assert.equal(
    recoverLatestPendingDirectJobs({
      ok: true,
      retransmission: {
        latest: {
          requestId: "unified-command:done",
          pendingCount: 0,
          startedCount: 0,
          exceptionCount: 0,
        },
      },
      jobs: [],
    }),
    null,
  );
  assert.equal(recoverLatestPendingDirectJobs({ ok: false }), null);
});

test("never resumes a shortened or substituted direct command as the entire remaining list", () => {
  const requestId = "unified-command:new";
  const jobs = ["BCD8-1","BCD8-2"].map((barcode, i) => ({barcode,jobId:"j"+i,desiredStatus:"ON_SALE",
    retransmissionRequestId:requestId,directOperatorCommand:true}));
  const retransmission = {latest:{requestId,pendingCount:2,startedCount:0,exceptionCount:0,
    items:jobs.map(j=>({...j,state:"PENDING"}))}};
  assert.deepEqual(recoverLatestPendingDirectJobs({ok:true,jobs,retransmission}).jobs,jobs);
  for (const wrong of [jobs.slice(0,1), [jobs[0],jobs[0]], [jobs[0],{...jobs[1],desiredStatus:"SOLD_OUT"}]]) {
    assert.throws(()=>recoverLatestPendingDirectJobs({ok:true,jobs:wrong,retransmission}),/복구된 전송 목록/);
  }
});

test("does not recover a batch that already has an active or exception result", () => {
  for (const latest of [
    { requestId: "active", pendingCount: 1, startedCount: 1, exceptionCount: 0 },
    { requestId: "failed", pendingCount: 1, startedCount: 0, exceptionCount: 1 },
  ]) {
    assert.equal(
      recoverLatestPendingDirectJobs({
        ok: true,
        retransmission: { latest },
        jobs: [
          {
            jobId: "job-1",
            barcode: "BAF1-1",
            retransmissionRequestId: latest.requestId,
            directOperatorCommand: true,
          },
        ],
      }),
      null,
    );
  }
});
