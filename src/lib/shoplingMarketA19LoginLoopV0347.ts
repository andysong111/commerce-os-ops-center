type ManifestContentScript = {
  matches?: string[];
  js?: string[];
  all_frames?: boolean;
  run_at?: string;
  [key: string]: unknown;
};

type ExtensionManifest = {
  version?: string;
  description?: string;
  permissions?: string[];
  content_scripts?: ManifestContentScript[];
  action?: { default_title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

const SHOPLING_AUTO_AGENT_SCRIPT = "shopling-market-auto-agent.mjs";
const SHOPLING_ADMIN_HOSTS = ["a.shopling.co.kr", "kt.shopling.co.kr"] as const;
const SHOPLING_AUTO_AGENT_BLOCKED_PATHS = [
  "/login.phtml",
  "/prodlinkage/goods_mallReg_failList.phtml",
] as const;

function replaceExactly(
  source: string,
  anchor: string,
  replacement: string,
  expectedCount: number,
  code: string,
) {
  const count = source.split(anchor).length - 1;
  if (count !== expectedCount) throw new Error(`${code}:${count}`);
  return source.replaceAll(anchor, replacement);
}

export function shouldRunShoplingMarketAutoAgentV0347(
  hostname: string,
  pathname: string,
) {
  const normalizedHost = hostname.trim().toLowerCase();
  return (
    SHOPLING_ADMIN_HOSTS.includes(
      normalizedHost as (typeof SHOPLING_ADMIN_HOSTS)[number],
    ) &&
    !SHOPLING_AUTO_AGENT_BLOCKED_PATHS.includes(
      pathname as (typeof SHOPLING_AUTO_AGENT_BLOCKED_PATHS)[number],
    )
  );
}

const BACKGROUND_A19_AUDIT_V0346 = String.raw`async function marketAutoAuditA19(token, orchestrationId) {
  const requestId = "a19-" + crypto.randomUUID();
  await marketAutoStorageSet({
    [MARKET_AUTO_A19_REQUEST_KEY]: { requestId, orchestrationId, createdAt: Date.now() },
  });
  let tab = null;
  try {
    tab = await marketAutoCreateTab(MARKET_AUTO_A19_URL);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const stored = await marketAutoStorageGet([MARKET_AUTO_A19_RESULT_KEY]);
      const result = stored?.[MARKET_AUTO_A19_RESULT_KEY] || null;
      if (result && result.requestId === requestId) {
        const evidence = Array.isArray(result.rows) ? result.rows.slice(0, 500) : [];
        const receipt = result.receipt && typeof result.receipt === "object" ? result.receipt : null;
        await marketAutoStorageRemove([MARKET_AUTO_A19_REQUEST_KEY, MARKET_AUTO_A19_RESULT_KEY]);
        if (!receipt || receipt.ok !== true) throw new Error(String(receipt?.error || "a19_audit_receipt_invalid"));
        return { ok: true, evidence, receipt, requestId };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("a19_audit_timeout");
  } finally {
    if (tab?.id) await marketAutoCloseTab(tab.id);
  }
}`;

const BACKGROUND_A19_AUDIT_V0347 = String.raw`let marketAutoA19AuditInFlight = null;

function marketAutoQueryTabs(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, (tabs) => {
    void chrome.runtime.lastError;
    resolve(Array.isArray(tabs) ? tabs : []);
  }));
}

function marketAutoGetTab(tabId) {
  return new Promise((resolve) => chrome.tabs.get(tabId, (tab) => {
    const error = chrome.runtime.lastError;
    resolve(error ? null : (tab || null));
  }));
}

function marketAutoIsLoginTab(tab) {
  try {
    const parsed = new URL(String(tab?.url || ""));
    return ["a.shopling.co.kr", "kt.shopling.co.kr"].includes(parsed.hostname)
      && parsed.pathname === "/login.phtml";
  } catch {
    return false;
  }
}

async function marketAutoAuditA19Once(token, orchestrationId) {
  const existingLoginTabs = await marketAutoQueryTabs({
    url: [
      "https://a.shopling.co.kr/login*",
      "https://kt.shopling.co.kr/login*",
    ],
  });
  if (existingLoginTabs.some(marketAutoIsLoginTab)) {
    throw new Error("a19_login_required");
  }

  const requestId = "a19-" + crypto.randomUUID();
  await marketAutoStorageSet({
    [MARKET_AUTO_A19_REQUEST_KEY]: { requestId, orchestrationId, createdAt: Date.now() },
  });
  let tab = null;
  let retainLoginTab = false;
  let completed = false;
  try {
    tab = await marketAutoCreateTab(MARKET_AUTO_A19_URL);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const currentTab = tab?.id ? await marketAutoGetTab(tab.id) : null;
      if (currentTab?.status === "complete" && marketAutoIsLoginTab(currentTab)) {
        retainLoginTab = true;
        throw new Error("a19_login_required");
      }
      const stored = await marketAutoStorageGet([MARKET_AUTO_A19_RESULT_KEY]);
      const result = stored?.[MARKET_AUTO_A19_RESULT_KEY] || null;
      if (result && result.requestId === requestId) {
        const evidence = Array.isArray(result.rows) ? result.rows.slice(0, 500) : [];
        const receipt = result.receipt && typeof result.receipt === "object" ? result.receipt : null;
        if (!receipt || receipt.ok !== true) throw new Error(String(receipt?.error || "a19_audit_receipt_invalid"));
        completed = true;
        return { ok: true, evidence, receipt, requestId };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("a19_audit_timeout");
  } finally {
    await marketAutoStorageRemove([MARKET_AUTO_A19_REQUEST_KEY, MARKET_AUTO_A19_RESULT_KEY]);
    if (tab?.id && (!retainLoginTab || completed)) await marketAutoCloseTab(tab.id);
  }
}

async function marketAutoAuditA19(token, orchestrationId) {
  const scope = text(orchestrationId);
  const existing = marketAutoA19AuditInFlight;
  if (existing) {
    if (existing.orchestrationId !== scope) throw new Error("a19_audit_busy");
    return existing.promise;
  }
  const promise = marketAutoAuditA19Once(token, scope);
  marketAutoA19AuditInFlight = { orchestrationId: scope, promise };
  try {
    return await promise;
  } finally {
    if (marketAutoA19AuditInFlight?.promise === promise) {
      marketAutoA19AuditInFlight = null;
    }
  }
}`;

export function buildA19LoginLoopHotfixV0347(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"]) as ExtensionManifest;
  if (manifest.version !== "0.3.46") throw new Error("v0347_wrong_base");
  for (const required of ["background-root.mjs", SHOPLING_AUTO_AGENT_SCRIPT]) {
    if (!output[required]) throw new Error(`v0347_missing_asset:${required}`);
  }

  let agentEntryCount = 0;
  manifest.content_scripts = (manifest.content_scripts ?? []).map((entry) => {
    if (!entry.js?.includes(SHOPLING_AUTO_AGENT_SCRIPT)) return entry;
    agentEntryCount += 1;
    return {
      ...entry,
      matches: SHOPLING_ADMIN_HOSTS.map((host) => `https://${host}/*`),
      all_frames: false,
      run_at: "document_idle",
    };
  });
  if (agentEntryCount !== 1) {
    throw new Error(`v0347_agent_manifest_entry_count:${agentEntryCount}`);
  }

  const allowedHosts = JSON.stringify(SHOPLING_ADMIN_HOSTS);
  const blockedPaths = JSON.stringify(SHOPLING_AUTO_AGENT_BLOCKED_PATHS);
  const agent = replaceExactly(
    output[SHOPLING_AUTO_AGENT_SCRIPT],
    "  if (window.top !== window) return;",
    [
      "  if (window.top !== window) return;",
      `  if (!${allowedHosts}.includes(location.hostname) || ${blockedPaths}.includes(location.pathname)) return;`,
    ].join("\n"),
    1,
    "v0347_agent_page_guard_anchor",
  );

  const background = replaceExactly(
    output["background-root.mjs"],
    BACKGROUND_A19_AUDIT_V0346,
    BACKGROUND_A19_AUDIT_V0347,
    1,
    "v0347_background_a19_runtime_anchor",
  );

  manifest.version = "0.3.47";
  manifest.description =
    "Shopling 로그인 만료 시 A19 감사 탭을 브라우저 전체에서 한 번만 열고, 로그인/A19 페이지에서는 자동 에이전트를 실행하지 않아 로그인 탭 연쇄 생성을 차단합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.47 · 로그인 탭 폭증 차단",
  };
  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output["background-root.mjs"] = background;
  output[SHOPLING_AUTO_AGENT_SCRIPT] = agent;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.47\nA19 single-flight and login-loop containment hotfix.\n";
  output["README.txt"] =
    "v0.3.47 A19 LOGIN LOOP HOTFIX\n" +
    "- 로그인 화면과 A19 실패목록 화면에서는 자동 에이전트를 실행하지 않습니다.\n" +
    "- 같은 오케스트레이션의 A19 감사 요청은 브라우저 전체에서 하나의 탭과 하나의 Promise만 공유합니다.\n" +
    "- 로그인 만료 시 로그인 탭은 하나만 남기고 추가 A19 탭을 만들지 않습니다.\n" +
    "- 사용자가 그 탭에서 로그인하면 기존 오케스트레이션의 A19 감사만 재개하며 상품·마켓전송은 반복하지 않습니다.\n" +
    "- v0.3.46의 금지키워드 파싱·영수증·서버 검증 계약을 유지합니다.\n";

  for (const name of ["background-root.mjs", SHOPLING_AUTO_AGENT_SCRIPT]) {
    new Function(output[name]);
  }
  return output;
}
