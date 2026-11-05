function replaceOnce(source: string, before: string, after: string, code: string) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const normalizedBefore = before.replace(/\r\n?/g, "\n");
  const first = normalizedSource.indexOf(normalizedBefore);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (
    normalizedSource.indexOf(
      normalizedBefore,
      first + normalizedBefore.length,
    ) >= 0
  ) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${normalizedSource.slice(0, first)}${after}${normalizedSource.slice(first + normalizedBefore.length)}`;
}

export function patchHf76CanonicalListSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.1.8";',
    'const VERSION = "0.1.9";',
    "hf76_canonical_version",
  );

  // Stage changes are lifecycle progress, not worker ownership. Keeping stage
  // in the identity made the valid post-search page look stale immediately
  // after LIST_START -> SEARCH_SUBMITTED.
  next = replaceOnce(
    next,
    `      String(marker.runId || "") === String(assignment.runId || "") &&
      String(marker.stage || "") === String(assignment.stage || "") &&
      String(marker.stockProductKindHf48 || "") === String(assignment.stockProductKindHf48 || "") &&`,
    `      String(marker.runId || "") === String(assignment.runId || "") &&
      String(marker.stockProductKindHf48 || "") === String(assignment.stockProductKindHf48 || "") &&`,
    "hf76_stable_execution_owner",
  );

  // The local HF74/HF75 regression fixture still carries the original 500-row
  // helper, while the real v0.6.38 ZIP already uses the guarded 200-row helper.
  // Normalize both inputs to the packaged contract before replacing the whole
  // configure function so the route is tested against the exact live parent.
  if (next.includes("    setPageSize500();")) {
    next = replaceOnce(
      next,
      "    setPageSize500();",
      '    if (!setPageSize200Hf76()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");',
      "hf76_page_size_200_normalization",
    );
  } else {
    next = replaceOnce(
      next,
      '    if (!setPageSize200HF19()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");',
      '    if (!setPageSize200Hf76()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");',
      "hf76_page_size_200_live_parent",
    );
  }

  next = replaceOnce(
    next,
    `  async function configureAndSearch(assignment) {`,
    `  function setPageSize200Hf76() {
    if (typeof setPageSize200HF19 === "function") return setPageSize200HF19();
    if (typeof setPageSize500 === "function") {
      setPageSize500();
      return true;
    }
    return false;
  }

  function assignmentOwnerKeyHf76(assignment) {
    return [
      String(assignment?.jobId || ""),
      String(assignment?.runId || ""),
      String(assignment?.stockProductKindHf48 || ""),
      normalizedGoodsKeysHf75(assignment?.goodsKeys).join(","),
    ].join(":");
  }

  function prepareListAssignmentHf76(assignment) {
    if (role() !== "A21_LIST") {
      return { ok: false, accepted: false, prepared: false, code: "A21_LIST_NOT_DETECTED_HF76", message: "A21 목록 화면을 확인하지 못했습니다." };
    }
    const goodsKeys = normalizedGoodsKeysHf75(assignment?.goodsKeys);
    if (goodsKeys.length < 1 || goodsKeys.length > 200) {
      return { ok: false, accepted: false, prepared: false, code: "A21_GOODSKEY_BATCH_INVALID_HF76", message: "검색 GOODSKEY 묶음이 1~200개 범위를 벗어났습니다." };
    }
    const postSearch = ["SEARCH_SUBMITTED", "POPUP_OPENING", "POPUP_CONFIG", "SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(assignment?.stage || ""));
    if (!postSearch) {
      if (!setPageSize200Hf76()) return { ok: false, accepted: false, prepared: false, code: "A21_PAGE_SIZE_200_SET_FAILED_HF76", message: "A21 화면출력을 200개로 고정하지 못했습니다." };
      if (!enableAllDateSearch()) return { ok: false, accepted: false, prepared: false, code: "A21_ALL_DATE_FILTER_NOT_FOUND_HF76", message: "검색 기간을 전체로 설정하지 못했습니다." };
      if (!setSearchFieldToGoodsKey()) return { ok: false, accepted: false, prepared: false, code: "A21_GOODSKEY_SEARCH_SELECT_NOT_FOUND_HF76", message: "검색항목의 샵플링상품코드 선택을 찾지 못했습니다." };
      if (!selectMallSpecificPriceSource()) return { ok: false, accepted: false, prepared: false, code: "A21_MALL_PRICE_SOURCE_NOT_FOUND_HF76", message: "쇼핑몰별판매가 버튼을 찾지 못했습니다." };
      const input = findSearchInput();
      if (!input) return { ok: false, accepted: false, prepared: false, code: "A21_MULTI_SEARCH_INPUT_NOT_FOUND_HF76", message: "샵플링상품코드 다중검색 입력칸을 찾지 못했습니다." };
      markWorker({ ...assignment, goodsKeys });
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.value = goodsKeys.join(",");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const ownership = verifyListAssignmentOwnershipHf75({ ...assignment, goodsKeys });
    if (!ownership.ok) {
      return { ok: false, accepted: false, prepared: false, code: ownership.code, message: ownership.message };
    }
    return {
      ok: true,
      accepted: true,
      prepared: true,
      role: "A21_LIST",
      ownerKey: assignmentOwnerKeyHf76({ ...assignment, goodsKeys }),
      goodsKeyQuery: goodsKeys.join(","),
      goodsKeyCount: goodsKeys.length,
      preparedStage: String(assignment?.stage || ""),
      version: VERSION,
    };
  }

  async function configureAndSearch(assignment) {`,
    "hf76_prepared_assignment_ack",
  );

  next = replaceOnce(
    next,
    `  async function configureAndSearch(assignment) {
    if (role() !== "A21_LIST") return fail(assignment.jobId, "A21_LIST_NOT_DETECTED", "A21 목록 화면을 확인하지 못했습니다.");
    if (!Array.isArray(assignment.goodsKeys) || assignment.goodsKeys.length < 1 || assignment.goodsKeys.length > 200) {
      return fail(assignment.jobId, "A21_GOODSKEY_BATCH_INVALID", "검색 GOODSKEY 묶음이 1~200개 범위를 벗어났습니다.");
    }
    if (!setPageSize200Hf76()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");
    if (!enableAllDateSearch()) return fail(assignment.jobId, "A21_ALL_DATE_FILTER_NOT_FOUND", "검색 기간을 전체로 설정하지 못해 전송하지 않았습니다.");
    if (!setSearchFieldToGoodsKey()) return fail(assignment.jobId, "A21_GOODSKEY_SEARCH_SELECT_NOT_FOUND", "검색항목의 샵플링상품코드 선택을 찾지 못했습니다.");
    if (!selectMallSpecificPriceSource()) return fail(assignment.jobId, "A21_MALL_PRICE_SOURCE_NOT_FOUND", "쇼핑몰별판매가 버튼을 찾지 못했습니다.");
    const input = findSearchInput();
    if (!input) return fail(assignment.jobId, "A21_MULTI_SEARCH_INPUT_NOT_FOUND", "샵플링상품코드 다중검색 입력칸을 찾지 못했습니다.");
    markWorker(assignment);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = normalizedGoodsKeysHf75(assignment.goodsKeys).join(",");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ownership = verifyListAssignmentOwnershipHf75(assignment);
    if (!ownership.ok) return fail(assignment.jobId, ownership.code, ownership.message);
    await stage(assignment.jobId, "SEARCH_SUBMITTED", { message: \`\${assignment.goodsKeys.length}개 GOODSKEY 검색\` });
    if (!clickSearchNear(input)) return fail(assignment.jobId, "A21_SEARCH_BUTTON_NOT_FOUND", "검색 버튼을 찾지 못했습니다.");
  }`,
    `  async function configureAndSearch(assignment) {
    const prepared = prepareListAssignmentHf76(assignment);
    if (!prepared.ok) return fail(assignment.jobId, prepared.code, prepared.message);
    const input = findSearchInput();
    await stage(assignment.jobId, "SEARCH_SUBMITTED", { message: \`\${prepared.goodsKeyCount}개 GOODSKEY 검색\` });
    if (!clickSearchNear(input)) return fail(assignment.jobId, "A21_SEARCH_BUTTON_NOT_FOUND", "검색 버튼을 찾지 못했습니다.");
  }`,
    "hf76_configure_uses_prepared_assignment",
  );

  next = replaceOnce(
    next,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V018_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V018TestHooks = {
      clickModifySend,
      encodeAssignment,
      assignmentFromMarker,
      markerOwnsAssignmentHf75,
      verifyListAssignmentOwnershipHf75,
    };
    return;
  }`,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V019_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V019TestHooks = {
      clickModifySend,
      encodeAssignment,
      assignmentFromMarker,
      markerOwnsAssignmentHf75,
      verifyListAssignmentOwnershipHf75,
      assignmentOwnerKeyHf76,
      prepareListAssignmentHf76,
    };
    return;
  }
  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V018_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V018TestHooks = {
      clickModifySend,
      encodeAssignment,
      assignmentFromMarker,
      markerOwnsAssignmentHf75,
      verifyListAssignmentOwnershipHf75,
    };
    return;
  }`,
    "hf76_canonical_test_hook",
  );

  return replaceOnce(
    next,
    `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          stockProductKindsHf48.set(String(message.jobId), String(message.stockProductKindHf48 || ""));
          sendResponse({ ok: true, accepted: true });
          const key = \`\${message.jobId}:\${message.stage}:\${Array.isArray(message.goodsKeys) ? message.goodsKeys.join(",") : ""}\`;
          if (handledListAssignments.has(key)) return;
          handledListAssignments.add(key);`,
    `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          stockProductKindsHf48.set(String(message.jobId), String(message.stockProductKindHf48 || ""));
          const prepared = prepareListAssignmentHf76(message);
          if (!prepared.ok) {
            sendResponse(prepared);
            await fail(message.jobId, prepared.code, prepared.message);
            return;
          }
          sendResponse(prepared);
          const key = \`\${message.jobId}:\${message.stage}:\${Array.isArray(message.goodsKeys) ? message.goodsKeys.join(",") : ""}\`;
          if (handledListAssignments.has(key)) return;
          handledListAssignments.add(key);`,
    "hf76_listener_requires_prepared_ack",
  );
}
