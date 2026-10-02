import { Buffer } from "node:buffer";
import { compactString, redactUrl, sanitizeError } from "./safe-json.mjs";

const DEFAULT_TIMEOUT_MS = 2_500;

export async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`Chrome DevTools endpoint returned HTTP ${response.status}`);
      error.code = "CHROME_CDP_HTTP_ERROR";
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listChromeTargets(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const targets = await fetchJson(`${config.chromeDebugBaseUrl}/json/list`, DEFAULT_TIMEOUT_MS, fetchImpl);
    return {
      available: true,
      endpoint: config.chromeDebugBaseUrl,
      targets: Array.isArray(targets) ? targets.map(safeTarget) : [],
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      endpoint: config.chromeDebugBaseUrl,
      targets: [],
      error: sanitizeError(error, "CHROME_CDP_UNAVAILABLE"),
    };
  }
}

function safeTarget(target) {
  return {
    id: String(target.id || ""),
    type: String(target.type || ""),
    title: compactString(target.title || "", 200),
    url: redactUrl(target.url || ""),
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ? String(target.webSocketDebuggerUrl) : "",
  };
}

export function isShoplingUrl(url, origins) {
  return origins.some((origin) => String(url || "").startsWith(origin));
}

export function shoplingTargets(targets, origins) {
  return targets.filter((target) => target.type === "page" && isShoplingUrl(target.url, origins));
}

export function inferShoplingStage(targetOrUrl, title = "") {
  const url = typeof targetOrUrl === "string" ? targetOrUrl : targetOrUrl?.url || "";
  const text = `${title || targetOrUrl?.title || ""} ${url}`;
  if (/goods_mallMdfy_trsmt|상품\s*수정전송|A21_POPUP/i.test(text)) return "A21_POPUP";
  if (/쇼핑몰상품수정|A21_LIST/i.test(text)) return "A21_LIST";
  if (/옵션대량수정|A6/i.test(text)) return "A6";
  if (/상품조회수정|A4/i.test(text)) return "A4";
  if (/main\.phtml/i.test(text)) return "SHOPLING_MAIN";
  return url ? "SHOPLING_PAGE" : "UNKNOWN";
}

export class CdpSession {
  constructor(webSocketUrl, options = {}) {
    this.webSocketUrl = webSocketUrl;
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.socket = null;
  }

  async connect(timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.WebSocketImpl) {
      const error = new Error("Node.js WebSocket API is unavailable.");
      error.code = "CDP_WEBSOCKET_UNAVAILABLE";
      throw error;
    }
    this.socket = new this.WebSocketImpl(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("CDP WebSocket connect timeout."), { code: "CDP_CONNECT_TIMEOUT" })), timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("CDP WebSocket connection failed."), { code: "CDP_CONNECT_FAILED" }));
      }, { once: true });
      this.socket.addEventListener("message", (event) => this.handleMessage(event));
      this.socket.addEventListener("close", () => this.rejectAll("CDP socket closed."));
    });
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.id) {
      const listeners = this.eventListeners.get(message.method);
      if (!listeners) return;
      for (const listener of [...listeners]) listener(message.params || {}, message);
      return;
    }
    if (!this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(message.error.message || "CDP command failed.");
      error.code = message.error.code ? `CDP_${message.error.code}` : "CDP_COMMAND_FAILED";
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  rejectAll(message) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error(message), { code: "CDP_SOCKET_CLOSED" }));
      this.pending.delete(id);
    }
  }

  on(method, listener) {
    const listeners = this.eventListeners.get(method) || new Set();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.eventListeners.delete(method);
    };
  }

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS, sessionId = "") {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`CDP ${method} timeout.`), { code: "CDP_COMMAND_TIMEOUT" }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(payload);
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Nothing useful to do during shutdown.
    }
  }
}

export async function withBrowserCdpTarget(config, target, handler, options = {}) {
  if (!target?.id) {
    const error = new Error("Target does not expose a target id.");
    error.code = "CDP_TARGET_ID_MISSING";
    throw error;
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const version = await fetchJson(`${config.chromeDebugBaseUrl}/json/version`, timeoutMs, options.fetchImpl || fetch);
  if (!version.webSocketDebuggerUrl) {
    const error = new Error("Chrome does not expose a browser WebSocket debugger URL.");
    error.code = "CDP_BROWSER_WEBSOCKET_MISSING";
    throw error;
  }
  const browserSession = new CdpSession(version.webSocketDebuggerUrl, options);
  await browserSession.connect(timeoutMs);
  let attachedSessionId = "";
  try {
    const attached = await browserSession.send("Target.attachToTarget", {
      targetId: target.id,
      flatten: true,
    }, timeoutMs);
    attachedSessionId = attached.sessionId;
    const targetSession = {
      send(method, params = {}, commandTimeoutMs = timeoutMs) {
        return browserSession.send(method, params, commandTimeoutMs, attachedSessionId);
      },
      on(method, listener) {
        return browserSession.on(method, (params, message) => {
          if (message.sessionId === attachedSessionId) listener(params, message);
        });
      },
    };
    return await handler(targetSession);
  } finally {
    if (attachedSessionId) {
      await browserSession.send("Target.detachFromTarget", { sessionId: attachedSessionId }, timeoutMs).catch(() => null);
    }
    browserSession.close();
  }
}

export async function withCdpTarget(target, handler, options = {}) {
  if (!target.webSocketDebuggerUrl) {
    const error = new Error("Target does not expose a WebSocket debugger URL.");
    error.code = "CDP_TARGET_WEBSOCKET_MISSING";
    throw error;
  }
  const session = new CdpSession(target.webSocketDebuggerUrl, options);
  await session.connect(options.timeoutMs);
  try {
    return await handler(session);
  } finally {
    session.close();
  }
}

export function flattenCdpFrameTree(frameTree, depth = 0, output = []) {
  if (!frameTree?.frame?.id) return output;
  output.push({
    id: String(frameTree.frame.id),
    parentId: String(frameTree.frame.parentId || ""),
    name: compactString(frameTree.frame.name || "", 120),
    url: redactUrl(frameTree.frame.url || ""),
    depth,
  });
  for (const child of frameTree.childFrames || []) flattenCdpFrameTree(child, depth + 1, output);
  return output;
}

export async function evaluateCdpExpressionAcrossFrames(session, expression, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const evaluateTopDocument = async () => {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
    return result.result?.value == null
      ? []
      : [{ frame: { id: "", parentId: "", name: "", url: "", depth: 0 }, value: result.result.value }];
  };
  let frames = [];
  try {
    await session.send("Page.enable", {}, timeoutMs);
    const tree = await session.send("Page.getFrameTree", {}, timeoutMs);
    frames = flattenCdpFrameTree(tree.frameTree);
  } catch {
    // Runtime.evaluate below still gives us a useful top-document fallback.
  }

  if (!frames.length) return evaluateTopDocument();

  const evaluated = [];
  for (const frame of frames) {
    try {
      const world = await session.send("Page.createIsolatedWorld", {
        frameId: frame.id,
        worldName: "commerce-os-local-agent",
        grantUniveralAccess: false,
      }, timeoutMs);
      const result = await session.send("Runtime.evaluate", {
        expression,
        contextId: world.executionContextId,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs);
      if (result.result?.value != null) evaluated.push({ frame, value: result.result.value });
    } catch {
      // One inaccessible frame must not suppress evidence from the remaining frames.
    }
  }
  return evaluated.length ? evaluated : evaluateTopDocument();
}

const SHOPLING_ROLE_PRIORITY = {
  A21_POPUP: 60,
  A21_LIST: 50,
  A6: 40,
  A4: 30,
  SHOPLING_MAIN: 20,
  SHOPLING_PAGE: 10,
  UNKNOWN: 0,
};

export function selectBestShoplingFrameResult(results, goodsKey = "") {
  const expectedGoodsKey = String(goodsKey || "");
  return [...(results || [])].sort((left, right) => {
    const score = (entry) => {
      const value = entry?.value || {};
      const role = value.pageRole || value.role || "UNKNOWN";
      const searchable = String(value.searchInputValue || "");
      return (SHOPLING_ROLE_PRIORITY[role] || 0) * 100
        + (expectedGoodsKey && searchable.includes(expectedGoodsKey) ? 10_000 : 0)
        + (value.textSample || value.domCore?.bodyTextSample ? 20 : 0)
        + Number(entry?.frame?.depth || 0);
    };
    return score(right) - score(left);
  })[0] || null;
}

function shoplingStatusProbe() {
  const text = document.body?.innerText || "";
  const url = location.href;
  const title = document.title || "";
  const globals = [
    "commerceOsWakeA21MonthlyResult",
    "collectMonthlyPricePage",
    "collectMonthlyRegisteredMarketPage",
    "inspectMonthlyRegisteredMarketFrame",
  ].filter((name) => typeof globalThis[name] === "function");
  const storageKeys = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (/commerce|shopling|a21/i.test(key || "")) storageKeys.push(key);
    }
  } catch {}
  let role = "SHOPLING_PAGE";
  if (/goods_mallMdfy_trsmt/i.test(url) || /상품\s*수정전송/i.test(text)) role = "A21_POPUP";
  else if (/goods_mallMdfy/i.test(url)) role = "A21_LIST";
  else if (/prodBulk[^/]*(?:Opt|Option)|옵션대량수정/i.test(url)) role = "A6";
  else if (/\/prod\/prodLst\.phtml/i.test(url)) role = "A4";
  else if (/\/main\.phtml(?:[?#]|$)/i.test(url)) role = "SHOPLING_MAIN";
  else if (/§\s*상품\s*>\s*\[A4\]\s*상품조회수정/i.test(text)) role = "A4";
  else if (/§\s*상품\s*>\s*\[A6\]\s*옵션대량수정/i.test(text)) role = "A6";
  else if (/§\s*상품\s*>\s*\[A21\]\s*쇼핑몰상품수정/i.test(text)) role = "A21_LIST";
  return {
    url,
    title,
    role,
    a21Globals: globals,
    localStorageKeyHints: storageKeys.slice(0, 20),
    textSample: text.replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

export const SHOPLING_STATUS_EXPRESSION = `(${shoplingStatusProbe.toString()})()`;

export async function probeShoplingTarget(target, options = {}) {
  return withCdpTarget(target, async (session) => {
    const mainWorld = await session.send("Runtime.evaluate", {
      expression: SHOPLING_STATUS_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS).then((result) => result.result?.value || null).catch(() => null);
    const results = await evaluateCdpExpressionAcrossFrames(session, SHOPLING_STATUS_EXPRESSION, options);
    const selected = selectBestShoplingFrameResult(results);
    if (!selected) return null;
    const signalValues = [...results.map((entry) => entry.value), ...(mainWorld ? [mainWorld] : [])];
    return {
      ...selected.value,
      a21Globals: [...new Set(signalValues.flatMap((value) => value?.a21Globals || []))],
      localStorageKeyHints: [...new Set(signalValues.flatMap((value) => value?.localStorageKeyHints || []))].slice(0, 20),
      frame: selected.frame,
      inspectedFrameCount: results.length,
    };
  }, options);
}

export async function captureTargetScreenshot(target, options = {}) {
  return withCdpTarget(target, async (session) => {
    await session.send("Page.enable", {}, options.timeoutMs || DEFAULT_TIMEOUT_MS).catch(() => null);
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, options.timeoutMs || 5_000);
    return result.data ? Buffer.from(result.data, "base64") : null;
  }, options);
}
