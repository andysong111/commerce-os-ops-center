importScripts("background-v093.js");

// HF75 gives every B-code execution its own A21 list worker. HF67 deliberately
// reused one authenticated worker, but that also let a later B-code inherit the
// previous search input and result rows. The dedicated worker is cloned from
// the authenticated exact A21 page and is reused only inside the same execution.
(() => {
  const VERSION_V094 = chrome.runtime.getManifest().version;
  const MANAGED_WORKER_KEY_V094 = "commerceStockExecutionWorkerHf75";
  const WORKER_TIMEOUT_MS_V094 = 25_000;
  const INSPECT_INTERVAL_MS_V094 = 240;
  const legacyDispatchCurrentV094 = dispatchCurrent;
  const legacyDispatchToTargetV094 = dispatchToTarget;

  function groupedJobV094(active) {
    return Boolean(
      active?.status === "RUNNING" &&
      active?.stage === "A21_LIST" &&
      active?.job?.stockStateApiApplied === true &&
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0,
    );
  }

  function executionOwnerKeyV094(active) {
    const jobId = String(active?.job?.jobId || "");
    const runId = String(active?.job?.executionId || jobId);
    return `${jobId}:${runId}`;
  }

  async function inspectExactA21TabV094(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) =>
          String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const compact = (value) => norm(value).replace(/\s+/g, "");
        const path = String(location.pathname || "").toLowerCase();
        const text = norm(
          document.body?.innerText ||
          document.body?.textContent ||
          document.documentElement?.innerText ||
          "",
        );
        const options = [...document.querySelectorAll("select option")].map(
          (option) => compact(option.textContent),
        );
        const exactA21 =
          path === "/prodlinkage/goods_prod_join_list.phtml" &&
          options.includes(compact("샵플링상품코드")) &&
          /쇼핑몰상품수정/i.test(text) &&
          /상품\s*수정전송/i.test(text);
        return {
          exactA21,
          href: String(location.href || ""),
          title: String(document.title || ""),
        };
      },
    }).catch(() => []);
    const exact = frames.find((frame) => frame.result?.exactA21 === true);
    if (!exact) return null;
    return {
      tabId,
      windowId: tab.windowId,
      frameId: exact.frameId,
      role: "A21_LIST",
      owned: true,
      page: {
        role: "A21_LIST",
        href: String(exact.result.href || ""),
        title: String(exact.result.title || ""),
        canNavigate: false,
      },
    };
  }

  async function loadManagedWorkerV094() {
    const stored = await chrome.storage.local
      .get(MANAGED_WORKER_KEY_V094)
      .catch(() => ({}));
    return stored?.[MANAGED_WORKER_KEY_V094] || null;
  }

  async function saveManagedWorkerV094(worker) {
    await chrome.storage.local.set({ [MANAGED_WORKER_KEY_V094]: worker });
  }

  async function closePreviousManagedWorkerV094(ownerKey) {
    const previous = await loadManagedWorkerV094();
    if (
      !previous ||
      previous.ownerKey === ownerKey ||
      previous.ownershipPolicy !== "HF75_EXECUTION_FRESH_A21_WORKER" ||
      !Number.isInteger(previous.tabId)
    ) {
      return;
    }
    const exact = await inspectExactA21TabV094(previous.tabId);
    if (!exact) return;
    await chrome.tabs.remove(previous.tabId).catch(() => null);
  }

  async function waitForExactA21WorkerV094(tabId) {
    const deadline = Date.now() + WORKER_TIMEOUT_MS_V094;
    while (Date.now() < deadline) {
      const target = await inspectExactA21TabV094(tabId);
      if (target) return target;
      await sleep(INSPECT_INTERVAL_MS_V094);
    }
    return null;
  }

  async function ensureExecutionWorkerV094(active, templateTarget) {
    const ownerKey = executionOwnerKeyV094(active);
    if (!ownerKey || ownerKey === ":") {
      throw new Error("HF75_A21_EXECUTION_OWNER_MISSING");
    }

    const bound = active?.a21ExecutionWorkerHf75;
    if (bound?.ownerKey === ownerKey && Number.isInteger(bound?.tabId)) {
      const exactBound = await inspectExactA21TabV094(bound.tabId);
      if (exactBound) return { ...exactBound, ownerKey };
    }

    const exactTemplate = await inspectExactA21TabV094(templateTarget?.tabId);
    const href = String(exactTemplate?.page?.href || templateTarget?.page?.href || "");
    if (!exactTemplate || !href) {
      throw new Error("HF75_EXACT_A21_TEMPLATE_NOT_FOUND");
    }

    await closePreviousManagedWorkerV094(ownerKey);
    const created = await chrome.windows.create({
      url: href,
      type: "popup",
      width: 1420,
      height: 900,
      focused: false,
    });
    const createdTabId = created.tabs?.[0]?.id;
    if (!Number.isInteger(createdTabId)) {
      throw new Error("HF75_FRESH_A21_WORKER_CREATE_FAILED");
    }

    const target = await waitForExactA21WorkerV094(createdTabId);
    if (!target) {
      await chrome.tabs.remove(createdTabId).catch(() => null);
      throw new Error("HF75_FRESH_A21_WORKER_NOT_READY");
    }

    const managed = {
      ownerKey,
      tabId: target.tabId,
      windowId: target.windowId,
      frameId: target.frameId,
      createdAt: Date.now(),
      ownershipPolicy: "HF75_EXECUTION_FRESH_A21_WORKER",
    };
    active.a21ExecutionWorkerHf75 = managed;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: target.tabId, frameId: target.frameId },
    };
    await saveManagedWorkerV094(managed);
    await saveActive(active);
    await progress(
      active,
      `${active.job.barcode} · 현재 B코드 전용 A21 작업창 연결 완료`,
      {
        code: "SHOPLING_HF75_FRESH_A21_WORKER_BOUND",
        ownerKey,
        tabId: target.tabId,
        frameId: target.frameId,
        extensionVersion: VERSION_V094,
      },
    );
    return { ...target, ownerKey };
  }

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF75_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf75TestHooks = {
      groupedJobV094,
      executionOwnerKeyV094,
      inspectExactA21TabV094,
      ensureExecutionWorkerV094,
    };
    return;
  }

  dispatchToTarget = async function dispatchToTargetV094(active, target) {
    if (!groupedJobV094(active)) return legacyDispatchToTargetV094(active, target);
    const worker = await ensureExecutionWorkerV094(active, target);
    return legacyDispatchToTargetV094(active, worker);
  };

  dispatchCurrent = async function dispatchCurrentV094(active, options = {}) {
    if (!groupedJobV094(active)) return legacyDispatchCurrentV094(active, options);
    const template = await findExactRoleTarget("A21_LIST");
    if (!template) return false;
    const worker = await ensureExecutionWorkerV094(active, template);
    if (options?.focus) {
      await chrome.tabs.update(worker.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(worker.windowId)) {
        await chrome.windows.update(worker.windowId, { focused: true }).catch(() => null);
      }
    }
    return legacyDispatchToTargetV094(active, worker);
  };

  console.log(
    "[CommerceOS Stock HF75]",
    new Date().toISOString(),
    "each B-code owns a fresh exact A21 list worker before grouped dispatch",
    VERSION_V094,
  );
})();
