const CJ_SUCCESS_EVIDENCE = Object.freeze([
  "SAVE_DIALOG_CLOSED",
  "ORIGINAL_INVOICE_FIELD_RESET",
  "RESERVATION_GRID_ROW_APPENDED",
]);
const CJ_EXISTING_RESERVATION_EVIDENCE = Object.freeze([
  "DUPLICATE_RESERVATION_DIALOG_VERIFIED",
]);

const AUDIT_CJ_VERIFIED = "CJ_RESERVATION_VERIFIED";
const AUDIT_COMPLETE = "SHOPLING_RETURN_REGISTERED";
const AUDIT_RETURN_INVOICE_RECORDED = "SHOPLING_RETURN_INVOICE_RECORDED";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

export function normalizeReturnPickupStep(step = {}) {
  const claimKey = clean(step.claimKey);
  const orderNo = clean(step.orderNo);
  const outboundInvoiceNo = clean(step.outboundInvoiceNo).replace(/\D/g, "");
  const productName = clean(step.productName);
  const actionKey = clean(step.actionKey);
  const expectedActionKey = `cj-return-pickup:${orderNo}:${outboundInvoiceNo}`;
  if (!claimKey || !orderNo || !/^\d{10,14}$/.test(outboundInvoiceNo)
    || actionKey !== expectedActionKey) {
    fail("RETURN_PICKUP_STEP_INVALID", "The reviewed return pickup step is incomplete or inconsistent.");
  }
  return { actionKey, claimKey, orderNo, outboundInvoiceNo, ...(productName ? { productName } : {}) };
}

function assertCurrentStep(reviewed, currentSteps = []) {
  const matches = currentSteps.map(normalizeReturnPickupStep)
    .filter((step) => step.actionKey === reviewed.actionKey);
  if (matches.length !== 1) {
    fail("RETURN_PICKUP_PLAN_CHANGED", "The current pickup plan no longer contains exactly one approved action.", {
      matchCount: matches.length,
    });
  }
  const current = matches[0];
  if (current.claimKey !== reviewed.claimKey
    || current.orderNo !== reviewed.orderNo
    || current.outboundInvoiceNo !== reviewed.outboundInvoiceNo) {
    fail("RETURN_PICKUP_PLAN_CHANGED", "The current pickup identity differs from the reviewed action.");
  }
  return current;
}

function assertAuditIdentity(audit, step) {
  if (!audit) return;
  if (audit.actionKey !== step.actionKey
    || audit.claimKey !== step.claimKey
    || audit.orderNo !== step.orderNo
    || audit.outboundInvoiceNo !== step.outboundInvoiceNo) {
    fail("RETURN_PICKUP_AUDIT_IDENTITY_MISMATCH", "The saved pickup audit does not match the approved action.");
  }
}

function verifyCjReceipt(receipt, step) {
  const evidence = new Set(receipt?.evidence || []);
  const invoice = clean(receipt?.outboundInvoiceNo).replace(/\D/g, "");
  const newReservationVerified = CJ_SUCCESS_EVIDENCE.every((item) => evidence.has(item));
  const existingReservationVerified = receipt?.alreadyRegistered === true
    && CJ_EXISTING_RESERVATION_EVIDENCE.every((item) => evidence.has(item));
  if (invoice !== step.outboundInvoiceNo
    || (!newReservationVerified && !existingReservationVerified)) {
    fail("CJ_RETURN_PICKUP_READBACK_INCOMPLETE", "CJ did not provide all immediate reservation success evidence.");
  }
  return {
    outboundInvoiceNo: invoice,
    evidence: newReservationVerified
      ? [...CJ_SUCCESS_EVIDENCE]
      : [...CJ_EXISTING_RESERVATION_EVIDENCE],
    alreadyRegistered: existingReservationVerified,
    returnInvoiceTiming: "NEXT_BUSINESS_DAY",
  };
}

function publicResult(step, extra = {}) {
  return {
    actionKey: step.actionKey,
    claimKey: step.claimKey,
    orderNo: step.orderNo,
    outboundInvoiceNo: step.outboundInvoiceNo,
    ...extra,
    privacy: {
      recipientNameStored: false,
      phoneStored: false,
      addressStored: false,
    },
  };
}

export async function runCjReturnPickupStage(input = {}, dependencies = {}) {
  const step = normalizeReturnPickupStep(input.step);
  const execute = input.execute === true;
  const approvalKey = clean(input.approvalKey);
  const readAudit = dependencies.readAudit || (async () => null);
  const writeAudit = dependencies.writeAudit || (async () => {});
  const audit = await readAudit(step.actionKey);
  assertAuditIdentity(audit, step);

  if ([AUDIT_COMPLETE, AUDIT_CJ_VERIFIED, AUDIT_RETURN_INVOICE_RECORDED].includes(audit?.stage)) {
    if (audit?.cjReceipt) verifyCjReceipt(audit.cjReceipt, step);
    return publicResult(step, {
      status: [AUDIT_COMPLETE, AUDIT_RETURN_INVOICE_RECORDED].includes(audit.stage)
        ? "ALREADY_COMPLETED"
        : "CJ_ALREADY_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION",
      externalWritesPerformed: false,
      returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
    });
  }

  const currentSteps = await dependencies.loadCurrentPickupSteps(step);
  assertCurrentStep(step, currentSteps);
  if (!execute) {
    return publicResult(step, {
      status: "CJ_PREFLIGHT_READY",
      externalWritesPerformed: false,
    });
  }
  if (approvalKey !== step.actionKey) {
    fail("RETURN_PICKUP_APPROVAL_REQUIRED", "Execution requires the exact reviewed action key.");
  }
  if (!dependencies.cjAdapter?.reserveReturnPickup) {
    fail("CJ_RETURN_PICKUP_ADAPTER_UNAVAILABLE", "The CJ return pickup browser adapter is not available.");
  }

  const cjReceipt = verifyCjReceipt(await dependencies.cjAdapter.reserveReturnPickup(step), step);
  await writeAudit(step.actionKey, {
    schemaVersion: 1,
    stage: AUDIT_CJ_VERIFIED,
    ...step,
    cjReceipt,
    updatedAt: new Date().toISOString(),
  });
  return publicResult(step, {
    status: cjReceipt.alreadyRegistered
      ? "CJ_ALREADY_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION"
      : "CJ_RESERVED_PENDING_SHOPLING_RETURN_REGISTRATION",
    externalWritesPerformed: !cjReceipt.alreadyRegistered,
    cjImmediateEvidence: cjReceipt.evidence,
    returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
  });
}

export async function runShoplingReturnPickupExecution(input = {}, dependencies = {}) {
  const step = normalizeReturnPickupStep(input.step);
  const execute = input.execute === true;
  const approvalKey = clean(input.approvalKey);
  const readAudit = dependencies.readAudit || (async () => null);
  const writeAudit = dependencies.writeAudit || (async () => {});
  const audit = await readAudit(step.actionKey);
  assertAuditIdentity(audit, step);

  if ([AUDIT_COMPLETE, AUDIT_RETURN_INVOICE_RECORDED].includes(audit?.stage)) {
    return publicResult(step, {
      status: "ALREADY_COMPLETED",
      externalWritesPerformed: false,
      returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
    });
  }

  if (audit?.stage === AUDIT_CJ_VERIFIED) verifyCjReceipt(audit.cjReceipt, step);

  const b7State = await dependencies.b7Adapter.readExactOrder(step.orderNo);
  const b7Statuses = [...new Set((b7State?.rows || []).map((row) => clean(row.statusCode)))];
  if (b7Statuses.length === 1 && b7Statuses[0] === "R01" && audit?.stage !== AUDIT_CJ_VERIFIED) {
    fail("RETURN_PICKUP_IDEMPOTENCE_UNCERTAIN", "B7 is already R01 without a matching CJ reservation audit.");
  }

  if (audit?.stage !== AUDIT_CJ_VERIFIED) {
    const currentSteps = await dependencies.loadCurrentPickupSteps(step);
    assertCurrentStep(step, currentSteps);
  }

  if (!execute) {
    return publicResult(step, {
      status: "PREFLIGHT_READY",
      externalWritesPerformed: false,
      currentB7Statuses: b7Statuses,
      resumesAfterCjReservation: audit?.stage === AUDIT_CJ_VERIFIED,
    });
  }
  if (approvalKey !== step.actionKey) {
    fail("RETURN_PICKUP_APPROVAL_REQUIRED", "Execution requires the exact reviewed action key.");
  }

  let cjReceipt = audit?.cjReceipt || null;
  let externalWritesPerformed = false;
  if (audit?.stage !== AUDIT_CJ_VERIFIED) {
    if (!dependencies.cjAdapter?.reserveReturnPickup) {
      fail("CJ_RETURN_PICKUP_ADAPTER_UNAVAILABLE", "The CJ return pickup browser adapter is not available.");
    }
    cjReceipt = verifyCjReceipt(await dependencies.cjAdapter.reserveReturnPickup(step), step);
    externalWritesPerformed = !cjReceipt.alreadyRegistered;
    await writeAudit(step.actionKey, {
      schemaVersion: 1,
      stage: AUDIT_CJ_VERIFIED,
      ...step,
      cjReceipt,
      updatedAt: new Date().toISOString(),
    });
  } else {
    verifyCjReceipt(cjReceipt, step);
  }

  let b7Result;
  if (b7Statuses.length === 1 && b7Statuses[0] === "R01") {
    b7Result = { changed: false, alreadyRegistered: true, statusCode: "R01" };
  } else {
    b7Result = await dependencies.b7Adapter.registerReturnReceived({
      orderNo: step.orderNo,
      claimContent: clean(input.claimContent) || "단순변심 반품 수거접수",
    });
    externalWritesPerformed = externalWritesPerformed || b7Result?.changed === true;
  }
  if (b7Result?.statusCode !== "R01") {
    fail("B7_RETURN_REGISTRATION_READBACK_FAILED", "B7 did not verify the R01 return-received state.");
  }

  await writeAudit(step.actionKey, {
    schemaVersion: 1,
    stage: AUDIT_COMPLETE,
    ...step,
    cjReceipt,
    shoplingStatusCode: "R01",
    updatedAt: new Date().toISOString(),
  });
  return publicResult(step, {
    status: "PICKUP_RESERVED_AND_RETURN_REGISTERED",
    externalWritesPerformed,
    cjImmediateEvidence: cjReceipt.evidence,
    shoplingStatusCode: "R01",
    returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
  });
}

export const SHOPLING_RETURN_PICKUP_EXECUTION_RULES = Object.freeze({
  cjSuccessEvidence: CJ_SUCCESS_EVIDENCE,
  cjExistingReservationEvidence: CJ_EXISTING_RESERVATION_EVIDENCE,
  cjVerifiedAuditStage: AUDIT_CJ_VERIFIED,
  completeAuditStage: AUDIT_COMPLETE,
  returnInvoiceRecordedAuditStage: AUDIT_RETURN_INVOICE_RECORDED,
  shoplingSourceStatus: "A05",
  shoplingNextStatus: "R01",
  exactApprovalRequired: true,
});
