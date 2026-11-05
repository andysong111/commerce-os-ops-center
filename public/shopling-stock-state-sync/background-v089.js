importScripts("background-v088.js");

// HF69: a B-code can resolve to several channel goods keys and each goods key
// can have a different Shopling option shape.  Run every key serially and pick
// OPTION vs product sale-status transmission from the API-verified per-key plan.
// This intentionally disables the HF29 option batch for these jobs so one key
// cannot hide another key's one-option split-product routing.
(() => {
  const VERSION_V089 = chrome.runtime.getManifest().version;
  const legacyStartV089 = start;
  const legacyDispatchCurrentV089 = dispatchCurrent;

  function normalizedTransmissionsV089(job) {
    const rows = Array.isArray(job?.stockStateTransmissions)
      ? job.stockStateTransmissions
      : [];
    const seen = new Set();
    const normalized = [];
    for (const row of rows) {
      const goodsKey = norm(row?.goodsKey);
      const transmissionKind = norm(row?.transmissionKind).toUpperCase();
      const effectiveProductKind =
        transmissionKind === "OPTION_SEND"
          ? "OPTION"
          : transmissionKind === "PRODUCT_SALE_STATUS_SEND"
            ? "SINGLE"
            : "";
      if (!/^\d+$/.test(goodsKey) || !effectiveProductKind || seen.has(goodsKey)) {
        return null;
      }
      seen.add(goodsKey);
      normalized.push({
        ...row,
        goodsKey,
        transmissionKind,
        effectiveProductKind,
      });
    }
    const goodsKeys = Array.isArray(job?.goodsKeys) ? job.goodsKeys.map(norm) : [];
    if (
      normalized.length !== goodsKeys.length ||
      goodsKeys.some((goodsKey) => !seen.has(goodsKey))
    ) {
      return null;
    }
    return normalized;
  }

  function prepareCurrentLaneV089(active) {
    const transmissions = normalizedTransmissionsV089(active?.job);
    if (!transmissions) return false;
    const goodsKey = currentGoodsKey(active);
    const current = transmissions.find((row) => row.goodsKey === goodsKey);
    if (!current) return false;
    active.job.logicalProductKind =
      active.job.logicalProductKind || active.job.productKind;
    active.job.productKind = current.effectiveProductKind;
    active.job.currentTransmissionKind = current.transmissionKind;
    active.job.currentGoodsOptionCount = Number(current.optionCount || 0);
    active.job.optionApiApplied = false;
    active.job.productStatusApiApplied =
      current.transmissionKind === "PRODUCT_SALE_STATUS_SEND";
    active.optionBatchMode = null;
    active.optionCurrentBatchKeys = [];
    return true;
  }

  start = async function startV089(input) {
    if (input?.stockStateApiApplied !== true || !input?.stockStateTransmissions) {
      return legacyStartV089(input);
    }
    const prepared = {
      ...input,
      logicalProductKind: input.logicalProductKind || input.productKind,
      optionApiApplied: false,
    };
    const activeLike = { job: prepared, goodsKeyIndex: 0 };
    if (!prepareCurrentLaneV089(activeLike)) {
      return {
        ok: false,
        code: "SHOPLING_GOODS_KEY_TRANSMISSION_PLAN_INVALID",
        message: "goods key별 Shopling 전송 분기표가 API 검증 결과와 일치하지 않습니다.",
      };
    }
    return legacyStartV089(activeLike.job);
  };

  dispatchCurrent = async function dispatchCurrentV089(active, options = {}) {
    if (active?.job?.stockStateApiApplied === true && active?.job?.stockStateTransmissions) {
      if (!prepareCurrentLaneV089(active)) {
        return false;
      }
      await saveActive(active);
      await progress(
        active,
        `${active.job.barcode} · goods key ${currentGoodsKey(active)} · ${
          active.job.productKind === "OPTION" ? "다옵션 옵션송신" : "1옵션 쪼개기/단품 상품판매상태송신"
        } 준비`,
        {
          transmissionKind: active.job.currentTransmissionKind,
          goodsOptionCount: active.job.currentGoodsOptionCount,
          serialPerGoodsKey: true,
          extensionVersion: VERSION_V089,
        },
      );
    }
    return legacyDispatchCurrentV089(active, options);
  };

  console.log(
    "[CommerceOS Stock HF69]",
    new Date().toISOString(),
    "per-goods-key option-shape routing and serial A21 dispatch enabled",
    VERSION_V089,
  );
})();
