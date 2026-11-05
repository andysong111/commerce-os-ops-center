importScripts("background-v094.js");

// HF76 restores the proven price-resend bootstrap contract. A fresh exact A21
// worker must acknowledge the actual owner marker and the exact goods-key query
// after its content worker is ready. A plain "accepted" reply is never enough.
(() => {
  const VERSION_V095 = chrome.runtime.getManifest().version;
  const CANONICAL_SCRIPT_V095 = "content-a21-canonical-v019.js";
  const CANONICAL_VERSION_V095 = "0.1.9";
  const IDENTIFY_V095 = "A21_IDENTIFY";
  const ASSIGN_V095 = "A21_LIST_ASSIGNMENT";
  const BATCH_MAX_V095 = 200;
  const MANAGED_KEY_V095 = "commerceStockExecutionWorkerHf76";
  const WORKER_TIMEOUT_MS_V095 = 25_000;
  const RESULT_MATCH_V095 = [
    "https://shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
    "https://*.shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
  ];
  const legacyDispatchCurrentV095 = dispatchCurrent;
  const legacyDispatchToTargetV095 = dispatchToTarget;
  const normV095 = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function groupedJobV095(active) {
    return Boolean(
      active?.status === "RUNNING" &&
      active?.stage === "A21_LIST" &&
      active?.job?.stockStateApiApplied === true &&
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0,
    );
  }

  function currentGroupV095(active) {
    const groups = active?.job?.stockStateTransmissionGroupsHf72;
    const index = Math.max(0, Number(active?.stockStateGroupIndexHf72 || 0));
    return Array.isArray(groups) ? groups[index] || null : null;
  }

  function currentBatchV095(active, group) {
    if (!group || !Array.isArray(group.goodsKeys)) return [];
    const start = Math.max(0, Number(active?.goodsKeyIndex || 0));
    const configured = Number(
      group.effectiveProductKind === "OPTION"
        ? active?.optionBatchLimit
        : active?.singleBatchLimit,
    );
    const limit = Math.max(
      1,
      Math.min(BATCH_MAX_V095, Number.isFinite(configured) ? configured : BATCH_MAX_V095),
    );
    return group.goodsKeys.slice(start, start + limit).map(normV095).filter(Boolean);
  }

  function prepareGroupedBatchV095(active) {
    const group = currentGroupV095(active);
    const batch = currentBatchV095(active, group);
    if (!group || !batch.length) return null;
    active.job.productKind = group.effectiveProductKind;
    active.job.goodsKeys = [...group.goodsKeys];
    active.job.currentTransmissionKind = group.transmissionKind;
    active.job.optionApiApplied = group.effectiveProductKind === "OPTION";
    active.job.productStatusApiApplied = group.effectiveProductKind === "SINGLE";
    active.job.currentGoodsOptionCount = Number(group.optionCounts?.[batch[0]] || 0);
    if (group.effectiveProductKind === "OPTION") {
      active.optionCurrentBatchKeys = [...batch];
      active.singleCurrentBatchKeys = [];
    } else {
      active.singleCurrentBatchKeys = [...batch];
      active.optionCurrentBatchKeys = [];
    }
    return { group, batch };
  }

  function runIdV095(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function executionOwnerV095(active) {
    const jobId = String(active?.job?.jobId || "");
    return `${jobId}:${runIdV095(active)}`;
  }

  function canonicalStageV095(active, group) {
    if (group.effectiveProductKind === "OPTION") {
      return String(
        active?.a21CanonicalStage ||
        `LIST_START_${Number(active?.stockStateGroupIndexHf72 || 0)}_${Number(active?.goodsKeyIndex || 0)}_${runIdV095(active)}`,
      );
    }
    return String(
      active?.singleA21CanonicalStage ||
      `SINGLE_LIST_START_${Number(active?.stockStateGroupIndexHf72 || 0)}_${Number(active?.goodsKeyIndex || 0)}_${runIdV095(active)}`,
    );
  }

  function canonicalAssignmentV095(active, group, batch) {
    return {
      type: ASSIGN_V095,
      jobId: active.job.jobId,
      mode: "OPTION",
      stockProductKindHf48: group.effectiveProductKind,
      goodsKeys: [...batch],
      stage: canonicalStageV095(active, group),
      runId: runIdV095(active),
      version: VERSION_V095,
    };
  }

  function assignmentOwnerKeyV095(assignment) {
    return [
      String(assignment?.jobId || ""),
      String(assignment?.runId || ""),
      String(assignment?.stockProductKindHf48 || ""),
      Array.isArray(assignment?.goodsKeys)
        ? assignment.goodsKeys.map(normV095).filter(Boolean).join(",")
        : "",
    ].join(":");
  }

  async function inspectExactA21TabV095(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const compact = (value) => norm(value).replace(/\s+/g, "");
        const path = String(location.pathname || "").toLowerCase();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        const options = [...document.querySelectorAll("select option")].map((option) => compact(option.textContent));
        return {
          exactA21:
            path === "/prodlinkage/goods_prod_join_list.phtml" &&
            options.includes(compact("샵플링상품코드")) &&
            /쇼핑몰상품수정/i.test(text) &&
            /상품\s*수정전송/i.test(text),
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

  async function waitForExactA21WorkerV095(tabId, timeoutMs = WORKER_TIMEOUT_MS_V095) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const target = await inspectExactA21TabV095(tabId);
      if (target) return target;
      await sleep(180);
    }
    return null;
  }

  async function loadManagedWorkerV095() {
    const stored = await chrome.storage.local.get(MANAGED_KEY_V095).catch(() => ({}));
    return stored?.[MANAGED_KEY_V095] || null;
  }

  async function saveManagedWorkerV095(worker) {
    await chrome.storage.local.set({ [MANAGED_KEY_V095]: worker });
  }

  async function closePreviousManagedWorkerV095(ownerKey) {
    const previous = await loadManagedWorkerV095();
    if (!previous || previous.ownerKey === ownerKey || !Number.isInteger(previous.tabId)) return;
    const exact = await inspectExactA21TabV095(previous.tabId);
    if (exact) await chrome.tabs.remove(previous.tabId).catch(() => null);
  }

  async function ensureExecutionWorkerV095(active, templateTarget) {
    const ownerKey = executionOwnerV095(active);
    if (!ownerKey || ownerKey === ":") throw new Error("HF76_A21_EXECUTION_OWNER_MISSING");

    const bound = active?.a21ExecutionWorkerHf76;
    if (bound?.ownerKey === ownerKey && Number.isInteger(bound?.tabId)) {
      const exactBound = await waitForExactA21WorkerV095(bound.tabId, 6_000);
      if (exactBound) return { ...exactBound, ownerKey };
    }

    const exactTemplate = await inspectExactA21TabV095(templateTarget?.tabId);
    const href = String(exactTemplate?.page?.href || templateTarget?.page?.href || "");
    if (!exactTemplate || !href) throw new Error("HF76_EXACT_A21_TEMPLATE_NOT_FOUND");

    await closePreviousManagedWorkerV095(ownerKey);
    const created = await chrome.windows.create({
      url: href,
      type: "popup",
      width: 1420,
      height: 900,
      focused: false,
    });
    const createdTabId = created.tabs?.[0]?.id;
    if (!Number.isInteger(createdTabId)) throw new Error("HF76_FRESH_A21_WORKER_CREATE_FAILED");
    const target = await waitForExactA21WorkerV095(createdTabId);
    if (!target) {
      await chrome.tabs.remove(createdTabId).catch(() => null);
      throw new Error("HF76_FRESH_A21_WORKER_NOT_READY");
    }
    const managed = {
      ownerKey,
      tabId: target.tabId,
      windowId: target.windowId,
      frameId: target.frameId,
      createdAt: Date.now(),
      ownershipPolicy: "HF76_PREPARED_ACK_FRESH_A21_WORKER",
    };
    active.a21ExecutionWorkerHf76 = managed;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: target.tabId, frameId: target.frameId },
    };
    await saveManagedWorkerV095(managed);
    await saveActive(active);
    return { ...target, ownerKey };
  }

  async function ensureCanonicalListWorkerV095(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    const probe = async () => chrome.tabs.sendMessage(
      target.tabId,
      { type: IDENTIFY_V095 },
      options,
    ).catch(() => null);
    let result = await probe();
    if (result?.ok && result.role === "A21_LIST" && result.version === CANONICAL_VERSION_V095) return true;
    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [CANONICAL_SCRIPT_V095],
    }).catch(() => null);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(160);
      result = await probe();
      if (result?.ok && result.role === "A21_LIST" && result.version === CANONICAL_VERSION_V095) return true;
    }
    return false;
  }

  async function bindAssignmentMarkerV095(target, assignment) {
    const marker = `commerce-os-a21-v016:${encodeURIComponent(JSON.stringify({
      jobId: String(assignment.jobId),
      mode: String(assignment.mode),
      runId: String(assignment.runId || ""),
      stage: String(assignment.stage || ""),
      stockProductKindHf48: String(assignment.stockProductKindHf48 || ""),
      goodsKeys: assignment.goodsKeys.map(normV095).filter(Boolean),
    }))}`;
    const results = await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      world: "MAIN",
      func: (value) => {
        window.name = value;
        return String(window.name || "");
      },
      args: [marker],
    }).catch(() => []);
    return results.some((item) => item.result === marker);
  }

  async function ensureResultBaselineV095(active) {
    const batchKey = `${Number(active?.stockStateGroupIndexHf72 || 0)}:${Number(active?.goodsKeyIndex || 0)}`;
    if (active?.shoplingResultBaselineBatchKeyHf72 === batchKey) return;
    const tabs = await chrome.tabs.query({ url: RESULT_MATCH_V095 }).catch(() => []);
    active.shoplingResultBaselineBatchKeyHf72 = batchKey;
    active.shoplingResultBaselineTabIdsHf72 = tabs.map((tab) => Number(tab?.id)).filter(Number.isInteger);
  }

  function preparedAckMatchesV095(response, assignment) {
    const query = assignment.goodsKeys.map(normV095).filter(Boolean).join(",");
    return Boolean(
      response?.ok === true &&
      response?.accepted === true &&
      response?.prepared === true &&
      response?.role === "A21_LIST" &&
      response?.version === CANONICAL_VERSION_V095 &&
      response?.ownerKey === assignmentOwnerKeyV095(assignment) &&
      response?.goodsKeyQuery === query &&
      Number(response?.goodsKeyCount) === assignment.goodsKeys.length,
    );
  }

  async function dispatchPreparedGroupedV095(active, templateTarget, { focus = false } = {}) {
    const prepared = prepareGroupedBatchV095(active);
    if (!prepared) return false;
    const { group, batch } = prepared;
    const worker = await ensureExecutionWorkerV095(active, templateTarget);
    if (focus) {
      await chrome.tabs.update(worker.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(worker.windowId)) {
        await chrome.windows.update(worker.windowId, { focused: true }).catch(() => null);
      }
    }
    if (!(await ensureCanonicalListWorkerV095(worker))) {
      await progress(active, `${active.job.barcode} · 전용 A21 본문 작업기가 준비되지 않아 전송 차단`, {
        code: "SHOPLING_HF76_CANONICAL_WORKER_NOT_READY",
        target: worker,
        goodsKeys: batch,
      });
      return false;
    }

    active.shoplingTabId = worker.tabId;
    active.shoplingFrameId = worker.frameId;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: worker.tabId, frameId: worker.frameId },
    };
    await ensureResultBaselineV095(active);
    await saveActive(active);

    const assignment = canonicalAssignmentV095(active, group, batch);
    if (!(await bindAssignmentMarkerV095(worker, assignment))) {
      await progress(active, `${active.job.barcode} · 전용 A21 작업창 소유권 기록 실패`, {
        code: "SHOPLING_HF76_OWNER_MARKER_WRITE_FAILED",
        goodsKeys: batch,
      });
      return false;
    }

    let response = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await chrome.tabs.sendMessage(
        worker.tabId,
        assignment,
        { frameId: worker.frameId },
      ).catch(() => null);
      if (preparedAckMatchesV095(response, assignment)) break;
      await sleep(220);
    }
    if (!preparedAckMatchesV095(response, assignment)) {
      await progress(active, `${active.job.barcode} · A21이 명령만 받았을 뿐 실제 goods key 입력 준비를 증명하지 못해 전송 차단`, {
        code: "SHOPLING_HF76_PREPARED_ACK_MISSING",
        expectedOwnerKey: assignmentOwnerKeyV095(assignment),
        expectedGoodsKeyQuery: batch.join(","),
        response,
      });
      return false;
    }

    await progress(
      active,
      `${active.job.barcode} · ${group.effectiveProductKind === "OPTION" ? "옵션송신" : "상품판매상태송신"} goods key ${batch.length}건 입력·소유권 확인 후 A21 실행`,
      {
        transmissionKind: group.transmissionKind,
        groupedGoodsKeys: batch,
        groupedGoodsKeyCount: batch.length,
        preparedAck: true,
        preparedOwnerKey: response.ownerKey,
        preparedGoodsKeyQuery: response.goodsKeyQuery,
        serialPerGoodsKey: false,
        extensionVersion: VERSION_V095,
      },
    );
    return true;
  }

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF76_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf76TestHooks = {
      groupedJobV095,
      currentBatchV095,
      prepareGroupedBatchV095,
      canonicalAssignmentV095,
      assignmentOwnerKeyV095,
      preparedAckMatchesV095,
      ensureExecutionWorkerV095,
      ensureCanonicalListWorkerV095,
    };
    return;
  }

  dispatchToTarget = async function dispatchToTargetV095(active, target) {
    if (!groupedJobV095(active)) return legacyDispatchToTargetV095(active, target);
    return dispatchPreparedGroupedV095(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV095(active, options = {}) {
    if (!groupedJobV095(active)) return legacyDispatchCurrentV095(active, options);
    const boundTabId = active?.a21ExecutionWorkerHf76?.tabId;
    const template = Number.isInteger(boundTabId)
      ? await waitForExactA21WorkerV095(boundTabId, 6_000)
      : await findExactRoleTarget("A21_LIST");
    if (!template) return false;
    return dispatchPreparedGroupedV095(active, template, options);
  };

  console.log(
    "[CommerceOS Stock HF76]",
    new Date().toISOString(),
    "fresh A21 worker accepts only after exact goods-key query and stable execution ownership are prepared",
    VERSION_V095,
  );
})();
