type ExtensionManifest = {
  version?: string;
  description?: string;
  action?: { default_title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

const AUTO_AGENT = "shopling-market-auto-agent.mjs";
const CONTENT = "content-group-canary.mjs";
const BACKGROUND = "background-root.mjs";

function replaceExactly(
  source: string,
  anchor: string,
  replacement: string,
  expectedCount: number,
  code: string,
) {
  const count = source.split(anchor).length - 1;
  if (count !== expectedCount) throw new Error(`${code}:${count}`);
  return source.replace(anchor, replacement);
}

function removeFunctionExactly(
  source: string,
  functionName: string,
  nextAnchor: string,
  code: string,
) {
  const startAnchor = `  async function ${functionName}(`;
  const start = source.indexOf(startAnchor);
  const duplicate = source.indexOf(startAnchor, start + 1);
  const end = source.indexOf(nextAnchor, start);
  if (start < 0 || duplicate >= 0 || end < 0) throw new Error(code);
  return `${source.slice(0, start)}${source.slice(end)}`;
}

const BACKGROUND_RUNTIME_V0349 = String.raw`
let marketCoordinatorMutationV0349 = Promise.resolve();

function marketCoordinatorA18UrlV0349(url) {
  try {
    const parsed = new URL(String(url || ""));
    return ["a.shopling.co.kr", "kt.shopling.co.kr"].includes(parsed.hostname)
      && parsed.pathname === "/prodlinkage/goods_mallRegLst.phtml";
  } catch {
    return false;
  }
}

function marketCoordinatorUpdateTabV0349(tabId, url) {
  return new Promise((resolve) => chrome.tabs.update(tabId, { url, active: false }, (tab) => {
    const error = chrome.runtime.lastError;
    resolve(error ? null : (tab || null));
  }));
}

async function marketCoordinatorClaimV0349(sender) {
  const tabId = Number(sender && sender.tab && sender.tab.id);
  const frameId = Number.isInteger(sender && sender.frameId) ? sender.frameId : 0;
  if (!Number.isInteger(tabId) || tabId <= 0 || !isAdminControlUrl(sender && sender.tab && sender.tab.url)) {
    return { ok: false, granted: false, error: "coordinator_sender_invalid" };
  }

  const stored = await marketAutoStorageGet([
    MARKET_COORDINATOR_QUEUE_KEY_V0349,
    MARKET_COORDINATOR_INTENT_KEY_V0349,
    MARKET_COORDINATOR_LEASE_KEY_V0349,
  ]);
  const queue = stored[MARKET_COORDINATOR_QUEUE_KEY_V0349] || null;
  const intent = stored[MARKET_COORDINATOR_INTENT_KEY_V0349] || null;
  const now = Date.now();
  let scope = "";
  if (queue && queue.status === "running" && Number(queue.startedAt || 0) > 0) {
    scope = "queue:" + Number(queue.startedAt);
  } else {
    const intentAge = now - Number(intent && intent.createdAt || 0);
    if (intent && intent.status === "pending" && intent.resumeRunningQueue !== true
      && Number.isFinite(intentAge) && intentAge >= 0 && intentAge <= 90000) {
      scope = "intent:" + Number(intent.createdAt);
    }
  }
  if (!scope) return { ok: true, granted: false, reason: "no_runnable_scope" };

  const current = stored[MARKET_COORDINATOR_LEASE_KEY_V0349] || null;
  const sameScope = current && current.scope === scope;
  const ownerTabId = Number(current && current.tabId);
  const ownerFrameId = Number.isInteger(current && current.frameId) ? current.frameId : 0;
  const ownerTab = sameScope && Number.isInteger(ownerTabId)
    ? await marketAutoGetTab(ownerTabId)
    : null;
  const liveLease = Boolean(ownerTab)
    && Number(current && current.expiresAt || 0) > now;
  const sameOwner = liveLease && ownerTabId === tabId && ownerFrameId === frameId;
  if (liveLease && !sameOwner) {
    return { ok: true, granted: false, scope, ownerTabId, reason: "owned_by_other_frame" };
  }

  const lease = {
    version: "0.3.49",
    scope,
    tabId,
    frameId,
    acquiredAt: sameOwner ? Number(current.acquiredAt || now) : now,
    heartbeatAt: now,
    expiresAt: now + 6000,
  };
  await marketAutoStorageSet({ [MARKET_COORDINATOR_LEASE_KEY_V0349]: lease });
  return { ok: true, granted: true, scope, ownerTabId: tabId, frameId };
}

async function marketAutoResumeRunningQueueV0349(sender) {
  const stored = await marketAutoStorageGet([
    MARKET_COORDINATOR_QUEUE_KEY_V0349,
    MARKET_COORDINATOR_INTENT_KEY_V0349,
    MARKET_RESUME_NAVIGATION_KEY_V0349,
  ]);
  const queue = stored[MARKET_COORDINATOR_QUEUE_KEY_V0349] || null;
  const now = Date.now();
  const intent = stored[MARKET_COORDINATOR_INTENT_KEY_V0349] || null;
  const queueJobIds = Array.isArray(queue && queue.jobIds)
    ? [...new Set(queue.jobIds.map(text).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 100)
    : [];
  const intentJobIds = Array.isArray(intent && intent.jobIds)
    ? [...new Set(intent.jobIds.map(text).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 100)
    : [];
  const queueStartedAt = Number(queue && queue.startedAt || 0);
  const intentCreatedAt = Number(intent && intent.createdAt || 0);
  const intentAge = now - intentCreatedAt;
  const runningQueue = queue && queue.status === "running" && queueJobIds.length > 0 && queueStartedAt > 0;
  const pendingIntent = intent && intent.status === "pending" && intent.resumeRunningQueue !== true
    && intentJobIds.length > 0 && Number.isFinite(intentAge) && intentAge >= 0 && intentAge <= 90000;
  const scope = runningQueue
    ? "queue:" + queueStartedAt
    : pendingIntent
      ? "intent:" + intentCreatedAt
      : "";
  if (!scope) return { ok: true, resumed: false, reason: "a18_control_scope_unavailable" };

  if (runningQueue && intent && intent.status === "pending" && intent.resumeRunningQueue === true) {
    await marketAutoStorageSet({
      [MARKET_COORDINATOR_INTENT_KEY_V0349]: {
        ...intent,
        status: "superseded_single_owner_v0349",
        finishedAt: now,
      },
    });
  }

  const navigation = stored[MARKET_RESUME_NAVIGATION_KEY_V0349] || null;
  if (navigation && navigation.scope === scope) {
    const ownedTab = await marketAutoGetTab(Number(navigation.controlTabId));
    if (ownedTab && (marketCoordinatorA18UrlV0349(ownedTab.url)
      || now - Number(navigation.requestedAt || 0) < 20000)) {
      return { ok: true, resumed: true, reused: true, controlTabId: ownedTab.id };
    }
  }

  const meta = await getWorkerMeta().catch(() => null);
  const workerTabIds = new Set(
    assignmentArray(meta)
      .filter((row) => row && row.status === "active")
      .flatMap((row) => Array.isArray(row.tabIds) ? row.tabIds : []),
  );
  const existingA18 = (await marketAutoQueryTabs({
    url: [
      "https://a.shopling.co.kr/prodlinkage/goods_mallRegLst.phtml*",
      "https://kt.shopling.co.kr/prodlinkage/goods_mallRegLst.phtml*",
    ],
  }))
    .filter((tab) => Number.isInteger(tab && tab.id) && !workerTabIds.has(tab.id))
    .sort((left, right) => Number(left.id) - Number(right.id))[0] || null;
  if (existingA18) {
    await marketAutoStorageSet({
      [MARKET_RESUME_NAVIGATION_KEY_V0349]: {
        version: "0.3.49",
        scope,
        controlTabId: existingA18.id,
        requestedAt: now,
        reusedExistingA18: true,
      },
    });
    return { ok: true, resumed: true, reused: true, controlTabId: existingA18.id };
  }

  const senderTab = sender && sender.tab;
  if (!Number.isInteger(senderTab && senderTab.id) || !isAdminControlUrl(senderTab && senderTab.url)) {
    return { ok: false, resumed: false, error: "resume_control_tab_unavailable" };
  }
  let hostname = "";
  try { hostname = new URL(String(senderTab.url || "")).hostname; } catch { /* fail below */ }
  if (!["a.shopling.co.kr", "kt.shopling.co.kr"].includes(hostname)) {
    return { ok: false, resumed: false, error: "resume_control_host_invalid" };
  }
  const targetUrl = "https://" + hostname + "/prodlinkage/goods_mallRegLst.phtml";
  const updated = await marketCoordinatorUpdateTabV0349(senderTab.id, targetUrl);
  if (!updated) return { ok: false, resumed: false, error: "resume_control_navigation_failed" };
  await marketAutoStorageSet({
    [MARKET_RESUME_NAVIGATION_KEY_V0349]: {
      version: "0.3.49",
      scope,
      controlTabId: senderTab.id,
      requestedAt: now,
      targetUrl,
    },
  });
  return { ok: true, resumed: true, navigated: true, controlTabId: senderTab.id };
}
`;

export function buildSingleCoordinatorV0349(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"] || "{}") as ExtensionManifest;
  if (manifest.version !== "0.3.48") throw new Error("v0349_wrong_base");
  for (const name of [AUTO_AGENT, CONTENT, BACKGROUND]) {
    if (!output[name]) throw new Error(`v0349_missing_asset:${name}`);
  }

  let agent = removeFunctionExactly(
    output[AUTO_AGENT],
    "ensureRunningQueueResumeIntentV0348",
    "  async function tick() {",
    "v0349_resume_helper_anchor",
  );
  agent = replaceExactly(
    agent,
    '  const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
    '  const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";\n  const BG_RESUME_RUNNING_QUEUE = "commerce-os-shopling-market-resume-running-queue-v0349";',
    1,
    "v0349_agent_resume_constant",
  );
  agent = replaceExactly(
    agent,
    '      if (queue && queue.status === "running") {\n        await ensureRunningQueueResumeIntentV0348(queue);\n        return;\n      }',
    '      if (queue && queue.status === "running") {\n        await send({ type: BG_RESUME_RUNNING_QUEUE });\n        return;\n      }',
    1,
    "v0349_agent_resume_branch",
  );

  let content = replaceExactly(
    output[CONTENT],
    '  const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0343";',
    '  const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0343";\n  const COORDINATOR_CLAIM_MESSAGE_V0349 = "commerce-os-shopling-market-coordinator-claim-v0349";\n  const COORDINATOR_NAVIGATE_MESSAGE_V0349 = "commerce-os-shopling-market-navigate-a18-v0349";',
    1,
    "v0349_content_claim_constant",
  );
  content = replaceExactly(
    content,
    '    if (!intent || intent.status !== "pending") return null;\n    const age = Date.now() - Number(intent.createdAt || 0);',
    '    if (!intent || intent.status !== "pending") return null;\n    if (intent.resumeRunningQueue === true) return null;\n    const age = Date.now() - Number(intent.createdAt || 0);',
    1,
    "v0349_content_resume_guard",
  );
  content = replaceExactly(
    content,
    '  async function navigateControlToA18ForIntent() {\n    const intent = await pendingSelectionIntent();\n    if (!intent || !isAdminShell()) return false;\n    const lastRequestedAt = Number(intent.navigationRequestedAt || 0);\n    if (lastRequestedAt > 0 && Date.now() - lastRequestedAt < 10000) return false;\n\n    const aMenu = buttons(/^\\[?A\\]?\\s*상품$/i, true)[0] || buttons(/\\[A\\].*상품/i, true)[0];\n    if (aMenu) dispatchHover(aMenu);\n    await sleep(250);\n    const a18 = findA18Link();\n    if (!a18) return false;\n\n    await storageSet({\n      [SELECTION_INTENT_KEY]: {\n        ...intent,\n        navigationRequestedAt: Date.now(),\n      },\n    });\n    click(a18);\n    return true;\n  }',
    '  async function navigateControlToA18ForIntent() {\n    const intent = await pendingSelectionIntent();\n    if (!intent || !isAdminShell()) return false;\n    const navigation = await sendMessage({ type: COORDINATOR_NAVIGATE_MESSAGE_V0349 });\n    return navigation && navigation.resumed === true;\n  }',
    1,
    "v0349_content_navigation_gate",
  );
  content = replaceExactly(
    content,
    '      if (!isProductListUi()) { if (window.top === window && isAdminShell()) await navigateControlToA18ForIntent(); return; }\n      await activateSelectionIntent();',
    '      if (!isProductListUi()) { if (window.top === window && isAdminShell()) await navigateControlToA18ForIntent(); return; }\n      const coordinator = await sendMessage({ type: COORDINATOR_CLAIM_MESSAGE_V0349 });\n      if (!coordinator || coordinator.granted !== true) return;\n      await activateSelectionIntent();',
    1,
    "v0349_content_claim_gate",
  );

  let background = replaceExactly(
    output[BACKGROUND],
    'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
    [
      'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const MARKET_COORDINATOR_CLAIM_V0349 = "commerce-os-shopling-market-coordinator-claim-v0349";',
      'const MARKET_COORDINATOR_NAVIGATE_V0349 = "commerce-os-shopling-market-navigate-a18-v0349";',
      'const MARKET_RESUME_RUNNING_QUEUE_V0349 = "commerce-os-shopling-market-resume-running-queue-v0349";',
      'const MARKET_COORDINATOR_QUEUE_KEY_V0349 = "commerceOsShoplingMarketSelectionQueueV0343";',
      'const MARKET_COORDINATOR_INTENT_KEY_V0349 = "commerceOsShoplingMarketSelectionIntentV0343";',
      'const MARKET_COORDINATOR_LEASE_KEY_V0349 = "commerceOsShoplingMarketCoordinatorLeaseV0349";',
      'const MARKET_RESUME_NAVIGATION_KEY_V0349 = "commerceOsShoplingMarketResumeNavigationV0349";',
    ].join("\n"),
    1,
    "v0349_background_constants",
  );
  background = replaceExactly(
    background,
    "// No recovery of unrelated/pre-existing result tabs on extension startup.",
    `${BACKGROUND_RUNTIME_V0349}\n// No recovery of unrelated/pre-existing result tabs on extension startup.`,
    1,
    "v0349_background_runtime",
  );
  background = replaceExactly(
    background,
    '  const goodsKey = text(message.goodsKey);\n\n  if (message.type === MARKET_AUTO_BG_HANDOFF) {',
    '  const goodsKey = text(message.goodsKey);\n\n  if ([MARKET_COORDINATOR_CLAIM_V0349, MARKET_COORDINATOR_NAVIGATE_V0349, MARKET_RESUME_RUNNING_QUEUE_V0349].includes(message.type)) {\n    const operation = marketCoordinatorMutationV0349.then(() => message.type === MARKET_COORDINATOR_CLAIM_V0349\n      ? marketCoordinatorClaimV0349(sender)\n      : marketAutoResumeRunningQueueV0349(sender));\n    marketCoordinatorMutationV0349 = operation.catch(() => null);\n    operation.then(sendResponse).catch((error) => sendResponse({ ok: false, granted: false, resumed: false, error: String(error && error.message ? error.message : error) }));\n    return true;\n  }\n\n  if (message.type === MARKET_AUTO_BG_HANDOFF) {',
    1,
    "v0349_background_handler",
  );

  if (agent.includes("ensureRunningQueueResumeIntentV0348")) {
    throw new Error("v0349_periodic_resume_writer_retained");
  }
  if (!background.includes("marketCoordinatorMutationV0349")) {
    throw new Error("v0349_background_single_flight_missing");
  }
  if (!content.includes("coordinator.granted !== true")) {
    throw new Error("v0349_content_owner_gate_missing");
  }

  manifest.version = "0.3.49";
  manifest.description =
    "실행 중 큐 복귀와 A18 제어권을 백그라운드 단일 소유권으로 직렬화해, 같은 지시가 여러 샵플링 창을 반복 생성하지 않도록 차단합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.49 · A18 단일 제어창",
  };

  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output[AUTO_AGENT] = agent;
  output[CONTENT] = content;
  output[BACKGROUND] = background;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.49\nSingle-owner A18 recovery and coordinator lease.\n";
  output["README.txt"] =
    "v0.3.49 SINGLE-OWNER A18 RECOVERY\n" +
    "- 실행 중 큐 복귀는 백그라운드에서 한 번만 처리하며 새 창을 만들지 않습니다.\n" +
    "- 기존 A18 탭을 재사용하고, 없을 때에만 현재 관리자 탭 하나를 A18로 이동합니다.\n" +
    "- A18 큐 조정자는 탭·프레임 단위 임대를 받은 한 곳만 실행합니다.\n" +
    "- v0.3.48의 반복 pending 복구 의도는 승격 즉시 무효화되며 새 전송을 만들지 않습니다.\n" +
    "- 서버 원장 확인 전에는 전송 성공으로 간주하거나 재전송하지 않습니다.\n";

  for (const name of [AUTO_AGENT, CONTENT, BACKGROUND]) new Function(output[name]);
  return output;
}
