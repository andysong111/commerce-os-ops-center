import { createHash } from "node:crypto";

const SOURCE_STAGE = "SHOPLING_RETURN_REGISTERED";
const COMPLETE_STAGE = "SHOPLING_RETURN_INVOICE_RECORDED";
const CJ_FOUND_EVIDENCE = Object.freeze([
  "CJ_ORIGINAL_INVOICE_MATCHED",
  "CJ_RETURN_INVOICE_READBACK_VERIFIED",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digits(value) {
  return clean(value).replace(/\D/g, "");
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function seoulDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("RETURN_INVOICE_AUDIT_DATE_INVALID", "Return pickup audit date is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

export function nextBusinessDayDate(value) {
  const parts = seoulDateParts(value);
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  do cursor.setUTCDate(cursor.getUTCDate() + 1);
  while ([0, 6].includes(cursor.getUTCDay()));
  return formatUtcDate(cursor);
}

export function seoulCalendarDate(value = new Date()) {
  const parts = seoulDateParts(value);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatReturnPickupMemo(input = {}) {
  const outboundInvoiceNo = digits(input.outboundInvoiceNo);
  const returnInvoiceNo = digits(input.returnInvoiceNo);
  if (!/^\d{10,14}$/.test(outboundInvoiceNo) || !/^\d{10,14}$/.test(returnInvoiceNo)
    || outboundInvoiceNo === returnInvoiceNo) {
    fail("RETURN_INVOICE_PAIR_INVALID", "Original and return invoice numbers must be distinct 10-14 digit values.");
  }
  return `[반품수거] CJ대한통운 반품운송장번호: ${returnInvoiceNo} / 원송장: ${outboundInvoiceNo}`;
}

export function buildReturnPickupQnaEvidence(audit = {}) {
  const returnInvoiceNo = digits(audit?.returnInvoiceReceipt?.returnInvoiceNo);
  if (audit.stage !== COMPLETE_STAGE || !/^\d{10,14}$/.test(returnInvoiceNo)) return null;
  return {
    orderNo: clean(audit.orderNo),
    code: "CURRENT_CLAIM_AND_PICKUP_STATUS",
    status: "VERIFIED",
    verifiedAt: clean(audit.returnInvoiceReceipt.observedAt || audit.updatedAt),
    maxAgeMinutes: 7 * 24 * 60,
    replyText: `안녕하세요. 반품 수거 접수된 CJ대한통운 반품운송장번호는 ${returnInvoiceNo}입니다. 감사합니다.`,
  };
}

function publicResult(audit, extra = {}) {
  return {
    actionKey: clean(audit.actionKey),
    orderNo: clean(audit.orderNo),
    outboundInvoiceNo: digits(audit.outboundInvoiceNo),
    ...extra,
  };
}

export function inspectReturnInvoiceReadbackEligibility(audit = {}, now = new Date()) {
  const outboundInvoiceNo = digits(audit.outboundInvoiceNo);
  if (!clean(audit.actionKey) || !/^\d+$/.test(clean(audit.orderNo))
    || !/^\d{10,14}$/.test(outboundInvoiceNo)) {
    fail("RETURN_INVOICE_AUDIT_INVALID", "Return pickup audit identity is incomplete.");
  }
  if (audit.stage === COMPLETE_STAGE) {
    return publicResult(audit, { status: "ALREADY_RECORDED", externalWritesPerformed: false });
  }
  if (audit.stage !== SOURCE_STAGE) {
    return publicResult(audit, { status: "NOT_READY", externalWritesPerformed: false });
  }
  const eligibleOn = nextBusinessDayDate(audit.updatedAt);
  if (seoulCalendarDate(now) < eligibleOn) {
    return publicResult(audit, { status: "NOT_DUE", eligibleOn, externalWritesPerformed: false });
  }
  return publicResult(audit, { status: "DUE", eligibleOn, externalWritesPerformed: false });
}

export async function runReturnInvoiceReadback(input = {}, dependencies = {}) {
  const audit = input.audit || {};
  const execute = input.execute === true;
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const outboundInvoiceNo = digits(audit.outboundInvoiceNo);
  const eligibility = inspectReturnInvoiceReadbackEligibility(audit, now);
  if (eligibility.status !== "DUE") return eligibility;
  const { eligibleOn } = eligibility;
  if (!dependencies.cjAdapter?.lookupReturnInvoice) {
    fail("CJ_RETURN_INVOICE_ADAPTER_UNAVAILABLE", "CJ return-invoice lookup adapter is unavailable.");
  }
  const receipt = await dependencies.cjAdapter.lookupReturnInvoice({ outboundInvoiceNo });
  if (digits(receipt?.outboundInvoiceNo) !== outboundInvoiceNo) {
    fail("CJ_RETURN_INVOICE_ORIGINAL_MISMATCH", "CJ return-invoice lookup returned a different original invoice.");
  }
  if (receipt?.status === "PENDING") {
    return publicResult(audit, {
      status: "RETURN_INVOICE_PENDING",
      eligibleOn,
      externalWritesPerformed: false,
    });
  }
  const returnInvoiceNo = digits(receipt?.returnInvoiceNo);
  const evidence = new Set(receipt?.evidence || []);
  if (receipt?.status !== "FOUND" || !/^\d{10,14}$/.test(returnInvoiceNo)
    || returnInvoiceNo === outboundInvoiceNo
    || CJ_FOUND_EVIDENCE.some((code) => !evidence.has(code))) {
    fail("CJ_RETURN_INVOICE_READBACK_INVALID", "CJ return-invoice evidence is incomplete or inconsistent.");
  }
  const memo = formatReturnPickupMemo({ outboundInvoiceNo, returnInvoiceNo });
  if (!execute) {
    return publicResult(audit, {
      status: "READY_TO_RECORD",
      returnInvoiceNo,
      eligibleOn,
      externalWritesPerformed: false,
    });
  }
  if (!dependencies.memoAdapter?.recordReturnInvoiceMemo) {
    fail("SHOPLING_RETURN_MEMO_ADAPTER_UNAVAILABLE", "Shopling return memo adapter is unavailable.");
  }
  if (typeof dependencies.writeAudit !== "function") {
    fail("RETURN_INVOICE_AUDIT_STORE_UNAVAILABLE", "Return-invoice audit persistence is required for execution.");
  }
  const memoReceipt = await dependencies.memoAdapter.recordReturnInvoiceMemo(memo);
  if (clean(memoReceipt?.orderNo) !== clean(audit.orderNo) || memoReceipt?.category !== "R") {
    fail("SHOPLING_RETURN_MEMO_RECEIPT_INVALID", "Shopling memo receipt did not match the exact order and category.");
  }
  const observedAt = now.toISOString();
  const nextAudit = {
    ...audit,
    schemaVersion: 2,
    stage: COMPLETE_STAGE,
    returnInvoiceReceipt: {
      outboundInvoiceNo,
      returnInvoiceNo,
      evidence: [...CJ_FOUND_EVIDENCE],
      observedAt,
    },
    shoplingMemoReceipt: {
      category: "R",
      memoHash: createHash("sha256").update(memo, "utf8").digest("hex"),
      recordedAt: observedAt,
      alreadyRecorded: memoReceipt.alreadyRecorded === true,
    },
    updatedAt: observedAt,
  };
  await dependencies.writeAudit(audit.actionKey, nextAudit);
  return publicResult(nextAudit, {
    status: "RETURN_INVOICE_RECORDED",
    returnInvoiceNo,
    eligibleOn,
    externalWritesPerformed: memoReceipt.changed === true,
    audit: nextAudit,
  });
}

export const SHOPLING_RETURN_INVOICE_READBACK_RULES = Object.freeze({
  sourceAuditStage: SOURCE_STAGE,
  completeAuditStage: COMPLETE_STAGE,
  nextBusinessDayWeekdays: [1, 2, 3, 4, 5],
  pendingIsRetryable: true,
  cjFoundEvidence: CJ_FOUND_EVIDENCE,
  shoplingMemoCategory: "R",
});
