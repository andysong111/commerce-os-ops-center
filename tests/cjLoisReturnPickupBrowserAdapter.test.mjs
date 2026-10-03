import assert from "node:assert/strict";
import test from "node:test";
import {
  CJ_LOIS_CLICK_SAVE_EXPRESSION,
  CJ_LOIS_CLICK_RESERVATION_ENTRY_EXPRESSION,
  CJ_LOIS_CLICK_RESERVATION_MENU_EXPRESSION,
  CJ_LOIS_FOCUS_INVOICE_EXPRESSION,
  CJ_LOIS_NAVIGATION_PROBE_EXPRESSION,
  CJ_LOIS_PAGE_PROBE_EXPRESSION,
  CJ_LOIS_PREPARE_INVOICE_EXPRESSION,
  CJ_LOIS_PREPARE_INVOICE_SOURCE,
  CJ_LOIS_PREPARE_FORM_SOURCE,
  CJ_LOIS_RETURN_PICKUP_RULES,
  CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION,
  createCjLoisReturnPickupBrowserAdapter,
  ensureCjLoisReservationPage,
  isCjLoisTarget,
  isExpectedCjLoisSaveDialog,
  selectCjLoisReservationFrame,
  selectLiveCjLoisTarget,
} from "../local-agent/src/cj-lois-return-pickup-browser-adapter.mjs";

test("CJ page expressions use stable eXBuilder controls and exclude recipient details", () => {
  assert.match(CJ_LOIS_RETURN_PICKUP_RULES.pageId, /DCRVAP1003M/);
  assert.match(CJ_LOIS_PAGE_PROBE_EXPRESSION, /strOgnWblNo/);
  assert.match(CJ_LOIS_NAVIGATION_PROBE_EXPRESSION, /DCRVAP1003M/);
  assert.match(CJ_LOIS_PREPARE_INVOICE_EXPRESSION, /rdbRsvt/);
  assert.match(CJ_LOIS_PREPARE_INVOICE_EXPRESSION, /smsOgnWblNoInfo/);
  assert.match(CJ_LOIS_CLICK_SAVE_EXPRESSION, /udcComButton/);
  assert.match(CJ_LOIS_CLICK_SAVE_EXPRESSION, /btnSave/);
  assert.match(CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION, /completedReservationRowCount/);
  assert.doesNotMatch(CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION, /고객명|전화번호|주소|상세주소/);
});

test("CJ adapter opens reservation menu and exact enterprise entry before pickup", async () => {
  const frame = { id: "main" };
  let stage = "home";
  const clicked = [];
  const evaluateAcrossFrames = async (_session, expression) => {
    if (expression === CJ_LOIS_PAGE_PROBE_EXPRESSION) {
      return [{ frame, value: { isReservationPage: stage === "page", readyState: "complete" } }];
    }
    if (expression === CJ_LOIS_NAVIGATION_PROBE_EXPRESSION) {
      return [{
        frame,
        value: {
          authenticated: true,
          reservationMenuCount: stage === "home" ? 1 : 0,
          reservationEntryCount: stage === "menu" ? 1 : 0,
        },
      }];
    }
    throw new Error("unexpected expression");
  };
  const evaluateInFrame = async (_session, _frame, expression) => {
    if (expression === CJ_LOIS_CLICK_RESERVATION_MENU_EXPRESSION) {
      clicked.push("예약");
      stage = "menu";
      return { clicked: true };
    }
    if (expression === CJ_LOIS_CLICK_RESERVATION_ENTRY_EXPRESSION) {
      clicked.push("기업고객건별접수");
      stage = "page";
      return { clicked: true };
    }
    throw new Error("unexpected expression");
  };
  const result = await ensureCjLoisReservationPage({}, { pollMs: 0 }, {
    evaluateAcrossFrames,
    evaluateInFrame,
    sleep: async () => {},
  });
  assert.equal(result.navigated, true);
  assert.deepEqual(clicked, ["예약", "기업고객건별접수"]);
});

test("CJ save dialog accepts only the demonstrated exact confirmation", () => {
  assert.equal(isExpectedCjLoisSaveDialog({ type: "confirm", message: "저장하시겠습니까?" }), true);
  assert.equal(isExpectedCjLoisSaveDialog({ type: "confirm", message: "삭제하시겠습니까?" }), false);
  assert.equal(isExpectedCjLoisSaveDialog({ type: "alert", message: "저장하시겠습니까?" }), false);
});

test("CJ frame and tab selection fail closed unless unique", async () => {
  const frame = selectCjLoisReservationFrame([
    { frame: { id: "main" }, value: { isReservationPage: false } },
    { frame: { id: "reservation" }, value: { isReservationPage: true } },
  ]);
  assert.equal(frame.frame.id, "reservation");
  assert.throws(() => selectCjLoisReservationFrame([]), { code: "CJ_RESERVATION_FRAME_COUNT_INVALID" });

  const target = { type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" };
  assert.equal(isCjLoisTarget(target), true);
  assert.equal(isCjLoisTarget({ ...target, url: "https://example.com/" }), false);
  const selected = await selectLiveCjLoisTarget({ cjLoisOrigins: ["https://loisparcelp.cjlogistics.com/"] }, {
    listChromeTargets: async () => ({ available: true, targets: [target] }),
  });
  assert.equal(selected.url, target.url);
});

test("CJ adapter verifies lookup, exact dialog, reset, and appended reservation row", async () => {
  const frame = { id: "reservation" };
  const state = {
    invoice: "",
    productReady: false,
    rows: 1,
    returnChecked: false,
    formReady: false,
  };
  const evaluateAcrossFrames = async () => [{
    frame,
    value: { isReservationPage: true, readyState: "complete" },
  }];
  const evaluateInFrame = async (_session, _frame, expression) => {
    if (expression === CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION) {
      return {
        isReservationPage: true,
        readyState: "complete",
        originalInvoiceDigits: state.invoice,
        reservationTypeReturn: state.returnChecked,
        lookupReady: state.productReady,
        productReady: state.productReady,
        formReady: state.formReady,
        saveButtonCount: 1,
        completedReservationRowCount: state.rows,
        originalInvoiceFieldReset: state.invoice === "",
      };
    }
    if (expression.startsWith(`(${CJ_LOIS_PREPARE_INVOICE_SOURCE})`)) {
      state.returnChecked = true;
      state.invoice = "587625375225";
      return { prepared: true, focused: true, reservationTypeReturn: true };
    }
    if (expression.startsWith(`(${CJ_LOIS_PREPARE_FORM_SOURCE})`)) {
      state.formReady = true;
      return { prepared: true };
    }
    if (expression === CJ_LOIS_CLICK_SAVE_EXPRESSION) return { clicked: true };
    throw new Error("unexpected expression");
  };
  const adapter = createCjLoisReturnPickupBrowserAdapter({}, { pollMs: 0 }, {
    evaluateAcrossFrames,
    evaluateInFrame,
    sleep: async () => { state.productReady = true; },
    acceptSaveDialog: async (_session, trigger) => {
      await trigger();
      state.invoice = "";
      state.productReady = false;
      state.rows += 1;
      return { accepted: true, messageVerified: true };
    },
  });
  const receipt = await adapter.reserveReturnPickup({
    outboundInvoiceNo: "587625375225",
    productName: "테스트 제품",
  });
  assert.deepEqual(receipt.evidence, [
    "SAVE_DIALOG_CLOSED",
    "ORIGINAL_INVOICE_FIELD_RESET",
    "RESERVATION_GRID_ROW_APPENDED",
  ]);
  assert.equal(receipt.dialogVerified, true);
  assert.equal(receipt.previousCompletedReservationRowCount, 1);
  assert.equal(receipt.completedReservationRowCount, 2);
});

test("CJ adapter returns idempotent evidence for the exact duplicate-reservation dialog", async () => {
  const outboundInvoiceNo = "587625375225";
  let saveClicked = false;
  const adapter = createCjLoisReturnPickupBrowserAdapter({}, { pollMs: 0 }, {
    evaluateAcrossFrames: async () => [{ frame: { id: "frame" }, value: { isReservationPage: true } }],
    evaluateInFrame: async (_session, _frame, expression) => {
      if (expression === CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION) {
        return {
          isReservationPage: true,
          readyState: "complete",
          originalInvoiceDigits: outboundInvoiceNo,
          reservationTypeReturn: true,
          lookupReady: true,
          productReady: true,
          formReady: true,
          saveButtonCount: 1,
          completedReservationRowCount: 0,
          originalInvoiceFieldReset: false,
        };
      }
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_INVOICE_SOURCE})`)) {
        return { prepared: true, focused: true };
      }
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_FORM_SOURCE})`)) return { prepared: true };
      if (expression === CJ_LOIS_CLICK_SAVE_EXPRESSION) {
        saveClicked = true;
        return { clicked: true };
      }
      throw new Error(`Unexpected expression: ${expression}`);
    },
    acceptSaveDialog: async (_session, trigger) => {
      await trigger();
      return { alreadyRegistered: true, messageVerified: true };
    },
  });

  const receipt = await adapter.reserveReturnPickup({ outboundInvoiceNo, productName: "테스트 제품" });

  assert.equal(saveClicked, true);
  assert.equal(receipt.alreadyRegistered, true);
  assert.deepEqual(receipt.evidence, ["DUPLICATE_RESERVATION_DIALOG_VERIFIED"]);
  assert.equal(receipt.completedReservationRowCount, 0);
});

test("CJ adapter can verify a live lookup without saving", async () => {
  const outboundInvoiceNo = "587625375225";
  let saveClicked = false;
  const adapter = createCjLoisReturnPickupBrowserAdapter({}, { pollMs: 0 }, {
    evaluateAcrossFrames: async () => [{ frame: { id: "frame" }, value: { isReservationPage: true } }],
    evaluateInFrame: async (_session, _frame, expression) => {
      if (expression === CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION) {
        return {
          isReservationPage: true,
          readyState: "complete",
          originalInvoiceDigits: outboundInvoiceNo,
          reservationTypeReturn: true,
          lookupReady: true,
          productReady: true,
          formReady: true,
          saveButtonCount: 1,
          completedReservationRowCount: 4,
          originalInvoiceFieldReset: false,
        };
      }
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_INVOICE_SOURCE})`)) {
        return { prepared: true, focused: true };
      }
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_FORM_SOURCE})`)) return { prepared: true };
      if (expression === CJ_LOIS_CLICK_SAVE_EXPRESSION) {
        saveClicked = true;
        return { clicked: true };
      }
      throw new Error(`Unexpected expression: ${expression}`);
    },
  });

  const result = await adapter.prepareReturnPickup({ outboundInvoiceNo, productName: "테스트 제품" });

  assert.equal(result.productReady, true);
  assert.equal(result.lookupReady, true);
  assert.equal(result.reservationTypeReturn, true);
  assert.equal(result.externalWritesPerformed, false);
  assert.equal(saveClicked, false);
});

test("CJ adapter refocuses the invoice field after the return control rerenders", async () => {
  const outboundInvoiceNo = "587625375225";
  const snapshots = [
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: "", reservationTypeReturn: false, lookupReady: false, productReady: false, formReady: false, saveButtonCount: 1, completedReservationRowCount: 0, originalInvoiceFieldReset: true },
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: outboundInvoiceNo, reservationTypeReturn: true, lookupReady: true, productReady: false, formReady: false, saveButtonCount: 1, completedReservationRowCount: 0, originalInvoiceFieldReset: false },
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: outboundInvoiceNo, reservationTypeReturn: true, lookupReady: true, productReady: true, formReady: true, saveButtonCount: 1, completedReservationRowCount: 0, originalInvoiceFieldReset: false },
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: outboundInvoiceNo, reservationTypeReturn: true, lookupReady: true, productReady: true, formReady: true, saveButtonCount: 1, completedReservationRowCount: 0, originalInvoiceFieldReset: false },
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: outboundInvoiceNo, reservationTypeReturn: true, lookupReady: true, productReady: true, formReady: true, saveButtonCount: 1, completedReservationRowCount: 0, originalInvoiceFieldReset: false },
    { isReservationPage: true, readyState: "complete", originalInvoiceDigits: "", reservationTypeReturn: true, lookupReady: false, productReady: false, formReady: false, saveButtonCount: 1, completedReservationRowCount: 1, originalInvoiceFieldReset: true },
  ];
  let snapshotIndex = 0;
  let refocused = false;
  const adapter = createCjLoisReturnPickupBrowserAdapter({}, { pollMs: 1 }, {
    evaluateAcrossFrames: async () => [{ frame: { id: "frame" }, value: { isReservationPage: true } }],
    evaluateInFrame: async (_session, _frame, expression) => {
      if (expression === CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION) {
        const value = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
        snapshotIndex += 1;
        return value;
      }
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_INVOICE_SOURCE})`)) return { prepared: true, focused: false };
      if (expression.startsWith(`(${CJ_LOIS_PREPARE_FORM_SOURCE})`)) return { prepared: true };
      if (expression === CJ_LOIS_FOCUS_INVOICE_EXPRESSION) {
        refocused = true;
        return { focused: true };
      }
      if (expression === CJ_LOIS_CLICK_SAVE_EXPRESSION) return { clicked: true };
      throw new Error(`Unexpected expression: ${expression}`);
    },
    acceptSaveDialog: async (_session, trigger) => {
      await trigger();
      return { messageVerified: true };
    },
    sleep: async () => {},
  });
  const result = await adapter.reserveReturnPickup({ outboundInvoiceNo, productName: "테스트 제품" });
  assert.equal(refocused, true);
  assert.equal(result.completedReservationRowCount, 1);
});

test("CJ adapter rejects malformed original invoices before browser writes", async () => {
  const adapter = createCjLoisReturnPickupBrowserAdapter({});
  await assert.rejects(adapter.reserveReturnPickup({ outboundInvoiceNo: "123" }), {
    code: "CJ_ORIGINAL_INVOICE_INVALID",
  });
});

test("CJ rules preserve the demonstrated form and delayed readback contract", () => {
  assert.equal(CJ_LOIS_RETURN_PICKUP_RULES.pageId, "DCRVAP1003M");
  assert.equal(CJ_LOIS_RETURN_PICKUP_RULES.reservationType, "반품");
  assert.deepEqual(CJ_LOIS_RETURN_PICKUP_RULES.navigation, ["예약", "기업고객건별접수"]);
  assert.equal(CJ_LOIS_RETURN_PICKUP_RULES.returnInvoiceReadbackTiming, "NEXT_BUSINESS_DAY");
  assert.deepEqual(CJ_LOIS_RETURN_PICKUP_RULES.existingReservationEvidence, [
    "DUPLICATE_RESERVATION_DIALOG_VERIFIED",
  ]);
});
