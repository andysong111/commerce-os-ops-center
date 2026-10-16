import { join } from "node:path";
import {
  build1688CartPlan,
  buildDraftLinesFrom1688Checkout,
  normalize1688OptionName,
  parse1688OfferLink,
  plan1688CartReconciliation,
} from "./alibaba1688-cart-plan.mjs";
import { createAlibaba1688CartBrowserAdapter } from "./alibaba1688-cart-browser-adapter.mjs";
import { createOpsCenterDraftClient } from "./ops-center-draft-client.mjs";
import { ensureDataDirs, readJsonFile, writeJsonAtomic } from "./files.mjs";

function serializeError(error) {
  return {
    code: error?.code || "ALIBABA1688_CART_STAGING_FAILED",
    message: error instanceof Error ? error.message : "1688 장바구니 준비가 실패했습니다.",
    details: error?.details || null,
  };
}

function auditPath(config, draftId) {
  const safeDraftId = String(draftId).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 100);
  return join(config.dataDir, `1688-cart-staging-${safeDraftId}.json`);
}

function normalizedMaxItems(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    const error = new Error("1688 장바구니 처리 품목 상한이 올바르지 않습니다.");
    error.code = "ALIBABA1688_MAX_ITEMS_INVALID";
    throw error;
  }
  return parsed;
}

const PREPARATION_NOTE_PREFIX = "[1688 준비 제외]";

function withoutPreparationNote(value) {
  return String(value || "")
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(PREPARATION_NOTE_PREFIX))
    .join(" · ");
}

function preparationReasonLabel(reason) {
  if (reason === "SUPPLIER_LINK_MISSING") return "1688 링크 없음";
  if (reason === "CHINA_OPTION_MISSING") return "중국 옵션 없음";
  if (reason === "OFFER_OFFLINE") return "1688 상품 판매중단";
  return "장바구니 준비 불가";
}

export function annotateAlibaba1688PreparationStatus(lines, { unreadyLines = [], unavailableOffers = [], processedBarcodes = [] } = {}) {
  const reasonByBarcode = new Map(unreadyLines.map((line) => [String(line?.barcode || "").trim(), line?.reason]));
  for (const offer of unavailableOffers) {
    for (const barcode of offer?.barcodes || []) reasonByBarcode.set(String(barcode || "").trim(), offer?.reason || "OFFER_OFFLINE");
  }
  const processed = new Set(processedBarcodes.map((barcode) => String(barcode || "").trim()));
  return lines.map((line) => {
    const barcode = String(line?.barcode || "").trim();
    const reason = reasonByBarcode.get(barcode);
    if (!reason && !processed.has(barcode)) return line;
    const baseNote = withoutPreparationNote(line?.note);
    const preparationNote = reason ? `${PREPARATION_NOTE_PREFIX} ${preparationReasonLabel(reason)}` : "";
    return {
      ...line,
      note: [baseNote, preparationNote].filter(Boolean).join(" · ").slice(0, 300),
    };
  });
}

function scopeDraftToItems(draft, maxItems, excludedOfferIds = new Set(), excludedBarcodes = new Set()) {
  const eligibleLines = draft.lines.filter((line) => {
    const offer = parse1688OfferLink(line?.supplierLink);
    const optionName = String(line?.chinaOption || "").normalize("NFKC").trim();
    const optionReady = Boolean(optionName)
      || line?.purchaseOptionSelection === "ANY_AVAILABLE"
      || (Array.isArray(line?.purchaseComponents) && line.purchaseComponents.length > 0);
    const barcode = String(line?.barcode || "").trim();
    return Boolean(offer)
      && optionReady
      && !excludedOfferIds.has(offer.offerId)
      && !excludedBarcodes.has(barcode);
  });
  if (eligibleLines.length === 0) return { ...draft, lines: [] };
  if (!maxItems) return { ...draft, lines: eligibleLines };
  const candidates = eligibleLines.map((line) => {
    const offer = parse1688OfferLink(line?.supplierLink);
    const optionName = String(line?.chinaOption || "").normalize("NFKC").trim();
    const quantity = Number(line?.quantity);
    if (!offer || !optionName || !Number.isInteger(quantity) || quantity < 1 || quantity > 9_999) return null;
    return {
      key: `${offer.offerId}\u0000${normalize1688OptionName(optionName)}`,
      exactOption: normalize1688OptionName(optionName) !== normalize1688OptionName("단품"),
    };
  });
  const orderedKeys = [];
  for (const exactOption of [true, false]) {
    for (const candidate of candidates) {
      if (!candidate || candidate.exactOption !== exactOption || orderedKeys.includes(candidate.key)) continue;
      orderedKeys.push(candidate.key);
      if (orderedKeys.length >= maxItems) break;
    }
    if (orderedKeys.length >= maxItems) break;
  }
  if (orderedKeys.length === 0) {
    const error = new Error("CANARY로 확인할 준비 완료 1688 품목이 없습니다.");
    error.code = "ALIBABA1688_CANARY_ITEM_NOT_READY";
    throw error;
  }
  const selectedKeys = new Set(orderedKeys);
  return {
    ...draft,
    lines: eligibleLines.filter((line) => {
      const offer = parse1688OfferLink(line?.supplierLink);
      if (!offer) return false;
      return selectedKeys.has(`${offer.offerId}\u0000${normalize1688OptionName(line?.chinaOption)}`);
    }),
  };
}

export async function runAlibaba1688CartStaging(config, options = {}, dependencies = {}) {
  const draftId = String(options.draftId || "").trim();
  const execute = options.execute === true;
  const maxItems = normalizedMaxItems(options.maxItems);
  const now = dependencies.now || (() => new Date());
  const logger = dependencies.logger || (() => {});
  const client = dependencies.client || createOpsCenterDraftClient(config, dependencies);
  const browser = dependencies.browser || createAlibaba1688CartBrowserAdapter(config, dependencies);
  const readAudit = dependencies.readAudit || (() => readJsonFile(auditPath(config, draftId), null));
  const writeAudit = dependencies.writeAudit || (async (value) => {
    await ensureDataDirs(config);
    await writeJsonAtomic(auditPath(config, draftId), value);
  });
  const previousAudit = await readAudit();
  const previousOrderSubmissions = Array.isArray(previousAudit?.orderSubmissions)
    ? previousAudit.orderSubmissions.filter((submission) => submission?.paymentSelectionConfirmed === true)
    : [];
  if (previousAudit?.externalOrderExecuted === true && previousOrderSubmissions.length === 0) {
    const error = new Error("이 초안에는 이전 주문 제출 기록이 있지만 제출 상품을 확인할 수 없습니다. 미결제 주문을 확인한 뒤 새 초안에서 다시 실행하세요.");
    error.code = "ALIBABA1688_PREVIOUS_ORDER_SUBMISSION_UNRESOLVED";
    throw error;
  }
  const alreadySubmittedBarcodes = new Set(previousOrderSubmissions.flatMap((submission) => (
    Array.isArray(submission?.submittedBarcodes) ? submission.submittedBarcodes : []
  )).map((barcode) => String(barcode || "").trim()).filter(Boolean));
  const audit = {
    schemaVersion: 2,
    draftId,
    execute,
    maxItems,
    startedAt: now().toISOString(),
    finishedAt: null,
    status: "RUNNING",
    stage: "LOAD_DRAFT",
    externalOrderExecuted: false,
    checkoutSubmitted: false,
    paymentExecuted: false,
    submissionAttempted: false,
    orderSubmission: null,
    orderSubmissions: previousOrderSubmissions,
    actionSummary: null,
    checkoutSummary: null,
    error: null,
  };

  const checkpoint = async (stage, patch = {}) => {
    Object.assign(audit, patch, { stage });
    await writeAudit(audit);
    logger({ stage, ...patch });
  };

  try {
    await checkpoint("LOAD_DRAFT");
    const draft = await client.loadDraft(draftId);
    const unreadyLines = draft.lines.flatMap((line) => {
      const offer = parse1688OfferLink(line?.supplierLink);
      const optionName = String(line?.chinaOption || "").normalize("NFKC").trim();
      const optionReady = Boolean(optionName)
        || line?.purchaseOptionSelection === "ANY_AVAILABLE"
        || (Array.isArray(line?.purchaseComponents) && line.purchaseComponents.length > 0);
      const reason = !offer ? "SUPPLIER_LINK_MISSING" : !optionReady ? "CHINA_OPTION_MISSING" : "";
      return reason ? [{
        barcode: String(line?.barcode || "").trim(),
        reason,
      }] : [];
    });
    audit.unreadyLines = unreadyLines;
    const unavailableOffers = [];
    const excludedOfferIds = new Set();
    let scopedDraft;
    let uncheckedPlan;
    let inspections;
    let plan;
    while (!plan) {
      scopedDraft = scopeDraftToItems(draft, maxItems, excludedOfferIds, alreadySubmittedBarcodes);
      if (scopedDraft.lines.length === 0 && previousOrderSubmissions.length > 0) {
        await checkpoint("COMPLETE", {
          status: "SUCCEEDED",
          finishedAt: now().toISOString(),
          externalOrderExecuted: true,
          checkoutSubmitted: true,
          paymentExecuted: false,
          alreadySubmitted: true,
        });
        return { ok: true, execute, draftId, audit };
      }
      uncheckedPlan = build1688CartPlan(scopedDraft);

      await checkpoint("PREFLIGHT_OFFERS", {
        draftLineCount: draft.lines.length,
        lineCount: uncheckedPlan.lineCount,
        cartItemCount: uncheckedPlan.items.length,
        totalQuantity: uncheckedPlan.totalQuantity,
        canary: maxItems === 1,
        unreadyLines,
        unavailableOffers,
      });
      inspections = await browser.inspectOffers(uncheckedPlan.items);
      const newlyUnavailable = inspections.filter((inspection) => (
        inspection?.blockedReason === "OFFER_OFFLINE"
      ));
      for (const inspection of newlyUnavailable) {
        if (!inspection?.offerId || excludedOfferIds.has(inspection.offerId)) continue;
        excludedOfferIds.add(inspection.offerId);
        unavailableOffers.push({
          offerId: inspection.offerId,
          reason: inspection.blockedReason,
          barcodes: draft.lines
            .filter((line) => parse1688OfferLink(line?.supplierLink)?.offerId === inspection.offerId)
            .map((line) => String(line?.barcode || "").trim())
            .filter(Boolean),
        });
      }
      if (newlyUnavailable.length > 0) {
        if (maxItems) continue;
        scopedDraft = scopeDraftToItems(draft, maxItems, excludedOfferIds, alreadySubmittedBarcodes);
        if (scopedDraft.lines.length === 0) {
          const error = new Error("주문 가능한 1688 상품이 없습니다.");
          error.code = "ALIBABA1688_NO_PURCHASABLE_OFFERS";
          error.details = { unavailableOffers };
          throw error;
        }
      }
      plan = build1688CartPlan(scopedDraft, inspections);
    }

    await checkpoint("READ_CART");
    const cartBefore = await browser.readCart(plan.items);
    const actions = plan1688CartReconciliation(plan, cartBefore);
    const actionSummary = {
      add: actions.filter((action) => action.type === "ADD").length,
      setQuantity: actions.filter((action) => action.type === "SET_QUANTITY").length,
      keep: actions.filter((action) => action.type === "KEEP").length,
    };

    if (!execute) {
      await checkpoint("DRY_RUN_COMPLETE", {
        status: "SUCCEEDED",
        finishedAt: now().toISOString(),
        actionSummary,
      });
      return { ok: true, execute: false, draftId, plan, actions, audit };
    }

    await checkpoint("RECONCILE_CART", { actionSummary });
    await browser.applyActions(actions);

    await checkpoint("VERIFY_CART");
    let cartAfter = await browser.readCart(plan.items);
    let verification = plan1688CartReconciliation(plan, cartAfter);
    let unresolved = verification.filter((action) => action.type !== "KEEP");
    // 1688 can acknowledge an add-to-cart click before the shared cart has
    // propagated the new line. Poll the cart only; never click ADD a second
    // time because that can duplicate an order candidate.
    if (unresolved.some((action) => action.type === "ADD")) {
      await checkpoint("VERIFY_CART_SYNC_WAIT", {
        pendingAddCount: unresolved.filter((action) => action.type === "ADD").length,
      });
      for (let attempt = 0; attempt < 6 && unresolved.some((action) => action.type === "ADD"); attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 750));
        cartAfter = await browser.readCart(plan.items);
        verification = plan1688CartReconciliation(plan, cartAfter);
        unresolved = verification.filter((action) => action.type !== "KEEP");
      }
    }
    // Some 1688 offer pages accept the requested quantity while adding the
    // item, but the cart briefly hydrates with the seller's default quantity.
    // Correct that once in the cart and verify again before failing the run.
    if (unresolved.length > 0 && unresolved.every((action) => action.type === "SET_QUANTITY")) {
      await checkpoint("RECONCILE_CART_QUANTITY_RETRY", {
        retryCount: unresolved.length,
      });
      await browser.applyActions(unresolved);
      cartAfter = await browser.readCart(plan.items);
      verification = plan1688CartReconciliation(plan, cartAfter);
      unresolved = verification.filter((action) => action.type !== "KEEP");
    }
    if (unresolved.length > 0) {
      const error = new Error("1688 장바구니 수량이 권장수량과 일치하지 않습니다.");
      error.code = "ALIBABA1688_CART_RECONCILIATION_INCOMPLETE";
      error.details = { unresolved: unresolved.map((action) => ({ type: action.type, key: action.item.key })) };
      throw error;
    }

    await checkpoint("READ_CHECKOUT_PREVIEW");
    const checkout = await browser.readCheckoutPreview(plan.items);
    const checkoutLines = buildDraftLinesFrom1688Checkout(draft, plan, checkout);
    const updatedLines = annotateAlibaba1688PreparationStatus(checkoutLines, {
      unreadyLines,
      unavailableOffers,
      processedBarcodes: plan.lines.map((line) => line.barcode),
    });
    const checkoutSummary = {
      lineCount: checkout.lines.length,
      sellerGroupCount: checkout.sellerGroups.length,
      productTotalCny: checkout.lines.reduce((sum, line) => sum + Number(line.unitPriceCny || 0) * Number(line.quantity || 0), 0),
      domesticFreightCny: checkout.sellerGroups.reduce((sum, group) => sum + Number(group.domesticFreightCny || 0), 0),
      shippingSelections: checkout.shippingSelections || [],
    };

    await checkpoint("SAVE_DRAFT", { checkoutSummary });
    const verifiedDraft = await client.saveAndVerifyDraftLines(draftId, updatedLines);
    const totalCny = checkoutSummary.productTotalCny + checkoutSummary.domesticFreightCny;
    await checkpoint("SUBMIT_ORDER_READY", {
      savedAt: verifiedDraft.savedAt || null,
      submissionAttempted: false,
    });
    const submission = await browser.submitCheckoutOrder({
      productTotalCny: checkoutSummary.productTotalCny,
      domesticFreightCny: checkoutSummary.domesticFreightCny,
      totalCny,
      items: plan.items,
      shippingSelections: checkoutSummary.shippingSelections,
    });
    const orderSubmission = {
      submittedAt: now().toISOString(),
      submittedBarcodes: plan.lines.map((line) => String(line?.barcode || "").trim()).filter(Boolean),
      submittedLines: plan.lines.map((line) => ({
        barcode: String(line?.barcode || "").trim(),
        quantity: Number(line?.quantity || 0),
      })),
      orderRefs: Array.isArray(submission?.orderRefs) ? submission.orderRefs : [],
      paymentUrl: String(submission?.href || ""),
      paymentTitle: String(submission?.title || ""),
      paymentSelectionConfirmed: submission?.paymentSelectionConfirmed === true,
      productTotalCny: checkoutSummary.productTotalCny,
      domesticFreightCny: checkoutSummary.domesticFreightCny,
      totalCny,
      shippingSelections: checkoutSummary.shippingSelections,
      paymentExecuted: false,
    };
    const orderSubmissions = [...previousOrderSubmissions, orderSubmission];
    await checkpoint("PAYMENT_SELECTION_READY", {
      submissionAttempted: true,
      externalOrderExecuted: true,
      checkoutSubmitted: true,
      paymentExecuted: false,
      orderSubmission,
      orderSubmissions,
    });
    await checkpoint("COMPLETE", {
      status: "SUCCEEDED",
      finishedAt: now().toISOString(),
      submissionAttempted: true,
      externalOrderExecuted: true,
      checkoutSubmitted: true,
      paymentExecuted: false,
      orderSubmission,
      orderSubmissions,
      checkoutSummary,
      unavailableOffers,
      unreadyLines,
      savedAt: verifiedDraft.savedAt || null,
    });
    return { ok: true, execute: true, draftId, verifiedDraft, audit };
  } catch (error) {
    const serialized = serializeError(error);
    const submissionAttempted = error?.details?.submissionAttempted === true || audit.submissionAttempted === true;
    await checkpoint("FAILED", {
      status: "NEEDS_ATTENTION",
      finishedAt: now().toISOString(),
      submissionAttempted,
      paymentExecuted: false,
      error: serialized,
    }).catch(() => null);
    throw Object.assign(error instanceof Error ? error : new Error(serialized.message), {
      code: serialized.code,
      details: serialized.details,
      audit,
    });
  }
}
