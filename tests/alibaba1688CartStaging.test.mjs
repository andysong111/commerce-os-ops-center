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

test("5-1 writes actual price and freight without submitting an order or payment", async () => {
  let savedLines = null;
  let cartReads = 0;
  const browser = successBrowser({
    readCart: async () => {
      cartReads += 1;
      return cartReads === 1 ? [] : [{ offerId: "660021847749", optionName: "铜芯", quantity: 18 }];
    },
  });
  const result = await runAlibaba1688CartStaging(config(), { draftId, mode: "cost-capture", execute: true }, {
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
  assert.equal(result.audit.stage, "COST_CAPTURE_COMPLETE");
  assert.equal(savedLines[0].unitPriceCny, 1.75);
  assert.equal(savedLines[0].domesticChinaFreightCny, 6);
  assert.equal(result.audit.submissionAttempted, false);
  assert.equal(result.audit.externalOrderExecuted, false);
  assert.equal(result.audit.checkoutSubmitted, false);
  assert.equal(result.audit.paymentExecuted, false);
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

test("unconfirmed cart add fails before checkout with retry-safe diagnostics", async () => {
  let capturedError = null;
  await assert.rejects(() => runAlibaba1688CartStaging(config(), { draftId, execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async () => assert.fail("draft must not be saved"),
    },
    browser: successBrowser({
      readCart: async () => [],
      getLastCartDiagnostics: () => ({
        href: "https://cart.1688.com/cart.htm",
        cartRowCount: 1,
        candidateRows: [{ offerId: "660021847749", rowText: "规格：铜芯", quantity: 1 }],
      }),
    }),
    writeAudit: async () => {},
  }), (error) => {
    capturedError = error;
    return error?.code === "ALIBABA1688_CART_RECONCILIATION_INCOMPLETE";
  });
  assert.match(capturedError.message, /주문 제출 전에 중단/);
  assert.equal(capturedError.details.retrySafe, true);
  assert.equal(capturedError.details.unresolved[0].expectedQuantity, 18);
  assert.equal(capturedError.details.cartDiagnostics.cartRowCount, 1);
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

test("successful offer inspections survive a security handoff and resume from the next offer", async () => {
  const secondLine = {
    ...sourceDraft.lines[0],
    barcode: "BAD5-2",
    chinaOption: "L",
    supplierLink: "https://detail.1688.com/offer/738461076321.html",
    quantity: 15,
  };
  const draft = { ...sourceDraft, lines: [...sourceDraft.lines, secondLine] };
  let savedAudit = null;
  await assert.rejects(() => runAlibaba1688CartStaging(config(), { draftId, execute: false }, {
    client: { loadDraft: async () => draft },
    browser: successBrowser({
      inspectOffers: async () => [{
        offerId: "660021847749",
        options: [{ name: "铜芯" }],
      }, {
        offerId: "738461076321",
        blockedReason: "SECURITY_CHALLENGE",
      }],
    }),
    writeAudit: async (value) => { savedAudit = structuredClone(value); },
  }), { code: "ALIBABA1688_SECURITY_CHALLENGE" });
  assert.deepEqual(savedAudit.inspectionCache.map((item) => item.offerId), ["660021847749"]);

  let resumedOffers = [];
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: false }, {
    client: { loadDraft: async () => draft },
    readAudit: async () => savedAudit,
    browser: successBrowser({
      inspectOffers: async (items) => {
        resumedOffers = items.map((item) => item.offerId);
        return [{ offerId: "738461076321", options: [{ name: "L" }] }];
      },
      readCart: async () => [],
    }),
    writeAudit: async () => {},
  });
  assert.deepEqual(resumedOffers, ["738461076321"]);
  assert.equal(result.audit.inspectionCache.length, 2);
  assert.equal(result.audit.actionSummary.add, 2);
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

test("a manually confirmed offline offer stays excluded on the next run", async () => {
  const confirmedOfflineLine = {
    ...sourceDraft.lines[0],
    barcode: "BCC2-2",
    supplierLink: "https://detail.1688.com/offer/720537637155.html",
    note: "[1688 준비 제외] 1688 상품 판매중단 (1688 720537637155)",
  };
  const draft = { ...sourceDraft, lines: [confirmedOfflineLine, ...sourceDraft.lines] };
  let inspectedItems = null;
  const result = await runAlibaba1688CartStaging(config(), { draftId, execute: false, maxItems: 1 }, {
    client: { loadDraft: async () => draft },
    browser: successBrowser({
      inspectOffers: async (items) => {
        inspectedItems = items;
        return [{ offerId: "660021847749", options: [{ name: "铜芯" }] }];
      },
      readCart: async () => [],
    }),
    writeAudit: async () => {},
  });
  assert.equal(result.audit.status, "SUCCEEDED");
  assert.deepEqual(inspectedItems.map((item) => item.offerId), ["660021847749"]);
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

test("5-2 verifies the final cart and still never submits an order or payment", async () => {
  const result = await runAlibaba1688CartStaging(config(), { draftId, mode: "cart-staging", execute: true }, {
    client: {
      loadDraft: async () => sourceDraft,
      saveAndVerifyDraftLines: async (_draftId, lines) => ({ ...sourceDraft, lines }),
    },
    browser: successBrowser(),
    writeAudit: async () => {},
  });
  assert.equal(result.audit.stage, "CART_STAGING_COMPLETE");
  assert.equal(result.audit.submissionAttempted, false);
  assert.equal(result.audit.externalOrderExecuted, false);
  assert.equal(result.audit.checkoutSubmitted, false);
  assert.equal(result.audit.paymentExecuted, false);
});
