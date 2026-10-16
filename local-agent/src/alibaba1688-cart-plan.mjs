const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeDecimal(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) / 1_000_000 : null;
}

export function normalize1688OptionName(value) {
  return text(value)
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
}

export function split1688OptionNames(value) {
  return text(value)
    .split(/[,，]/u)
    .map((part) => text(part))
    .filter(Boolean);
}

export function parse1688OfferLink(value) {
  const source = text(value);
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/(^|\.)1688\.com$/i.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/\/offer\/(\d+)\.html/i);
  if (!match) return null;
  return {
    offerId: match[1],
    url: `https://detail.1688.com/offer/${match[1]}.html`,
  };
}

function normalizeInspection(inspection) {
  const options = Array.isArray(inspection?.options) ? inspection.options : [];
  return {
    offerId: text(inspection?.offerId),
    loginRequired: inspection?.loginRequired === true,
    blockedReason: text(inspection?.blockedReason),
    singleSku: inspection?.singleSku === true,
    options: options
      .map((option) => ({
        name: text(option?.name ?? option),
        normalizedName: normalize1688OptionName(option?.name ?? option),
        purchasable: option?.purchasable !== false,
      }))
      .filter((option) => option.name),
  };
}

export function build1688CartPlan(draft, inspections = []) {
  if (!DRAFT_ID.test(text(draft?.draftId))) {
    fail("ALIBABA1688_DRAFT_ID_INVALID", "발주초안 ID가 올바르지 않습니다.");
  }
  if (draft?.status !== "DRAFT") {
    fail("ALIBABA1688_DRAFT_NOT_OPEN", "주문 준비 상태의 발주초안만 장바구니에 반영할 수 있습니다.");
  }
  if (!Array.isArray(draft?.lines) || draft.lines.length === 0) {
    fail("ALIBABA1688_DRAFT_EMPTY", "발주초안에 주문 품목이 없습니다.");
  }

  const inspectionByOffer = new Map(
    inspections.map(normalizeInspection).filter((item) => item.offerId).map((item) => [item.offerId, item]),
  );
  const barcodes = new Set();
  const normalizedLines = draft.lines.flatMap((line, index) => {
    const barcode = text(line?.barcode).toUpperCase().replace(/\s+/g, "");
    if (!BARCODE.test(barcode)) {
      fail("ALIBABA1688_BARCODE_INVALID", "발주초안에 올바르지 않은 B코드가 있습니다.", { index, barcode });
    }
    if (barcodes.has(barcode)) {
      fail("ALIBABA1688_BARCODE_DUPLICATE", "발주초안에 같은 B코드가 두 번 있습니다.", { barcode });
    }
    barcodes.add(barcode);

    const offer = parse1688OfferLink(line?.supplierLink);
    if (!offer) {
      fail("ALIBABA1688_SUPPLIER_LINK_REQUIRED", `${barcode}의 1688 상품 링크를 확인해야 합니다.`, { barcode });
    }
    const optionSelection = text(line?.purchaseOptionSelection) === "ANY_AVAILABLE" ? "ANY_AVAILABLE" : "EXACT";
    const components = Array.isArray(line?.purchaseComponents) && line.purchaseComponents.length
      ? line.purchaseComponents
      : [{ chinaOption: line?.chinaOption, quantityMultiplier: line?.purchaseQuantityMultiplier }];
    if (!components.length) {
      fail("ALIBABA1688_OPTION_REQUIRED", `${barcode}의 중국 옵션명이 비어 있습니다.`, { barcode, offerId: offer.offerId });
    }
    const baseQuantity = positiveInteger(line?.quantity);
    if (!baseQuantity || baseQuantity > 9_999) {
      fail("ALIBABA1688_QUANTITY_INVALID", `${barcode}의 권장수량이 올바르지 않습니다.`, { barcode, quantity: line?.quantity });
    }

    const inspection = inspectionByOffer.get(offer.offerId);
    if (inspections.length > 0 && !inspection) {
      fail("ALIBABA1688_OFFER_NOT_INSPECTED", `${barcode}의 1688 상품을 사전 점검하지 못했습니다.`, { barcode, offerId: offer.offerId });
    }
    if (inspection?.loginRequired) {
      fail("ALIBABA1688_LOGIN_REQUIRED", "열린 1688 전용 Chrome에서 로그인한 후 다시 실행하세요.", { offerId: offer.offerId });
    }
    if (inspection?.blockedReason === "SECURITY_CHALLENGE") {
      fail("ALIBABA1688_SECURITY_CHALLENGE", "열린 1688 전용 Chrome에서 보안 슬라이더 인증을 완료한 후 다시 실행하세요.", {
        barcode,
        offerId: offer.offerId,
        reason: inspection.blockedReason,
      });
    }
    if (inspection?.blockedReason) {
      fail("ALIBABA1688_OFFER_BLOCKED", `${barcode} 상품을 장바구니에 담을 수 없습니다.`, {
        barcode,
        offerId: offer.offerId,
        reason: inspection.blockedReason,
      });
    }

    return components.map((component, componentIndex) => {
      const optionName = text(component?.chinaOption);
      const requestedOptionNames = split1688OptionNames(optionName);
      if (!requestedOptionNames.length && optionSelection !== "ANY_AVAILABLE") {
        fail("ALIBABA1688_OPTION_REQUIRED", `${barcode}의 중국 옵션명이 비어 있습니다.`, { barcode, offerId: offer.offerId });
      }
      const normalizedRequestedOptions = requestedOptionNames.map(normalize1688OptionName);
      if (new Set(normalizedRequestedOptions).size !== normalizedRequestedOptions.length) {
        fail("ALIBABA1688_OPTION_DUPLICATE", `${barcode}의 중국 옵션에 같은 선택값이 중복되었습니다.`, {
          barcode,
          offerId: offer.offerId,
          requestedOptions: requestedOptionNames,
        });
      }
      const quantityMultiplier = positiveInteger(component?.quantityMultiplier) || 1;
      const quantity = baseQuantity * quantityMultiplier;
      if (quantity > 9_999) {
        fail("ALIBABA1688_QUANTITY_INVALID", `${barcode}의 포장단위 반영 주문수량이 올바르지 않습니다.`, { barcode, baseQuantity, quantityMultiplier, quantity });
      }

      let matchedOptionNames = requestedOptionNames;
      if (inspection) {
        const purchasableOptions = inspection.options.filter((option) => option.purchasable);
        if (optionSelection === "ANY_AVAILABLE" && components.length === 1) {
          if (!purchasableOptions.length) {
            fail("ALIBABA1688_OPTION_NOT_FOUND", `${barcode}에서 주문 가능한 임의 옵션을 찾지 못했습니다.`, { barcode, offerId: offer.offerId });
          }
          matchedOptionNames = [purchasableOptions[0].name];
        } else if (normalizedRequestedOptions.length === 1 && normalizedRequestedOptions[0] === normalize1688OptionName("단품")) {
          if (!(inspection.singleSku || purchasableOptions.length <= 1)) {
            fail("ALIBABA1688_SINGLE_OPTION_AMBIGUOUS", `${barcode}는 단품으로 확정할 수 없습니다.`, {
              barcode,
              offerId: offer.offerId,
              optionCount: purchasableOptions.length,
            });
          }
          matchedOptionNames = [purchasableOptions[0]?.name || "단품"];
        } else {
          matchedOptionNames = requestedOptionNames.map((requestedOption, optionIndex) => {
            const normalizedOption = normalizedRequestedOptions[optionIndex];
            const matches = purchasableOptions.filter((option) => option.normalizedName === normalizedOption);
            if (matches.length !== 1) {
              fail(matches.length > 1 ? "ALIBABA1688_OPTION_AMBIGUOUS" : "ALIBABA1688_OPTION_NOT_FOUND", `${barcode}의 중국 옵션 선택값을 정확히 하나로 확정하지 못했습니다.`, {
                barcode,
                offerId: offer.offerId,
                requestedOption,
                requestedOptions: requestedOptionNames,
                matchCount: matches.length,
              });
            }
            return matches[0].name;
          });
        }
      }
      const matchedOptionName = matchedOptionNames.join(",");
      return {
        barcode,
        offerId: offer.offerId,
        offerUrl: offer.url,
        requestedOptionName: optionName,
        matchedOptionName,
        matchedOptionNames,
        normalizedOptionName: normalize1688OptionName(matchedOptionName),
        quantity,
        baseQuantity,
        quantityMultiplier,
        componentIndex,
        optionSelection,
        draftIndex: index,
      };
    });
  });

  const itemByKey = new Map();
  for (const line of normalizedLines) {
    const key = `${line.offerId}\u0000${line.normalizedOptionName}`;
    const current = itemByKey.get(key) || {
      key,
      offerId: line.offerId,
      offerUrl: line.offerUrl,
      optionName: line.matchedOptionName,
      optionNames: line.matchedOptionNames,
      normalizedOptionName: line.normalizedOptionName,
      quantity: 0,
      barcodes: [],
    };
    current.quantity += line.quantity;
    current.barcodes.push(line.barcode);
    itemByKey.set(key, current);
  }

  return {
    draftId: text(draft.draftId),
    lineCount: draft.lines.length,
    totalQuantity: normalizedLines.reduce((sum, line) => sum + line.quantity, 0),
    lines: normalizedLines,
    items: [...itemByKey.values()],
  };
}

function cartLineKey(line) {
  return `${text(line?.offerId)}\u0000${normalize1688OptionName(line?.optionName)}`;
}

export function plan1688CartReconciliation(plan, cartLines = []) {
  const targetKeys = new Set(plan.items.map((item) => item.key));
  const byKey = new Map();
  for (const line of cartLines) {
    const key = cartLineKey(line);
    if (!targetKeys.has(key)) continue;
    const list = byKey.get(key) || [];
    list.push(line);
    byKey.set(key, list);
  }

  return plan.items.map((item) => {
    const matches = byKey.get(item.key) || [];
    if (matches.length > 1) {
      fail("ALIBABA1688_CART_LINE_AMBIGUOUS", "같은 1688 상품·옵션이 장바구니에 여러 줄 있습니다.", {
        offerId: item.offerId,
        optionName: item.optionName,
        matchCount: matches.length,
      });
    }
    if (matches.length === 0) return { type: "ADD", item };
    const currentQuantity = positiveInteger(matches[0].quantity);
    if (!currentQuantity) {
      fail("ALIBABA1688_CART_QUANTITY_INVALID", "장바구니 수량을 읽지 못했습니다.", { key: item.key });
    }
    return currentQuantity === item.quantity
      ? { type: "KEEP", item, cartLine: matches[0] }
      : { type: "SET_QUANTITY", item, cartLine: matches[0], quantity: item.quantity };
  });
}

function safeGroupId(value) {
  const source = text(value).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return source ? `1688-cart:${source}` : "";
}

export function buildDraftLinesFrom1688Checkout(draft, plan, checkout) {
  const cartLines = Array.isArray(checkout?.lines) ? checkout.lines : [];
  const groups = Array.isArray(checkout?.sellerGroups) ? checkout.sellerGroups : [];
  const cartByKey = new Map();
  for (const line of cartLines) {
    const key = cartLineKey(line);
    if (!plan.items.some((item) => item.key === key)) continue;
    if (cartByKey.has(key)) {
      fail("ALIBABA1688_CHECKOUT_LINE_AMBIGUOUS", "주문 미리보기에 같은 상품·옵션이 여러 줄 있습니다.", { key });
    }
    cartByKey.set(key, line);
  }

  const groupById = new Map();
  for (const group of groups) {
    const groupId = text(group?.groupId || group?.sellerId);
    const freightCny = nonNegativeDecimal(group?.domesticFreightCny);
    if (!groupId || freightCny == null) {
      fail("ALIBABA1688_FREIGHT_GROUP_INVALID", "판매자별 중국 내 배송비를 정확히 읽지 못했습니다.");
    }
    if (groupById.has(groupId)) {
      fail("ALIBABA1688_FREIGHT_GROUP_DUPLICATE", "같은 판매자 운임 그룹이 두 번 감지되었습니다.", { groupId });
    }
    groupById.set(groupId, { groupId, freightCny });
  }

  const itemReadback = new Map();
  for (const item of plan.items) {
    const line = cartByKey.get(item.key);
    if (!line) {
      fail("ALIBABA1688_CHECKOUT_LINE_MISSING", "주문 미리보기에서 발주 품목을 찾지 못했습니다.", { key: item.key });
    }
    const quantity = positiveInteger(line.quantity);
    if (quantity !== item.quantity) {
      fail("ALIBABA1688_CHECKOUT_QUANTITY_MISMATCH", "장바구니 수량이 권장수량과 일치하지 않습니다.", {
        key: item.key,
        expected: item.quantity,
        actual: quantity,
      });
    }
    const unitPriceCny = nonNegativeDecimal(line.unitPriceCny);
    if (unitPriceCny == null || unitPriceCny <= 0) {
      fail("ALIBABA1688_CHECKOUT_PRICE_INVALID", "장바구니 이후 실제 위안 단가를 읽지 못했습니다.", { key: item.key });
    }
    const groupId = text(line.groupId || line.sellerId);
    if (!groupById.has(groupId)) {
      fail("ALIBABA1688_CHECKOUT_GROUP_MISSING", "품목의 판매자 운임 그룹을 연결하지 못했습니다.", { key: item.key, groupId });
    }
    itemReadback.set(item.key, { unitPriceCny, groupId });
  }

  const groupLeader = new Map();
  for (const line of plan.lines) {
    const key = `${line.offerId}\u0000${line.normalizedOptionName}`;
    const readback = itemReadback.get(key);
    if (!groupLeader.has(readback.groupId)) groupLeader.set(readback.groupId, line.barcode);
  }

  const draftLineByBarcode = new Map(draft.lines.map((line) => [text(line.barcode).toUpperCase(), line]));
  const plannedByBarcode = new Map();
  for (const plannedLine of plan.lines) {
    plannedByBarcode.set(plannedLine.barcode, [...(plannedByBarcode.get(plannedLine.barcode) || []), plannedLine]);
  }
  const updatedLineByBarcode = new Map([...plannedByBarcode].map(([barcode, plannedLines]) => {
    const source = draftLineByBarcode.get(barcode);
    const readbacks = plannedLines.map((plannedLine) => {
      const key = `${plannedLine.offerId}\u0000${plannedLine.normalizedOptionName}`;
      return { plannedLine, readback: itemReadback.get(key) };
    });
    const groupIds = [...new Set(readbacks.map(({ readback }) => readback.groupId))];
    if (groupIds.length !== 1) {
      fail("ALIBABA1688_COMPONENT_FREIGHT_GROUP_CONFLICT", "한 판매상품의 구성품이 서로 다른 운임그룹으로 분리되었습니다.", { barcode, groupIds });
    }
    const groupId = groupIds[0];
    const group = groupById.get(groupId);
    const unitPriceCny = readbacks.reduce((sum, { plannedLine, readback }) => (
      sum + readback.unitPriceCny * (positiveInteger(plannedLine.quantityMultiplier) || 1)
    ), 0);
    return [barcode, {
      ...source,
      unitPriceCny,
      freightGroupId: safeGroupId(groupId),
      domesticChinaFreightCny: groupLeader.get(groupId) === barcode ? group.freightCny : 0,
    }];
  }));

  const updatedLines = draft.lines.map((line) => (
    updatedLineByBarcode.get(text(line?.barcode).toUpperCase()) || line
  ));

  return updatedLines;
}
