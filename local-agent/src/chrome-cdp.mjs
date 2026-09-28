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
    if (!message.id || !this.pending.has(message.id)) return;
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

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
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
  if (/상품\s*수정전송|goods_mallMdfy_trsmt/i.test(`${text} ${url}`)) role = "A21_POPUP";
  else if (/쇼핑몰상품수정|검색항목/i.test(text)) role = "A21_LIST";
  else if (/옵션대량수정/i.test(text)) role = "A6";
  else if (/상품조회수정/i.test(text)) role = "A4";
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
    const result = await session.send("Runtime.evaluate", {
      expression: SHOPLING_STATUS_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    return result.result?.value || null;
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
