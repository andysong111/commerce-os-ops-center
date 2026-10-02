const TRACKING_DIGITS = 12;

function cleanText(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set(values)];
}

export function normalizeTrackingNumber(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  return digits.length === TRACKING_DIGITS ? digits : "";
}

export function normalizeBCode(value) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

export function extractTrackingCandidates(observation) {
  const explicit = [
    ...(Array.isArray(observation?.trackingCandidates) ? observation.trackingCandidates : []),
    ...(Array.isArray(observation?.barcodes) ? observation.barcodes : []),
  ].map(normalizeTrackingNumber).filter(Boolean);

  const text = cleanText(observation?.recognizedText);
  const fromText = [];
  const matcher = /(?<!\d)(?:\d[\s-]*){12}(?!\d)/g;
  for (const match of text.matchAll(matcher)) {
    const normalized = normalizeTrackingNumber(match[0]);
    if (normalized) fromText.push(normalized);
  }
  return unique([...explicit, ...fromText]);
}

export function buildShipmentManifest(rows) {
  if (!Array.isArray(rows)) {
    const error = new Error("Shipment manifest rows must be an array.");
    error.code = "SHIPMENT_MANIFEST_INVALID";
    throw error;
  }

  const packages = new Map();
  const rejectedRows = [];
  rows.forEach((row, index) => {
    const invoiceNo = normalizeTrackingNumber(row?.invoiceNo ?? row?.trackingNumber);
    const shoplingOrderNo = cleanText(row?.shoplingOrderNo ?? row?.orderNo);
    const bCode = normalizeBCode(row?.bCode);
    const quantity = Number(row?.quantity ?? 1);
    if (!invoiceNo || !shoplingOrderNo || !Number.isFinite(quantity) || quantity <= 0) {
      rejectedRows.push({ index, reason: "REQUIRED_IDENTITY_MISSING" });
      return;
    }
    const order = {
      shoplingOrderNo,
      bCode,
      quantity,
      productName: cleanText(row?.productName),
      optionName: cleanText(row?.optionName),
    };
    const current = packages.get(invoiceNo) || {
      invoiceNo,
      orders: [],
      bCodes: [],
      totalQuantity: 0,
    };
    current.orders.push(order);
    current.bCodes = unique([...current.bCodes, bCode].filter(Boolean));
    current.totalQuantity += quantity;
    packages.set(invoiceNo, current);
  });

  return {
    packages,
    packageCount: packages.size,
    orderCount: [...packages.values()].reduce((sum, item) => sum + item.orders.length, 0),
    rejectedRows,
  };
}

function observationId(observation, index) {
  return cleanText(observation?.imageId ?? observation?.fileName) || `image-${index + 1}`;
}

function stockoutPlanForImage(imageResult, observation) {
  if (cleanText(observation?.reason).toUpperCase() !== "STOCKOUT") {
    return { candidates: [], blocked: [] };
  }

  const available = unique(imageResult.matchedPackages.flatMap((item) => item.bCodes));
  const requested = unique((Array.isArray(observation?.stockoutBCodes) ? observation.stockoutBCodes : [])
    .map(normalizeBCode)
    .filter(Boolean));

  if (available.length === 0) {
    return {
      candidates: [],
      blocked: [{
        imageId: imageResult.imageId,
        code: "STOCKOUT_BCODE_UNRESOLVED",
        availableBCodes: [],
      }],
    };
  }

  if (requested.length) {
    const missing = requested.filter((bCode) => !available.includes(bCode));
    if (missing.length) {
      return {
        candidates: [],
        blocked: [{
          imageId: imageResult.imageId,
          code: "STOCKOUT_BCODE_NOT_IN_MATCHED_PACKAGE",
          requestedBCodes: requested,
          availableBCodes: available,
        }],
      };
    }
    return {
      candidates: requested.map((bCode) => ({
        actionKey: `stockout-bcode:${bCode}`,
        bCode,
        sourceImageIds: [imageResult.imageId],
      })),
      blocked: [],
    };
  }

  if (available.length === 1) {
    return {
      candidates: [{
        actionKey: `stockout-bcode:${available[0]}`,
        bCode: available[0],
        sourceImageIds: [imageResult.imageId],
      }],
      blocked: [],
    };
  }

  return {
    candidates: [],
    blocked: [{
      imageId: imageResult.imageId,
      code: "STOCKOUT_BCODE_REQUIRED",
      availableBCodes: available,
    }],
  };
}

function mergeActions(actions, key) {
  const merged = new Map();
  for (const action of actions) {
    const identity = action[key];
    const current = merged.get(identity);
    if (!current) {
      merged.set(identity, { ...action, sourceImageIds: unique(action.sourceImageIds || []) });
      continue;
    }
    current.sourceImageIds = unique([...current.sourceImageIds, ...(action.sourceImageIds || [])]);
  }
  return [...merged.values()];
}

export function reconcileUnshippedLabels({ manifestRows, observations }) {
  if (!Array.isArray(observations) || observations.length === 0) {
    const error = new Error("At least one label observation is required.");
    error.code = "LABEL_OBSERVATIONS_REQUIRED";
    throw error;
  }

  const manifest = buildShipmentManifest(manifestRows);
  const seenInvoices = new Map();
  const imageResults = observations.map((observation, index) => {
    const imageId = observationId(observation, index);
    const candidates = extractTrackingCandidates(observation);
    const matchedInvoices = candidates.filter((candidate) => manifest.packages.has(candidate));
    const matchedPackages = matchedInvoices.map((invoiceNo) => manifest.packages.get(invoiceNo));
    const expectedLabelCount = Number(observation?.expectedLabelCount ?? 1);
    const validExpectedCount = Number.isInteger(expectedLabelCount) && expectedLabelCount > 0;
    const issues = [];

    if (!candidates.length) issues.push("TRACKING_NUMBER_NOT_FOUND");
    if (candidates.length && !matchedInvoices.length) issues.push("INVOICE_NOT_IN_MANIFEST");
    if (!validExpectedCount) issues.push("EXPECTED_LABEL_COUNT_INVALID");
    if (validExpectedCount && matchedInvoices.length !== expectedLabelCount) {
      issues.push("LABEL_COUNT_MISMATCH");
    }

    for (const invoiceNo of matchedInvoices) {
      const sourceImages = seenInvoices.get(invoiceNo) || [];
      sourceImages.push(imageId);
      seenInvoices.set(invoiceNo, sourceImages);
    }

    return {
      imageId,
      fileName: cleanText(observation?.fileName),
      reason: cleanText(observation?.reason).toUpperCase() || "UNSPECIFIED",
      expectedLabelCount: validExpectedCount ? expectedLabelCount : null,
      candidates,
      matchedInvoices,
      matchedPackages,
      issues,
    };
  });

  for (const imageResult of imageResults) {
    if (imageResult.matchedInvoices.some((invoiceNo) => (seenInvoices.get(invoiceNo) || []).length > 1)) {
      imageResult.issues.push("DUPLICATE_LABEL_PHOTO");
    }
    imageResult.status = imageResult.issues.length ? "REVIEW_REQUIRED" : "MATCHED";
  }

  const invoiceDeletionCandidates = mergeActions(imageResults.flatMap((imageResult) =>
    imageResult.matchedPackages.map((shipment) => ({
      actionKey: `delete-invoice:${shipment.invoiceNo}`,
      invoiceNo: shipment.invoiceNo,
      shoplingOrderNos: unique(shipment.orders.map((order) => order.shoplingOrderNo)),
      bCodes: shipment.bCodes,
      sourceImageIds: [imageResult.imageId],
    }))), "invoiceNo");

  const stockoutPlans = imageResults.map((imageResult, index) =>
    stockoutPlanForImage(imageResult, observations[index]));
  const stockoutCandidates = mergeActions(stockoutPlans.flatMap((item) => item.candidates), "bCode");
  const blockedActions = [
    ...manifest.rejectedRows.map((row) => ({ code: "MANIFEST_ROW_REJECTED", ...row })),
    ...imageResults.flatMap((image) => image.issues.map((code) => ({ imageId: image.imageId, code }))),
    ...stockoutPlans.flatMap((item) => item.blocked),
  ];

  const readyForReview = invoiceDeletionCandidates.length > 0 && blockedActions.length === 0;
  return {
    mode: "DRY_RUN",
    summary: {
      manifestPackages: manifest.packageCount,
      manifestOrders: manifest.orderCount,
      observedImages: observations.length,
      matchedPackages: invoiceDeletionCandidates.length,
      proposedStockoutBCodes: stockoutCandidates.length,
      blockedActions: blockedActions.length,
    },
    imageResults,
    proposedActions: {
      invoiceDeletionCandidates,
      stockoutCandidates,
    },
    executionGate: {
      readyForReview,
      externalWritesAllowed: false,
      reason: readyForReview ? "OPERATOR_REVIEW_REQUIRED" : "UNRESOLVED_EVIDENCE",
    },
    blockedActions,
  };
}
