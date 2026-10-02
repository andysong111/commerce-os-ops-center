import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptExpectedShoplingQnaTransmissionDialog,
  acceptExpectedShoplingInvoiceDeletionDialog,
  acceptExpectedShoplingInvoiceDeletionFlow,
  isShoplingInvoiceDeletionDialog,
  isShoplingQnaTransmissionDialog,
} from "../local-agent/src/shopling-browser-dialog.mjs";
import { CdpSession } from "../local-agent/src/chrome-cdp.mjs";

const expectedDialog = {
  type: "confirm",
  message: "송장번호를 삭제하시겠습니까? 삭제 후 복구는 불가능합니다. 삭제 후 [택배사 전송대기]로 상태가 변경됩니다.",
};

function fakeSession(dialog) {
  let listener;
  const calls = [];
  return {
    calls,
    on(method, nextListener) {
      assert.equal(method, "Page.javascriptDialogOpening");
      listener = nextListener;
      return () => { listener = null; };
    },
    async send(method, params) {
      calls.push({ method, params });
      return {};
    },
    open() {
      listener?.(dialog);
    },
  };
}

test("invoice deletion confirmation requires the exact Shopling meaning", () => {
  assert.equal(isShoplingInvoiceDeletionDialog(expectedDialog), true);
  assert.equal(isShoplingInvoiceDeletionDialog({ ...expectedDialog, type: "alert" }), false);
  assert.equal(isShoplingInvoiceDeletionDialog({ type: "confirm", message: "삭제하시겠습니까?" }), false);
});

test("QnA transmission accepts only the exact Shopling confirmation", async () => {
  const expected = {
    type: "confirm",
    message: "선택된 문의를 쇼핑몰로 전송하시겠습니까?",
  };
  assert.equal(isShoplingQnaTransmissionDialog(expected), true);
  assert.equal(isShoplingQnaTransmissionDialog({ ...expected, message: "선택한 주문을 전송할까요?" }), false);
  const session = fakeSession(expected);
  const result = await acceptExpectedShoplingQnaTransmissionDialog(session, async () => session.open());
  assert.equal(result.messageVerified, true);
  assert.deepEqual(session.calls.at(-1), {
    method: "Page.handleJavaScriptDialog",
    params: { accept: true },
  });
});

test("CDP sessions deliver JavaScript dialog events to subscribers", () => {
  const session = new CdpSession("ws://fixture");
  let received;
  const unsubscribe = session.on("Page.javascriptDialogOpening", (params) => {
    received = params;
  });
  session.handleMessage({
    data: JSON.stringify({ method: "Page.javascriptDialogOpening", params: expectedDialog }),
  });
  unsubscribe();
  assert.deepEqual(received, expectedDialog);
});

test("expected invoice deletion confirmation is accepted through CDP", async () => {
  const session = fakeSession(expectedDialog);
  const result = await acceptExpectedShoplingInvoiceDeletionDialog(session, async () => {
    session.open();
  });
  assert.deepEqual(result, { accepted: true, type: "confirm", messageVerified: true });
  assert.deepEqual(session.calls.at(-1), {
    method: "Page.handleJavaScriptDialog",
    params: { accept: true },
  });
});

test("unexpected confirmation is refused", async () => {
  const session = fakeSession({ type: "confirm", message: "다른 주문을 삭제하시겠습니까?" });
  await assert.rejects(
    acceptExpectedShoplingInvoiceDeletionDialog(session, async () => session.open()),
    { code: "SHOPLING_INVOICE_DELETION_DIALOG_UNEXPECTED" },
  );
  assert.deepEqual(session.calls.at(-1), {
    method: "Page.handleJavaScriptDialog",
    params: { accept: false },
  });
});

test("full deletion flow accepts the exact confirmation and dismisses the following alert", async () => {
  const session = fakeSession(expectedDialog);
  let listener;
  session.on = (_method, nextListener) => {
    listener = nextListener;
    return () => { listener = null; };
  };
  session.send = async (method, params) => {
    session.calls.push({ method, params });
    if (method === "Page.handleJavaScriptDialog" && params.accept === true && session.calls
      .filter((call) => call.method === "Page.handleJavaScriptDialog").length === 1) {
      queueMicrotask(() => listener?.({ type: "alert", message: "처리되었습니다." }));
    }
    return {};
  };

  const result = await acceptExpectedShoplingInvoiceDeletionFlow(session, async () => {
    listener?.(expectedDialog);
  }, { followupTimeoutMs: 50 });
  assert.equal(result.followupAlertDismissed, true);
  assert.equal(
    session.calls.filter((call) => call.method === "Page.handleJavaScriptDialog" && call.params.accept).length,
    2,
  );
});
