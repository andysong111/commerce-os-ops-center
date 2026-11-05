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

function replaceOneOf(
  source: string,
  variants: string[],
  after: string,
  code: string,
) {
  const matching = variants.filter((variant) =>
    source.includes(variant.replace(/\r\n?/g, "\n")),
  );
  if (matching.length !== 1) {
    throw new Error(`${code}:${matching.length ? "anchor_ambiguous" : "anchor_missing"}`);
  }
  return replaceOnce(source, matching[0], after, code);
}

export function patchHf75CanonicalListSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.1.7";',
    'const VERSION = "0.1.8";',
    "hf75_canonical_version",
  );

  next = replaceOneOf(
    next,
    [
      `  function encodeAssignment(message) {
    try {
      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({
        jobId: String(message.jobId),
        mode: String(message.mode),
        runId: String(message.runId || ""),
        stockProductKindHf48: String(message.stockProductKindHf48 || ""),
      }));
    } catch {
      return "";
    }
  }`,
      `  function encodeAssignment(message) {
    try {
      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({ jobId: String(message.jobId), mode: String(message.mode), runId: String(message.runId || "") }));
    } catch {
      return "";
    }
  }`,
    ],
    `  function normalizedGoodsKeysHf75(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => normalize(item)).filter(Boolean);
  }

  function encodeAssignment(message) {
    try {
      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({
        jobId: String(message.jobId),
        mode: String(message.mode),
        runId: String(message.runId || ""),
        stage: String(message.stage || ""),
        stockProductKindHf48: String(message.stockProductKindHf48 || ""),
        goodsKeys: normalizedGoodsKeysHf75(message.goodsKeys),
      }));
    } catch {
      return "";
    }
  }`,
    "hf75_canonical_assignment_marker",
  );

  next = replaceOneOf(
    next,
    [
      `      return {
        jobId: String(parsed.jobId),
        mode: String(parsed.mode),
        runId: String(parsed.runId || ""),
        stockProductKindHf48: String(parsed.stockProductKindHf48 || ""),
      };`,
      `      return { jobId: String(parsed.jobId), mode: String(parsed.mode), runId: String(parsed.runId || "") };`,
    ],
    `      return {
        jobId: String(parsed.jobId),
        mode: String(parsed.mode),
        runId: String(parsed.runId || ""),
        stage: String(parsed.stage || ""),
        stockProductKindHf48: String(parsed.stockProductKindHf48 || ""),
        goodsKeys: normalizedGoodsKeysHf75(parsed.goodsKeys),
      };`,
    "hf75_canonical_decode_marker",
  );

  next = replaceOnce(
    next,
    `  function openerAssignment() {`,
    `  function markerOwnsAssignmentHf75(marker, assignment) {
    if (!marker || !assignment) return false;
    const markerKeys = normalizedGoodsKeysHf75(marker.goodsKeys);
    const assignmentKeys = normalizedGoodsKeysHf75(assignment.goodsKeys);
    return String(marker.jobId || "") === String(assignment.jobId || "") &&
      String(marker.mode || "") === String(assignment.mode || "") &&
      String(marker.runId || "") === String(assignment.runId || "") &&
      String(marker.stage || "") === String(assignment.stage || "") &&
      String(marker.stockProductKindHf48 || "") === String(assignment.stockProductKindHf48 || "") &&
      markerKeys.length === assignmentKeys.length &&
      markerKeys.every((key, index) => key === assignmentKeys[index]);
  }

  function verifyListAssignmentOwnershipHf75(assignment) {
    let raw = "";
    try { raw = String(window.name || ""); } catch { /* ignore */ }
    const marker = assignmentFromMarker(raw);
    if (!markerOwnsAssignmentHf75(marker, assignment)) {
      return {
        ok: false,
        code: "A21_LIST_ASSIGNMENT_OWNER_MISMATCH_HF75",
        message: "현재 A21 목록창이 이 B코드와 goods key 묶음의 전용 작업창인지 확인하지 못했습니다.",
      };
    }
    const input = findSearchInput();
    if (!input) {
      return {
        ok: false,
        code: "A21_LIST_QUERY_INPUT_MISSING_HF75",
        message: "현재 A21 검색어를 확인할 수 없어 이전 검색 결과 사용을 차단했습니다.",
      };
    }
    const expected = normalizedGoodsKeysHf75(assignment.goodsKeys).join(",");
    const actual = normalize(input.value).replace(/\s*,\s*/g, ",");
    if (actual !== expected) {
      return {
        ok: false,
        code: "A21_LIST_QUERY_OWNER_MISMATCH_HF75",
        message: "현재 A21 검색어가 요청 goods key 묶음과 다릅니다. 요청 " + (expected || "없음") + " / 화면 " + (actual || "없음"),
      };
    }
    return { ok: true, expected, actual };
  }

  function openerAssignment() {`,
    "hf75_canonical_owner_verifier",
  );

  next = replaceOnce(
    next,
    `    input.value = assignment.goodsKeys.join(",");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));`,
    `    markWorker(assignment);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = normalizedGoodsKeysHf75(assignment.goodsKeys).join(",");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ownership = verifyListAssignmentOwnershipHf75(assignment);
    if (!ownership.ok) return fail(assignment.jobId, ownership.code, ownership.message);`,
    "hf75_canonical_exact_query_write",
  );

  next = replaceOnce(
    next,
    `  async function selectRowsAndOpenPopup(assignment) {
    if (role() !== "A21_LIST") return;
    const evidence = await waitForSearchResultEvidence();`,
    `  async function selectRowsAndOpenPopup(assignment) {
    if (role() !== "A21_LIST") return;
    const ownership = verifyListAssignmentOwnershipHf75(assignment);
    if (!ownership.ok) return fail(assignment.jobId, ownership.code, ownership.message);
    const evidence = await waitForSearchResultEvidence();`,
    "hf75_canonical_guard_results_before_selection",
  );

  next = replaceOnce(
    next,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V017_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V017TestHooks = { clickModifySend };
    return;
  }`,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V018_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V018TestHooks = {
      clickModifySend,
      encodeAssignment,
      assignmentFromMarker,
      markerOwnsAssignmentHf75,
      verifyListAssignmentOwnershipHf75,
    };
    return;
  }
  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V017_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V017TestHooks = { clickModifySend };
    return;
  }`,
    "hf75_canonical_test_hook",
  );

  return replaceOneOf(
    next,
    [
      `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          stockProductKindsHf48.set(String(message.jobId), String(message.stockProductKindHf48 || ""));
          markWorker(message);
          sendResponse({ ok: true, accepted: true });`,
      `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          markWorker(message);
          sendResponse({ ok: true, accepted: true });`,
    ],
    `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          stockProductKindsHf48.set(String(message.jobId), String(message.stockProductKindHf48 || ""));
          sendResponse({ ok: true, accepted: true });`,
    "hf75_canonical_do_not_claim_stale_reload",
  );
}
