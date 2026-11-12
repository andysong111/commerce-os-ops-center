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

const A19_AUDITOR_SCRIPT = "shopling-a19-keyword-auditor.mjs";

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

export const SHOPLING_A19_KEYWORD_AUDITOR_V0346 = String.raw`(() => {
  "use strict";
  if (globalThis.__commerceOsShoplingA19KeywordAuditorV0346) return;
  globalThis.__commerceOsShoplingA19KeywordAuditorV0346 = true;
  if (window.top !== window) return;

  const REQUEST_KEY = "commerceOsShoplingA19AuditRequestV0346";
  const RESULT_MESSAGE = "commerce-os-shopling-a19-audit-result-v0346";
  const A19_PATH = "/prodlinkage/goods_mallReg_failList.phtml";

  function text(value) {
    return String(value == null ? "" : value).normalize("NFKC").replace(/\s+/g, " ").trim();
  }
  function storageGet(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (stored) => {
      void chrome.runtime.lastError;
      resolve(stored && stored[key] ? stored[key] : null);
    }));
  }
  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, () => {
      void chrome.runtime.lastError;
      resolve(true);
    }));
  }
  function kstDate() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return String(byType.year || "") + String(byType.month || "") + String(byType.day || "");
  }
  function setValue(element, value) {
    if (!element) return;
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function parseRows() {
    const rows = [];
    const checks = Array.from(document.querySelectorAll('input[name="prod_join_chk[]"]'));
    let failureRowCount = 0;
    for (const checkbox of checks.slice(0, 500)) {
      const productRow = checkbox.closest("tr");
      const failureRow = productRow && productRow.nextElementSibling;
      if (!productRow || !failureRow || !text(failureRow.textContent).startsWith("실패 내용")) continue;
      failureRowCount += 1;
      const cells = Array.from(productRow.cells || []);
      const goodsLink = productRow.querySelector('a[href*="open_prod("]');
      const goodsKey = text(goodsLink && goodsLink.textContent);
      const message = text(failureRow.textContent).replace(/^실패 내용\s*/, "");
      if (!/^\d{5,9}$/.test(goodsKey) || !message) continue;
      const identityLines = text(cells[2] && cells[2].innerText).split(" ").filter(Boolean);
      rows.push({
        transmissionCode: text(checkbox.value),
        goodsKey,
        marketName: identityLines.length > 1 ? identityLines[1] : "",
        message: message.slice(0, 1000),
      });
    }
    return { rows, checkboxCount: checks.length, failureRowCount };
  }
  function sendResult(request, parsed, receipt) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: RESULT_MESSAGE,
        requestId: text(request.requestId),
        orchestrationId: text(request.orchestrationId),
        rows: Array.isArray(parsed && parsed.rows) ? parsed.rows : [],
        receipt: receipt || null,
      }, (response) => {
        void chrome.runtime.lastError;
        resolve(response || null);
      });
    });
  }

  async function run() {
    if (!["a.shopling.co.kr", "kt.shopling.co.kr"].includes(location.hostname)) return;
    if (location.pathname !== A19_PATH) return;
    const request = await storageGet(REQUEST_KEY);
    if (!request || !request.requestId || Date.now() - Number(request.createdAt || 0) > 120000) return;
    const today = kstDate();
    const startDate = document.querySelector("#s_dt");
    const endDate = document.querySelector("#e_dt");
    const rowCount = document.querySelector("#row_cnt");
    const search = Array.from(document.querySelectorAll('input[type="button"],button'))
      .find((element) => text(element.value || element.textContent) === "검색");
    if (!startDate || !endDate || !rowCount || !search) {
      await sendResult(request, { rows: [] }, {
        ok: false,
        error: "a19_search_controls_missing",
        pagePath: location.pathname,
        parsedAt: Date.now(),
      });
      return;
    }
    if (!request.querySubmittedAt) {
      setValue(startDate, today);
      setValue(endDate, today);
      setValue(rowCount, "100");
      await storageSet({ [REQUEST_KEY]: { ...request, queryDate: today, rowLimit: 100, querySubmittedAt: Date.now() } });
      search.click();
      return;
    }
    const parsed = parseRows();
    const receipt = {
      ok: true,
      pagePath: location.pathname,
      queryDate: text(request.queryDate),
      rowLimit: Number(request.rowLimit || 0),
      querySubmittedAt: Number(request.querySubmittedAt || 0),
      parsedAt: Date.now(),
      checkboxCount: parsed.checkboxCount,
      failureRowCount: parsed.failureRowCount,
    };
    await sendResult(request, parsed, receipt);
  }

  void run();
})();
`;

const BACKGROUND_A19_HELPERS = String.raw`
function marketAutoStorageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, () => {
    void chrome.runtime.lastError;
    resolve(true);
  }));
}

function marketAutoCreateTab(url) {
  return new Promise((resolve, reject) => chrome.tabs.create({ url, active: false }, (tab) => {
    const error = chrome.runtime.lastError;
    if (error || !tab || !tab.id) reject(new Error(String(error?.message || "a19_tab_create_failed")));
    else resolve(tab);
  }));
}

function marketAutoCloseTab(tabId) {
  return new Promise((resolve) => chrome.tabs.remove(tabId, () => {
    void chrome.runtime.lastError;
    resolve(true);
  }));
}

async function marketAutoAuditA19(token, orchestrationId) {
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
}
`;

export function buildA19KeywordAuditV0346(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"]) as ExtensionManifest;
  if (manifest.version !== "0.3.45") throw new Error("v0346_wrong_base");
  for (const required of [
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
  ]) {
    if (!output[required]) throw new Error(`v0346_missing_asset:${required}`);
  }

  const existingScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.filter(
        (entry) => !Array.isArray(entry.js) || !entry.js.includes(A19_AUDITOR_SCRIPT),
      )
    : [];
  manifest.content_scripts = [
    ...existingScripts,
    {
      matches: [
        "https://a.shopling.co.kr/prodlinkage/goods_mallReg_failList.phtml*",
        "https://kt.shopling.co.kr/prodlinkage/goods_mallReg_failList.phtml*",
      ],
      js: [A19_AUDITOR_SCRIPT],
      all_frames: false,
      run_at: "document_idle",
    },
  ];
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "storage", "tabs"])];

  let background = output["background-root.mjs"];
  background = replaceExactly(
    background,
    'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
    [
      'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const MARKET_AUTO_BG_A19_AUDIT = "commerce-os-shopling-market-auto-bg-a19-audit-v0346";',
      'const MARKET_AUTO_A19_RESULT = "commerce-os-shopling-a19-audit-result-v0346";',
      'const MARKET_AUTO_A19_REQUEST_KEY = "commerceOsShoplingA19AuditRequestV0346";',
      'const MARKET_AUTO_A19_RESULT_KEY = "commerceOsShoplingA19AuditResultV0346";',
      'const MARKET_AUTO_A19_URL = "https://kt.shopling.co.kr/prodlinkage/goods_mallReg_failList.phtml";',
    ].join("\n"),
    1,
    "v0346_background_constants_anchor",
  );
  background = replaceExactly(
    background,
    "async function marketAutoRequest(action, token) {",
    "async function marketAutoRequest(action, token, extra = {}) {",
    1,
    "v0346_request_signature_anchor",
  );
  background = replaceExactly(
    background,
    "    agentId,\n  });\n}",
    "    agentId,\n    ...extra,\n  });\n}",
    1,
    "v0346_request_payload_anchor",
  );
  background = replaceExactly(
    background,
    "    if (response.ready === true && Array.isArray(response.jobIds) && response.jobIds.length) {\n      return { ...response, token: row.token, ok: true };\n    }",
    "    if (response.auditReady === true || (response.ready === true && Array.isArray(response.jobIds) && response.jobIds.length)) {\n      return { ...response, token: row.token, ok: true };\n    }",
    1,
    "v0346_tick_audit_claim_anchor",
  );
  background = replaceExactly(
    background,
    "async function marketAutoHeartbeat(token) {",
    `${BACKGROUND_A19_HELPERS}\nasync function marketAutoHeartbeat(token) {`,
    1,
    "v0346_background_helpers_anchor",
  );
  background = replaceExactly(
    background,
    "async function marketAutoReport(token) {\n  const response = await marketAutoRequest(\"agent_report\", token);",
    "async function marketAutoReport(token, a19Evidence, a19AuditReceipt) {\n  const response = await marketAutoRequest(\"agent_report\", token, { a19Evidence: Array.isArray(a19Evidence) ? a19Evidence.slice(0, 500) : [], a19AuditReceipt: a19AuditReceipt && typeof a19AuditReceipt === \"object\" ? a19AuditReceipt : null });",
    1,
    "v0346_report_payload_anchor",
  );
  background = replaceExactly(
    background,
    '  if (message.type === MARKET_AUTO_BG_REPORT) {\n    const token = text(message.token);\n    marketAutoReport(token).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));\n    return true;\n  }',
    [
      "  if (message.type === MARKET_AUTO_BG_A19_AUDIT) {",
      "    const token = text(message.token);",
      "    const orchestrationId = text(message.orchestrationId);",
      "    marketAutoAuditA19(token, orchestrationId).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === MARKET_AUTO_A19_RESULT) {",
      "    const requestId = text(message.requestId);",
      "    const orchestrationId = text(message.orchestrationId);",
      "    const rows = Array.isArray(message.rows) ? message.rows.slice(0, 500) : [];",
      "    const receipt = message.receipt && typeof message.receipt === \"object\" ? message.receipt : null;",
      "    marketAutoStorageGet([MARKET_AUTO_A19_REQUEST_KEY]).then((stored) => {",
      "      const pending = stored?.[MARKET_AUTO_A19_REQUEST_KEY] || null;",
      "      if (!pending || pending.requestId !== requestId || pending.orchestrationId !== orchestrationId) { sendResponse({ ok: false, error: \"a19_request_mismatch\" }); return; }",
      "      return marketAutoStorageSet({ [MARKET_AUTO_A19_RESULT_KEY]: { requestId, orchestrationId, rows, receipt, receivedAt: Date.now() } }).then(() => sendResponse({ ok: true }));",
      "    }).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
      "",
      "  if (message.type === MARKET_AUTO_BG_REPORT) {",
      "    const token = text(message.token);",
      "    marketAutoReport(token, message.a19Evidence, message.a19AuditReceipt).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));",
      "    return true;",
      "  }",
    ].join("\n"),
    1,
    "v0346_background_handlers_anchor",
  );

  let agent = output["shopling-market-auto-agent.mjs"];
  agent = replaceExactly(
    agent,
    'const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
    [
      'const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const BG_A19_AUDIT = "commerce-os-shopling-market-auto-bg-a19-audit-v0346";',
    ].join("\n  "),
    1,
    "v0346_agent_constants_anchor",
  );
  agent = replaceExactly(
    agent,
    "  async function tick() {",
    String.raw`  async function auditAndReport(active) {
    const audit = await send({
      type: BG_A19_AUDIT,
      token: active.token,
      orchestrationId: active.orchestrationId,
    });
    if (!audit || audit.ok !== true || !Array.isArray(audit.evidence)) return false;
    const reported = await send({
      type: BG_REPORT,
      token: active.token,
      orchestrationId: active.orchestrationId,
      a19Evidence: audit.evidence,
      a19AuditReceipt: audit.receipt,
    });
    if (reported && reported.ok && reported.terminal === true) {
      await remove(ACTIVE_KEY);
      return true;
    }
    return false;
  }

  async function tick() {`,
    1,
    "v0346_agent_audit_helper_anchor",
  );
  agent = replaceExactly(
    agent,
    "      if (active && active.token && active.orchestrationId) {\n        const queueStartedAt",
    "      if (active && active.token && active.orchestrationId) {\n        if (active.auditOnly === true) { await auditAndReport(active); return; }\n        const queueStartedAt",
    1,
    "v0346_agent_audit_only_anchor",
  );
  agent = replaceExactly(
    agent,
    String.raw`        if (queue && queueStartedAt >= activeStartedAt && terminalQueue(queue.status)) {
          const reported = await send({
            type: BG_REPORT,
            token: active.token,
            orchestrationId: active.orchestrationId,
            queueStatus: text(queue.status),
          });
          if (reported && reported.ok) {
            await remove(ACTIVE_KEY);
          }
          return;
        }`,
    String.raw`        if (queue && queueStartedAt >= activeStartedAt && terminalQueue(queue.status)) {
          await auditAndReport(active);
          return;
        }`,
    1,
    "v0346_agent_terminal_report_anchor",
  );
  agent = replaceExactly(
    agent,
    "      if (!claim || claim.ok !== true || claim.ready !== true) return;\n      const jobIds",
    "      if (!claim || claim.ok !== true || (claim.ready !== true && claim.auditReady !== true)) return;\n      const jobIds",
    1,
    "v0346_agent_claim_anchor",
  );
  agent = replaceExactly(
    agent,
    "      if (!jobIds.length) return;\n      const next = {",
    "      if (!jobIds.length && claim.auditReady !== true) return;\n      const next = {",
    1,
    "v0346_agent_empty_job_anchor",
  );
  agent = replaceExactly(
    agent,
    "        lastHeartbeatAt: Date.now(),\n      };\n      await set({ [ACTIVE_KEY]: next });\n      await ensureIntent(next);",
    "        lastHeartbeatAt: Date.now(),\n        auditOnly: claim.auditReady === true,\n      };\n      await set({ [ACTIVE_KEY]: next });\n      if (next.auditOnly) { await auditAndReport(next); return; }\n      await ensureIntent(next);",
    1,
    "v0346_agent_audit_claim_store_anchor",
  );

  manifest.version = "0.3.46";
  manifest.description =
    "마켓전송 종료 후 Shopling A19 실패건을 1회 조회하고 상품명·검색어 등록불가 단어만 Commerce OS 금지키워드 정책에 자동 누적합니다. 재전송 없이 증거를 서버에 보고한 뒤에만 원클릭 작업을 종료합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.46 · A19 금지어 자동학습",
  };
  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output[A19_AUDITOR_SCRIPT] = SHOPLING_A19_KEYWORD_AUDITOR_V0346;
  output["background-root.mjs"] = background;
  output["shopling-market-auto-agent.mjs"] = agent;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.46\nA19 prohibited-keyword audit runs once after every market transmission.\nNo market retransmission is performed by the audit.\n";
  output["README.txt"] =
    "v0.3.46 A19 PROHIBITED KEYWORD AUDIT\n" +
    "- 마켓전송 종료 뒤 A19 실패건을 오늘 날짜·최대 100건으로 1회 조회합니다.\n" +
    "- 현재 원클릭 goods_key에 해당하는 상품명/검색어 등록불가 단어만 서버에서 재검증해 금지키워드 정책에 누적합니다.\n" +
    "- 카테고리, 커버이미지, 토스 옵션 등의 다른 실패는 금지어로 저장하지 않습니다.\n" +
    "- A19 감사 실패 시 외부 전송은 반복하지 않고 감사 단계만 재시도합니다.\n" +
    "- v0.3.45 KT 관리자 호환, 기존 queue/intent/active 원장과 v0330 서버 protocol을 유지합니다.\n";

  for (const name of [
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
    A19_AUDITOR_SCRIPT,
  ]) {
    new Function(output[name]);
  }
  return output;
}
