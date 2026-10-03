import assert from "node:assert/strict";
import test from "node:test";
import {
  runCjReturnPickupStage,
  runShoplingReturnPickupExecution,
} from "../local-agent/src/shopling-return-pickup-execution.mjs";

const step = {
  actionKey: "cj-return-pickup:3493809:587625375225",
  claimKey: "C-1",
  orderNo: "3493809",
  outboundInvoiceNo: "587625375225",
};

function b7(status = "A05", calls = []) {
  return {
    async readExactOrder(orderNo) {
      calls.push(["b7-read", orderNo]);
      return { rows: [{ orderNo, statusCode: status }] };
    },
    async registerReturnReceived(input) {
      calls.push(["b7-write", input]);
      return { changed: true, statusCode: "R01" };
    },
  };
}

function cj(calls = [], receipt = {}) {
  return {
    async reserveReturnPickup(input) {
      calls.push(["cj-write", input.actionKey]);
      return {
        outboundInvoiceNo: input.outboundInvoiceNo,
        evidence: [
          "SAVE_DIALOG_CLOSED",
          "ORIGINAL_INVOICE_FIELD_RESET",
          "RESERVATION_GRID_ROW_APPENDED",
        ],
        ...receipt,
      };
    },
  };
}

function dependencies(overrides = {}) {
  const calls = overrides.calls || [];
  return {
    calls,
    b7Adapter: b7("A05", calls),
    cjAdapter: cj(calls),
    loadCurrentPickupSteps: async () => {
      calls.push(["plan-read"]);
      return [step];
    },
    readAudit: async () => null,
    writeAudit: async (key, value) => calls.push(["audit-write", key, value.stage]),
    ...overrides,
  };
}

test("dry run verifies the current exact action and performs no writes", async () => {
  const deps = dependencies();
  const result = await runShoplingReturnPickupExecution({ step }, deps);
  assert.equal(result.status, "PREFLIGHT_READY");
  assert.equal(result.externalWritesPerformed, false);
  assert.deepEqual(deps.calls, [["b7-read", "3493809"], ["plan-read"]]);
});

test("execution requires the exact action key as approval", async () => {
  const deps = dependencies();
  await assert.rejects(
    runShoplingReturnPickupExecution({ step, execute: true, approvalKey: "wrong" }, deps),
    { code: "RETURN_PICKUP_APPROVAL_REQUIRED" },
  );
  assert.equal(deps.calls.some(([kind]) => kind === "cj-write" || kind === "b7-write"), false);
});

test("CJ is verified and audited before B7 changes to R01", async () => {
  const deps = dependencies();
  const result = await runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "PICKUP_RESERVED_AND_RETURN_REGISTERED");
  assert.equal(result.shoplingStatusCode, "R01");
  assert.deepEqual(deps.calls.map(([kind, , stage]) => stage ? `${kind}:${stage}` : kind), [
    "b7-read",
    "plan-read",
    "cj-write",
    "audit-write:CJ_RESERVATION_VERIFIED",
    "b7-write",
    "audit-write:SHOPLING_RETURN_REGISTERED",
  ]);
});

test("incomplete CJ success evidence blocks the Shopling status change", async () => {
  const calls = [];
  const deps = dependencies({
    calls,
    b7Adapter: b7("A05", calls),
    cjAdapter: cj(calls, { evidence: ["SAVE_DIALOG_CLOSED"] }),
  });
  await assert.rejects(runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps), { code: "CJ_RETURN_PICKUP_READBACK_INCOMPLETE" });
  assert.equal(calls.some(([kind]) => kind === "b7-write"), false);
  assert.equal(calls.some(([kind]) => kind === "audit-write"), false);
});

test("an exact CJ duplicate-reservation receipt is audited and continues to B7", async () => {
  const calls = [];
  const deps = dependencies({
    calls,
    cjAdapter: cj(calls, {
      evidence: ["DUPLICATE_RESERVATION_DIALOG_VERIFIED"],
      alreadyRegistered: true,
    }),
  });
  const result = await runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "PICKUP_RESERVED_AND_RETURN_REGISTERED");
  assert.equal(result.externalWritesPerformed, true);
  assert.deepEqual(result.cjImmediateEvidence, ["DUPLICATE_RESERVATION_DIALOG_VERIFIED"]);
  assert.equal(calls.filter(([kind]) => kind === "cj-write").length, 1);
  assert.equal(calls.some(([kind]) => kind === "b7-write"), true);
});

test("CJ-only stage treats the exact duplicate-reservation receipt as idempotent success", async () => {
  const calls = [];
  const deps = dependencies({
    calls,
    cjAdapter: cj(calls, {
      evidence: ["DUPLICATE_RESERVATION_DIALOG_VERIFIED"],
      alreadyRegistered: true,
    }),
  });
  const result = await runCjReturnPickupStage({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "CJ_ALREADY_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION");
  assert.equal(result.externalWritesPerformed, false);
  assert.deepEqual(result.cjImmediateEvidence, ["DUPLICATE_RESERVATION_DIALOG_VERIFIED"]);
  assert.equal(calls.some(([kind, , stage]) => kind === "audit-write"
    && stage === "CJ_RESERVATION_VERIFIED"), true);
});

test("a CJ-verified audit resumes at B7 without booking pickup twice", async () => {
  const calls = [];
  const cjReceipt = {
    outboundInvoiceNo: step.outboundInvoiceNo,
    evidence: [
      "SAVE_DIALOG_CLOSED",
      "ORIGINAL_INVOICE_FIELD_RESET",
      "RESERVATION_GRID_ROW_APPENDED",
    ],
  };
  const deps = dependencies({
    calls,
    b7Adapter: b7("A05", calls),
    readAudit: async () => ({ ...step, stage: "CJ_RESERVATION_VERIFIED", cjReceipt }),
  });
  const result = await runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "PICKUP_RESERVED_AND_RETURN_REGISTERED");
  assert.equal(calls.some(([kind]) => kind === "cj-write"), false);
  assert.equal(calls.some(([kind]) => kind === "plan-read"), false);
  assert.equal(calls.some(([kind]) => kind === "b7-write"), true);
});

test("completed audits are idempotent and perform no browser work", async () => {
  const calls = [];
  const deps = dependencies({
    calls,
    readAudit: async () => ({ ...step, stage: "SHOPLING_RETURN_REGISTERED" }),
  });
  const result = await runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "ALREADY_COMPLETED");
  assert.deepEqual(calls, []);
});

test("return-invoice terminal audits cannot restart pickup or B7 registration", async () => {
  const calls = [];
  const deps = dependencies({
    calls,
    readAudit: async () => ({ ...step, stage: "SHOPLING_RETURN_INVOICE_RECORDED" }),
  });
  const result = await runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "ALREADY_COMPLETED");
  assert.deepEqual(calls, []);
});

test("R01 without a matching CJ audit fails closed", async () => {
  const calls = [];
  const deps = dependencies({ calls, b7Adapter: b7("R01", calls) });
  await assert.rejects(runShoplingReturnPickupExecution({ step }, deps), {
    code: "RETURN_PICKUP_IDEMPOTENCE_UNCERTAIN",
  });
  assert.equal(calls.some(([kind]) => kind === "cj-write"), false);
});

test("a changed current plan blocks CJ execution", async () => {
  const deps = dependencies({
    loadCurrentPickupSteps: async () => [{ ...step, orderNo: "changed" }],
  });
  await assert.rejects(runShoplingReturnPickupExecution({
    step, execute: true, approvalKey: step.actionKey,
  }, deps), { code: "RETURN_PICKUP_STEP_INVALID" });
});

test("CJ-only stage verifies and audits the reservation without touching B7", async () => {
  const deps = dependencies();
  const result = await runCjReturnPickupStage({
    step,
    execute: true,
    approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "CJ_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION");
  assert.deepEqual(deps.calls.map(([kind, , stage]) => stage ? `${kind}:${stage}` : kind), [
    "plan-read",
    "cj-write",
    "audit-write:CJ_RESERVATION_VERIFIED",
  ]);
});

test("CJ-only stage resumes idempotently from its verified audit", async () => {
  const calls = [];
  const cjReceipt = {
    outboundInvoiceNo: step.outboundInvoiceNo,
    evidence: [
      "SAVE_DIALOG_CLOSED",
      "ORIGINAL_INVOICE_FIELD_RESET",
      "RESERVATION_GRID_ROW_APPENDED",
    ],
  };
  const deps = dependencies({
    calls,
    readAudit: async () => ({ ...step, stage: "CJ_RESERVATION_VERIFIED", cjReceipt }),
  });
  const result = await runCjReturnPickupStage({
    step,
    execute: true,
    approvalKey: step.actionKey,
  }, deps);
  assert.equal(result.status, "CJ_ALREADY_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION");
  assert.deepEqual(calls, []);
});
