import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateAlibaba1688PreparationStatus,
  runAlibaba1688CartStaging,
} from "../local-agent/src/alibaba1688-cart-staging.mjs";

const draftId = "fast-purchase-draft:8c51000fd221316c2f54";
const sourceDraft = {
  draftId,
  status: "DRAFT",
  savedAt: null,
  lines: [{
    barcode: "BAC3-3",
    modelNo: "AAA229",
    modelName: "테스트",
    productName: "테스트",
    saleOption: "기본",
    chinaOption: "铜芯",
    supplierLink: "https://detail.1688.com/offer/660021847749.html",
    quantity: 18,
    unitPriceCny: 1,
    freightGroupId: "",
    domesticChinaFreightCny: 0,
    orderNumber: "",
    note: "",
  }],
};

function config() {
  return { dataDir: ".", opsOrigin: "https://commerce-os-ops-center.vercel.app" };
}

function successBrowser(overrides = {}) {
  return {
    inspectOffers: async () => [{ offerId: "660021847749", options: [{ name: "铜芯" }] }],
    readCart: async () => [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }],
    applyActions: async () => {},
    readCheckoutPreview: async () => ({
      lines: [{ offerId: "660021847749", optionName: "铜芯", quantity: 18, unitPriceCny: 1.75, groupId: "seller-a" }],
      sellerGroups: [{ groupId: "seller-a", domesticFreightCny: 6 }],
    }),
    submitCheckoutOrder: async () => ({
      href: "https://cashier.1688.com/payment?orderId=ORDER12345678",
      title: "选择支付方式",
      paymentSelectionConfirmed: true,
      orderRefs: ["ORDER12345678"],
      paymentExecuted: false,
    }),
    ...overrides,
  };
}

test("dry run inspects and plans without cart mutation or draft save", async () => {
  let mutated = 0;
  let saved = 0;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: false }, {
    client: { loadDraft: async () => sourceDraft, saveAndVerifyDraftLines: async () => { saved += 1; } },
    browser: successBrowser({
      readCart: async () => [],
      applyActions: async () => { mutated += 1; },
    }),
    writeAudit: async () => {},
  });
  assert.equal(result.audit.actionSummary.add, 1);
  assert.equal(mutated, 0);
  assert.equal(saved, 0);
});

test("execute writes actual price and freight, submits once, and stops at payment selection", async () => {
  let savedLines = null;
  let cartReads = 0;
  let submitCalls = 0;
  const browser = successBrowser({
    readCart: async () => {
      cartReads += 1;
      return cartReads === 1 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
    },
    submitCheckoutOrder: async (expected) => {
      submitCalls += 1;
      assert.equal(expected.productTotalCny, 31.5);
      assert.equal(expected.domesticFreightCny, 6);
      assert.equal(expected.totalCny, 37.5);
      assert.equal(expected.items.length, 1);
      assert.deepEqual(expected.shippingSelections, []);
      return {
        href: "https://cashier.1688.com/payment?orderId=ORDER12345678",
        title: "选择支付方式",
        paymentSelectionConfirmed: true,
        orderRefs: ["ORDER12345678"],
        paymentExecuted: false,
      };
    },
  });
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => {
        savedLines = lines;
        return { ...sourceDraft, savedAt: "2026-10-07T01:00:00.000Z", lines };
      },
    },
    browser,
    writeAudit: async () => {},
  });
  assert.equal(result.audit.status, "SUCCEEDED");
  assert.equal(savedLines[0].unitPriceCny, 1.75);
  assert.equal(savedLines[0].domesticChinaFreightCny, 6);
  assert.equal(submitCalls, 1);
  assert.equal(result.audit.externalOrderExecuted, true);
  assert.equal(result.audit.checkoutSubmitted, true);
  assert.equal(result.audit.paymentExecuted, false);
  assert.equal(result.audit.orderSubmission.paymentSelectionConfirmed, true);
  assert.deepEqual(result.audit.orderSubmission.orderRefs, ["ORDER12345678"]);
});

test("execute corrects a newly added cart line once when 1688 hydrates the default quantity", async () => {
  const appliedActions = [];
  let cartReads = 0;
  const browser = successBrowser({
    readCart: async () => {
      cartReads += 1;
      if (cartReads === 1) return [];
      if (cartReads === 2) return [{ offerId: "660021847749", optionName: "铜芯", quantity: 1 }];
      return [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
    },
    applyActions: async (actions) => { appliedActions.push(actions.map((action) => action.type)); },
  });

  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => ({
        ...sourceDraft,
        savedAt: "2026-10-07T01:00:00.000Z",
        lines,
      }),
    },
    browser,
    writeAudit: async () => {},
  });

  assert.deepEqual(appliedActions, [["ADD"], ["SET_QUANTITY"]]);
  assert.equal(result.audit.status, "SUCCEEDED");
  assert.equal(cartReads, 3);
});

test("execute waits for add-to-cart propagation without clicking ADD twice", async () => {
  const appliedActions = [];
  let cartReads = 0;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => ({ ...sourceDraft, lines }),
    },
    browser: successBrowser({
      readCart: async () => {
        cartReads += 1;
        return cartReads < 4 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
      },
      applyActions: async (actions) => { appliedActions.push(actions.map((action) => action.type)); },
    }),
    writeAudit: async () => {},
  });
  assert.deepEqual(appliedActions, [["ADD"]]);
  assert.equal(cartReads, 4);
  assert.equal(result.audit.status, "SUCCEEDED");
});

test("full execution skips draft rows that still lack a supplier link or Chinese option", async () => {
  const missingOptionLine = {
    ...sourceDraft.lines[0],
    barcode: "BAB2-1",
    chinaOption: "",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
  };
  const missingLinkLine = {
    ...sourceDraft.lines[0],
    barcode: "BAB5-1",
    chinaOption: "热带花纹",
    supplierLink: "",
  };
  const draft = { ...sourceDraft, lines: [missingOptionLine, missingLinkLine, ...sourceDraft.lines] };
  let inspectedItems = null;
  let savedLines = null;
  let cartReads = 0;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => draft,
      saveAndVerifyDraftLines: async (_draftId, lines) => {
        savedLines = lines;
        return { ...draft, savedAt: "2026-10-07T01:00:00.000Z", lines };
      },
    },
    browser: successBrowser({
      inspectOffers: async (items) => {
        inspectedItems = items;
        return [{ offerId: "660021847749", options: [{ name: "铜芯" }] }];
      },
      readCart: async () => {
        cartReads += 1;
        return cartReads === 1 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
      },
    }),
    writeAudit: async () => {},
  });
  assert.equal(inspectedItems.length, 1);
  assert.equal(savedLines.length, 3);
  assert.match(savedLines[0].note, /\[1688 준비 제외\] 중국 옵션 없음/);
  assert.match(savedLines[1].note, /\[1688 준비 제외\] 1688 링크 없음/);
  assert.equal(savedLines[2].unitPriceCny, 1.75);
  assert.deepEqual(result.audit.unreadyLines, [
    { barcode: "BAB2-1", reason: "CHINA_OPTION_MISSING" },
    { barcode: "BAB5-1", reason: "SUPPLIER_LINK_MISSING" },
  ]);
});

test("preparation status preserves operator notes, marks unavailable rows, and clears a resolved marker", () => {
  const lines = [
    { barcode: "BAB2-1", note: "사용자 메모" },
    { barcode: "BAB5-1", note: "[1688 준비 제외] 1688 링크 없음" },
    { barcode: "BBA1-1", note: "" },
  ];
  const annotated = annotateAlibaba1688PreparationStatus(lines, {
    unreadyLines: [{ barcode: "BAB2-1", reason: "CHINA_OPTION_MISSING" }],
    unavailableOffers: [{ reason: "OFFER_OFFLINE", barcodes: ["BBA1-1"] }],
    processedBarcodes: ["BAB5-1"],
  });
  assert.equal(annotated[0].note, "사용자 메모 · [1688 준비 제외] 중국 옵션 없음");
  assert.equal(annotated[1].note, "");
  assert.equal(annotated[2].note, "[1688 준비 제외] 1688 상품 판매중단");
});

test("a partial browser failure never writes the Ops Center draft", async () => {
  let saved = 0;
  const browser = successBrowser({
    readCart: async () => [],
    applyActions: async () => { throw Object.assign(new Error("DOM changed"), { code: "ALIBABA1688_ADD_FAILED" }); },
  });
  await assert.rejects(() => runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: { loadDraft: async () => sourceDraft, saveAndVerifyDraftLines: async () => { saved += 1; } },
    browser,
    writeAudit: async () => {},
  }), { code: "ALIBABA1688_ADD_FAILED" });
  assert.equal(saved, 0);
});

test("one-item canary scopes browser work and preserves non-canary draft lines", async () => {
  const incompleteLine = {
    ...sourceDraft.lines[0],
    barcode: "BAC1-1",
    modelNo: "AAA318",
    chinaOption: "",
    supplierLink: "",
    quantity: 38,
  };
  const secondLine = {
    ...sourceDraft.lines[0],
    barcode: "BAD5-2",
    modelNo: "AAA230",
    chinaOption: "L",
    supplierLink: "https://detail.1688.com/offer/738461076321.html",
    quantity: 15,
    unitPriceCny: 2.1,
  };
  const threeLineDraft = { ...sourceDraft, lines: [incompleteLine, ...sourceDraft.lines, secondLine] };
  let inspectedItems = null;
  let savedLines = null;
  let cartReads = 0;
  await runAlibaba1688CartStaging(config(), { draftId, execute: true, maxItems: 1 }, {
    client: {
      loadDraft: async () => threeLineDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => {
        savedLines = lines;
        return { ...threeLineDraft, savedAt: "2026-10-07T01:00:00.000Z", lines };
      },
    },
    browser: successBrowser({
      inspectOffers: async (items) => {
        inspectedItems = items;
        return [{ offerId: "660021847749", options: [{ name: "铜芯" }] }];
      },
      readCart: async () => {
        cartReads += 1;
        return cartReads === 1 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
      },
    }),
    writeAudit: async () => {},
  });
  assert.equal(inspectedItems.length, 1);
  assert.equal(inspectedItems[0].offerId, "660021847749");
  assert.equal(savedLines.length, 3);
  assert.match(savedLines[0].note, /\[1688 준비 제외\] 1688 링크 없음/);
  assert.equal(savedLines[1].unitPriceCny, 1.75);
  assert.equal(savedLines[2], secondLine);
});

test("one-item canary skips an offline offer and validates the next ready item", async () => {
  const offlineLine = {
    ...sourceDraft.lines[0],
    barcode: "BBA1-1",
    supplierLink: "https://detail.1688.com/offer/732903613263.html",
  };
  const draft = { ...sourceDraft, lines: [offlineLine, ...sourceDraft.lines] };
  const inspectedOfferIds = [];
  let savedLines = null;
  let cartReads = 0;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true, maxItems: 1 }, {
    client: {
      loadDraft: async () => draft,
      saveAndVerifyDraftLines: async (_draftId, lines) => {
        savedLines = lines;
        return { ...draft, savedAt: "2026-10-07T01:00:00.000Z", lines };
      },
    },
    browser: successBrowser({
      inspectOffers: async (items) => {
        inspectedOfferIds.push(items[0].offerId);
        return items[0].offerId === "732903613263"
          ? [{ offerId: "732903613263", blockedReason: "OFFER_OFFLINE", options: [] }]
          : [{ offerId: "660021847749", options: [{ name: "铜芯" }] }];
      },
      readCart: async () => {
        cartReads += 1;
        return cartReads === 1 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
      },
    }),
    writeAudit: async () => {},
  });
  assert.deepEqual(inspectedOfferIds, ["732903613263", "660021847749"]);
  assert.match(savedLines[0].note, /\[1688 준비 제외\] 1688 상품 판매중단/);
  assert.equal(savedLines[1].unitPriceCny, 1.75);
  assert.equal(result.audit.unavailableOffers[0].offerId, "732903613263");
  assert.deepEqual(result.audit.unavailableOffers[0].barcodes, ["BBA1-1"]);
});

test("one-item canary does not silently skip a generic missing add control", async () => {
  let inspected = 0;
  await assert.rejects(() => runAlibaba1688CartStaging(config(), { draftId, execute: true, maxItems: 1 }, {
    client: { loadDraft: async () => sourceDraft, saveAndVerifyDraftLines: async () => assert.fail("draft must not be saved") },
    browser: successBrowser({
      inspectOffers: async () => {
        inspected += 1;
        return [{ offerId: "660021847749", blockedReason: "ADD_CONTROL_NOT_FOUND", options: [] }];
      },
    }),
    writeAudit: async () => {},
  }), { code: "ALIBABA1688_OFFER_BLOCKED" });
  assert.equal(inspected, 1);
});

test("an uncertain result after clicking submit is never retried and remains payment-safe", async () => {
  let saved = 0;
  let submitCalls = 0;
  let lastAudit = null;
  let capturedError = null;
  await assert.rejects(() => runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => {
        saved += 1;
        return { ...sourceDraft, savedAt: "2026-10-07T01:00:00.000Z", lines };
      },
    },
    browser: successBrowser({
      submitCheckoutOrder: async () => {
        submitCalls += 1;
        throw Object.assign(new Error("결과 불명"), {
          code: "ALIBABA1688_ORDER_SUBMIT_OUTCOME_UNKNOWN",
          details: { submissionAttempted: true },
        });
      },
    }),
    writeAudit: async (audit) => { lastAudit = structuredClone(audit); },
  }), (error) => {
    capturedError = error;
    return error?.code === "ALIBABA1688_ORDER_SUBMIT_OUTCOME_UNKNOWN";
  });
  assert.equal(capturedError.code, "ALIBABA1688_ORDER_SUBMIT_OUTCOME_UNKNOWN");
  assert.equal(saved, 1);
  assert.equal(submitCalls, 1);
  assert.equal(lastAudit.status, "NEEDS_ATTENTION");
  assert.equal(lastAudit.submissionAttempted, true);
  assert.equal(lastAudit.externalOrderExecuted, false);
  assert.equal(lastAudit.paymentExecuted, false);
});

test("a successful canary submission is excluded from the next canary run", async () => {
  const secondLine = {
    ...sourceDraft.lines[0],
    barcode: "BAD5-2",
    chinaOption: "L",
    supplierLink: "https://detail.1688.com/offer/738461076321.html",
    quantity: 15,
  };
  const twoLineDraft = { ...sourceDraft, lines: [...sourceDraft.lines, secondLine] };
  const previousAudit = {
    externalOrderExecuted: true,
    orderSubmissions: [{
      paymentSelectionConfirmed: true,
      submittedBarcodes: ["BAC3-3"],
    }],
  };
  let inspectedItems = null;
  let submittedBarcodes = null;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: true, maxItems: 1 }, {
    readAudit: async () => previousAudit,
    client: {
      loadDraft: async () => twoLineDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => ({ ...twoLineDraft, lines }),
    },
    browser: successBrowser({
      inspectOffers: async (items) => {
        inspectedItems = items;
        return [{ offerId: "738461076321", options: [{ name: "L" }] }];
      },
      readCart: async () => [{ offerId: "738461076321", optionName: "L", quantity: 15 }],
      readCheckoutPreview: async () => ({
        lines: [{ offerId: "738461076321", optionName: "L", quantity: 15, unitPriceCny: 2.45, groupId: "seller-b" }],
        sellerGroups: [{ groupId: "seller-b", domesticFreightCny: 4 }],
      }),
      submitCheckoutOrder: async () => ({
        href: "https://cashier.1688.com/payment",
        title: "选择支付方式",
        paymentSelectionConfirmed: true,
        orderRefs: ["ORDER87654321"],
      }),
    }),
    writeAudit: async () => {},
  });
  submittedBarcodes = result.audit.orderSubmission.submittedBarcodes;
  assert.equal(inspectedItems.length, 1);
  assert.equal(inspectedItems[0].offerId, "738461076321");
  assert.deepEqual(submittedBarcodes, ["BAD5-2"]);
  assert.equal(result.audit.orderSubmissions.length, 2);
});
