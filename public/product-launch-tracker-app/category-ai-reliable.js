const AI_BUTTON_ID = "shopling-category-ai-button";
const REVIEW_LINK_ID = "shopling-category-review-queue-link";
const STATUS_ID = "shopling-category-ai-run-status";
const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const OPTIMIZED_API_PATH = "/api/product-launch-tracker/optimized";
const AI_ENDPOINT = "/api/product-launch-tracker/ai-category";
const AI_TIMEOUT_MS = 285_000;
const STATE_TIMEOUT_MS = 60_000;
const AI_RETRY_MIN_DELAY_MS = 1_500;
const AI_RETRY_MAX_DELAY_MS = 15_000;
let analysisActive = false;
let activeController = null;

installReliableAiCategoryRunner();

function installReliableAiCategoryRunner() {
  document.addEventListener("click", interceptAiClick, true);
  document.addEventListener("click", guardReviewNavigation, true);
  window.addEventListener("beforeunload", guardPageLeave);
  window.setTimeout(resetStaleAiButton, 400);
}

function interceptAiClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(`#${AI_BUTTON_ID}`);
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (analysisActive) return;
  void runReliableAiCategoryAssignment(button);
}

function guardReviewNavigation(event) {
  if (!analysisActive) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest(`#${REVIEW_LINK_ID}`);
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  window.alert("AI 카테고리 분석 결과를 저장 중입니다. 완료 후 검토함으로 이동하세요.");
}

function guardPageLeave(event) {
  if (!analysisActive) return;
  event.preventDefault();
  event.returnValue = "";
}

async function runReliableAiCategoryAssignment(button) {
  const ids = selectedItemIds();
  if (!ids.length) {
    window.alert("AI 카테고리를 설정할 상품을 먼저 체크하세요.");
    return;
  }
  if (ids.length > 25) {
    window.alert("AI 카테고리는 한 번에 최대 25개까지 처리합니다.");
    return;
  }

  const displayedState = readLocalState();
  if (!displayedState) {
    window.alert("신규 상품 출시 진행관리 저장본을 찾지 못했습니다.");
    return;
  }
  const selected = ids
    .map((id) => displayedState.items.find((item) => String(item?.id ?? "") === id))
    .filter(Boolean);
  if (selected.length !== ids.length) {
    window.alert("선택한 상품 일부를 저장본에서 찾지 못했습니다. 화면을 새로고침한 뒤 다시 실행하세요.");
    return;
  }

  analysisActive = true;
  activeController = new AbortController();
  setBusyUi(button, selected.length, true);
  setRunStatus("running", `1/4 · ${selected.length}건의 기본 의미분석을 먼저 확보한 뒤 웹 검색 근거로 보강하고 있습니다.`);

  const requestItems = selected.map(categoryRequestItem);
  const savedResultById = new Map();
  let savedCount = 0;

  try {
    const firstResponse = await requestCategoryRecommendations(
      requestItems,
      false,
    );
    let latestState = displayedState;

    if (firstResponse.results.length) {
      setRunStatus(
        "running",
        `2/4 · 완료된 ${firstResponse.results.length}건을 검토함에 먼저 저장하고 있습니다.`,
      );
      latestState = await persistCategoryResults(latestState, firstResponse);
      for (const result of firstResponse.results) {
        savedResultById.set(String(result.itemId), result);
      }
      savedCount = savedResultById.size;
    }

    let unresolved = collectCategoryFailures(firstResponse, requestItems);
    const retryIds = new Set(
      unresolved
        .filter((failure) => failure.retryable !== false)
        .map((failure) => String(failure.itemId)),
    );
    const retryItems = requestItems.filter((item) => retryIds.has(String(item.itemId)));

    if (retryItems.length) {
      const retryDelayMs = categoryRetryDelayMs(firstResponse.failures);
      setRunStatus(
        "running",
        `3/4 · ${savedCount}건은 보존했습니다. 실패한 ${retryItems.length}건만 요청 속도를 낮춰 자동 재시도하고 있습니다.`,
      );
      try {
        await delay(retryDelayMs);
        const retryResponse = await requestCategoryRecommendations(
          retryItems,
          true,
        );
        if (retryResponse.results.length) {
          await persistCategoryResults(latestState, retryResponse);
          for (const result of retryResponse.results) {
            savedResultById.set(String(result.itemId), result);
          }
          savedCount = savedResultById.size;
        }
        const retryFailures = collectCategoryFailures(retryResponse, retryItems);
        unresolved = [
          ...unresolved.filter((failure) => !retryIds.has(String(failure.itemId))),
          ...retryFailures,
        ];
      } catch (retryError) {
        const retryMessage = readableError(retryError);
        unresolved = [
          ...unresolved.filter((failure) => !retryIds.has(String(failure.itemId))),
          ...retryItems.map((item) => ({
            itemId: item.itemId,
            modelNumber: item.modelNumber,
            productName: item.productName,
            retryable: true,
            message: retryMessage,
          })),
        ];
      }
    }

    if (unresolved.length) {
      const failedLabels = unresolved
        .map((failure) => failure.modelNumber || failure.productName || failure.itemId)
        .filter(Boolean)
        .slice(0, 8)
        .join(", ");
      const failedDetails = unresolved
        .slice(0, 8)
        .map((failure) => {
          const label = failure.modelNumber || failure.productName || failure.itemId;
          const stage =
            failure.stage === "search_profile" ? "검색·의미분석" : "샵플링 후보선택";
          return `${label} · ${stage} · ${failure.message || "원인 미상"}`;
        })
        .join("\n");
      const message = `4/4 · ${savedCount}건은 검토함에 저장했습니다. ${unresolved.length}건은 자동 재시도 후에도 완료되지 않았습니다.`;
      setRunStatus("failed", `${message} 실패: ${failedLabels} · ${failedDetails}`);
      window.alert(
        `${message}\n성공한 결과는 사라지지 않았습니다.\n실패 상세:\n${failedDetails}`,
      );
    } else {
      setRunStatus(
        "success",
        `4/4 · ${savedCount}건의 새 카테고리 후보를 검토함에 저장했습니다.`,
      );
      window.alert(
        `AI 카테고리 후보 생성이 완료됐습니다.\n${savedCount}건 모두 검토함에 저장했습니다.`,
      );
    }
    window.location.reload();
  } catch (error) {
    const rawMessage = readableError(error);
    const message = savedCount
      ? `${savedCount}건은 이미 검토함에 저장했습니다. 나머지 처리 중 오류: ${rawMessage}`
      : rawMessage;
    setRunStatus("failed", message);
    window.alert(message);
  } finally {
    analysisActive = false;
    activeController = null;
    setBusyUi(button, selectedItemIds().length, false);
  }
}

function categoryRequestItem(item) {
  return {
    itemId: item.id,
    modelNumber: item.modelNumber,
    productName: item.productName,
    optionLabels: Array.isArray(item.orderOptions)
      ? item.orderOptions.map((option) => option?.saleOption).filter(Boolean)
      : [],
    currentCategory: item.shoplingCategory || "",
    chinaProductLinks: Array.isArray(item.chinaProductLinks)
      ? item.chinaProductLinks
      : [],
  };
}

async function requestCategoryRecommendations(items, retryFailedIndividually) {
  const response = await fetchJsonWithTimeout(
    AI_ENDPOINT,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ items, retryFailedIndividually }),
      signal: activeController.signal,
    },
    AI_TIMEOUT_MS,
    "AI 카테고리 분석 제한시간을 초과했습니다. 완료된 결과는 보존하고 실패 상품만 다시 실행하세요.",
  );
  if (response?.ok !== true || !Array.isArray(response.results)) {
    throw new Error(response?.message || "AI 카테고리 결과를 받지 못했습니다.");
  }
  return {
    ...response,
    failures: Array.isArray(response.failures) ? response.failures : [],
  };
}

function collectCategoryFailures(response, requestedItems) {
  const resultIds = new Set(
    response.results.map((result) => String(result?.itemId ?? "")),
  );
  const failureById = new Map(
    response.failures.map((failure) => [String(failure?.itemId ?? ""), failure]),
  );
  return requestedItems
    .filter((item) => !resultIds.has(String(item.itemId)))
    .map((item) =>
      failureById.get(String(item.itemId)) || {
        itemId: item.itemId,
        modelNumber: item.modelNumber,
        productName: item.productName,
        retryable: true,
        message: "AI 결과가 누락되어 자동 재시도가 필요합니다.",
      },
    );
}

function categoryRetryDelayMs(failures) {
  const upstreamDelay = (Array.isArray(failures) ? failures : []).reduce(
    (maximum, failure) => Math.max(maximum, Number(failure?.retryAfterMs) || 0),
    0,
  );
  return Math.min(
    AI_RETRY_MAX_DELAY_MS,
    Math.max(AI_RETRY_MIN_DELAY_MS, upstreamDelay),
  );
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function persistCategoryResults(previousState, response) {
  const resultById = new Map(
    response.results.map((result) => [String(result.itemId), result]),
  );
  const now = new Date().toISOString();
  const patches = [];
  const nextItems = previousState.items.map((item) => {
    const result = resultById.get(String(item?.id ?? ""));
    if (!result) return item;

    const patch = {
      categoryAiSuggestion: result.selectedPath,
      categoryAiConfidence: result.confidence,
      categoryAiReason: result.reason,
      categoryAiAlternatives: result.alternatives,
      categoryAiCandidateChoices: Array.isArray(result.candidateChoices)
        ? result.candidateChoices
        : [],
      categoryAiCandidatePaths: Array.isArray(result.candidatePaths)
        ? result.candidatePaths
        : [],
      categoryAiMarketEvidence:
        result.marketEvidence && typeof result.marketEvidence === "object"
          ? result.marketEvidence
          : null,
      categoryAiStatus: "review_required",
      categoryAiSnapshotHash:
        response.snapshot?.hash || item.categoryAiSnapshotHash || "",
      categoryAiEngineVersion:
        result.engineVersion || item.categoryAiEngineVersion || "",
      categoryAiUpdatedAt: now,
    };
    patches.push({ itemId: String(item.id), patch });
    return {
      ...item,
      ...patch,
      updatedAt: now,
    };
  });

  if (patches.length) {
    await saveServerCategoryPatches(patches);
  }

  const nextState = {
    ...previousState,
    savedAt: now,
    items: nextItems,
  };
  writeLocalState(nextState);
  updateReviewLinkCount(nextState);
  return nextState;
}

async function saveServerCategoryPatches(patches) {
  const body = await fetchJsonWithTimeout(
    OPTIMIZED_API_PATH,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        operation: "bulk_patch_items",
        patches,
        updatedBy: "승준 · AI 카테고리 후보 생성",
      }),
    },
    STATE_TIMEOUT_MS,
    "AI 결과를 서버에 저장하는 시간이 초과됐습니다.",
  );
  if (body?.ok !== true) {
    throw new Error(body?.message || "AI 카테고리 결과를 서버에 저장하지 못했습니다.");
  }
}

function writeLocalState(state) {
  const serialized = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, serialized);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: STORAGE_KEY,
      newValue: serialized,
      storageArea: localStorage,
    }),
  );
}

function selectedItemIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id]")]
    .filter((row) => row.querySelector("input[type='checkbox']:checked"))
    .map((row) => String(row.dataset.id ?? "").trim())
    .filter(Boolean);
}

function readLocalState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && Array.isArray(value.items) ? value : null;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs, timeoutMessage) {
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const signals = [init.signal, timeoutController.signal].filter(Boolean);
  const combinedSignal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any(signals)
      : timeoutController.signal;
  try {
    const response = await fetch(url, { ...init, signal: combinedSignal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.message || `요청에 실패했습니다. HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (timeoutController.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function setBusyUi(button, count, busy) {
  button.disabled = busy || count === 0;
  button.dataset.reliableAiBusy = busy ? "1" : "0";
  button.textContent = busy
    ? `${count}건 AI 분석 중…`
    : count
      ? `선택 AI 카테고리 후보 생성 (${count}건)`
      : "선택 AI 카테고리 후보 생성";
  const link = document.querySelector(`#${REVIEW_LINK_ID}`);
  if (link instanceof HTMLElement) {
    link.setAttribute("aria-disabled", busy ? "true" : "false");
    link.style.pointerEvents = busy ? "none" : "";
    link.style.opacity = busy ? "0.55" : "";
  }
}

function setRunStatus(tone, message) {
  const status = ensureRunStatus();
  status.dataset.tone = tone;
  status.textContent = message;
  status.style.color =
    tone === "success" ? "#047857" : tone === "failed" ? "#b91c1c" : "#1d4ed8";
  status.style.background =
    tone === "success" ? "#ecfdf5" : tone === "failed" ? "#fef2f2" : "#eff6ff";
  status.style.borderColor =
    tone === "success" ? "#a7f3d0" : tone === "failed" ? "#fecaca" : "#bfdbfe";
}

function ensureRunStatus() {
  let status = document.querySelector(`#${STATUS_ID}`);
  if (status instanceof HTMLElement) return status;
  status = document.createElement("span");
  status.id = STATUS_ID;
  status.style.display = "inline-flex";
  status.style.alignItems = "center";
  status.style.minHeight = "34px";
  status.style.padding = "6px 10px";
  status.style.border = "1px solid #bfdbfe";
  status.style.borderRadius = "8px";
  status.style.fontSize = "11px";
  status.style.fontWeight = "800";
  status.style.whiteSpace = "normal";
  status.style.maxWidth = "440px";
  status.style.background = "#eff6ff";
  status.style.color = "#1d4ed8";
  const button = document.querySelector(`#${AI_BUTTON_ID}`);
  button?.insertAdjacentElement("afterend", status);
  return status;
}

function updateReviewLinkCount(state) {
  const link = document.querySelector(`#${REVIEW_LINK_ID}`);
  if (!(link instanceof HTMLAnchorElement)) return;
  const count = state.items.filter(
    (item) =>
      item &&
      !item.archivedAt &&
      (item.categoryAiStatus === "review_required" ||
        item.categoryAiStatus === "review_held"),
  ).length;
  link.textContent = count
    ? `AI 카테고리 검토함 (${count}건)`
    : "AI 카테고리 검토함";
  link.dataset.count = String(count);
  link.style.borderColor = count ? "#f59e0b" : "";
  link.style.color = count ? "#92400e" : "";
  link.style.background = count ? "#fffbeb" : "";
}

function resetStaleAiButton() {
  const button = document.querySelector(`#${AI_BUTTON_ID}`);
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.dataset.reliableAiBusy === "1") return;
  const count = selectedItemIds().length;
  if (button.textContent?.includes("AI 분석 중")) {
    setBusyUi(button, count, false);
    setRunStatus("failed", "이전 AI 분석이 완료되지 않았습니다. 상품을 다시 선택해 실행하세요.");
  }
}

function readableError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "AI 카테고리 분석이 중단됐습니다. 화면을 유지한 채 다시 실행하세요.";
  }
  return error instanceof Error
    ? error.message
    : "AI 카테고리 자동설정에 실패했습니다.";
}
