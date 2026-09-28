import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { inferShoplingStage, listChromeTargets, probeShoplingTarget, shoplingTargets } from "./chrome-cdp.mjs";
import { readAgentState } from "./files.mjs";
import { redactUrl, sanitizeError } from "./safe-json.mjs";

const execFileAsync = promisify(execFile);

export async function getChromeProcessStatus() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"], { windowsHide: true });
      const rows = stdout.split(/\r?\n/).filter((line) => /^"chrome\.exe"/i.test(line.trim()));
      return { running: rows.length > 0, processCount: rows.length, method: "tasklist", error: null };
    } catch (error) {
      return { running: false, processCount: 0, method: "tasklist", error: sanitizeError(error, "CHROME_PROCESS_CHECK_FAILED") };
    }
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "chrome|chromium"]);
    const rows = stdout.split(/\r?\n/).filter(Boolean);
    return { running: rows.length > 0, processCount: rows.length, method: "pgrep", error: null };
  } catch {
    return { running: false, processCount: 0, method: "pgrep", error: null };
  }
}

export function detectA21ExtensionState(targets, pageProbe) {
  const extensionTargets = targets.filter((target) => String(target.url || "").startsWith("chrome-extension://"));
  const signals = [];
  if (extensionTargets.length) signals.push("CHROME_EXTENSION_TARGET_PRESENT");
  if (pageProbe?.a21Globals?.length) signals.push("A21_MAIN_WORLD_GLOBAL_PRESENT");
  if (/^A21/.test(pageProbe?.role || "")) signals.push("SHOPLING_A21_PAGE_ROLE");

  return {
    state: signals.length ? "partially_detected" : "unknown",
    signals,
    extensionTargetCount: extensionTargets.length,
    note: signals.length
      ? "Chrome DevTools exposes only partial extension/page signals."
      : "A21 extension install/runtime state is not directly readable without Chrome DevTools extension targets or page markers.",
  };
}

export async function buildStatusSnapshot(config, deps = {}) {
  const now = deps.now || (() => new Date());
  const chromeProcess = await (deps.getChromeProcessStatus || getChromeProcessStatus)();
  const state = await (deps.readAgentState || readAgentState)(config);
  const cdp = await (deps.listChromeTargets || listChromeTargets)(config);
  const targets = cdp.targets || [];
  const shopling = shoplingTargets(targets, config.shoplingOrigins);
  const primaryTarget = shopling[0] || null;
  let pageProbe = null;
  let probeError = null;

  if (config.probeShoplingPage && primaryTarget?.webSocketDebuggerUrl) {
    try {
      pageProbe = await (deps.probeShoplingTarget || probeShoplingTarget)(primaryTarget);
    } catch (error) {
      probeError = sanitizeError(error, "SHOPLING_PAGE_PROBE_FAILED");
    }
  }

  const inferredStage =
    pageProbe?.role ||
    (primaryTarget ? inferShoplingStage(primaryTarget) : null) ||
    state.currentAutomationStage ||
    "IDLE";
  const currentErrorCode =
    state.lastErrorCode ||
    probeError?.code ||
    (chromeProcess.running ? cdp.error?.code : null) ||
    null;
  const status =
    cdp.available || !chromeProcess.running
      ? "ok"
      : "degraded";

  return {
    schemaVersion: 1,
    timestamp: now().toISOString(),
    agent: {
      id: config.agentId,
      version: config.agentVersion,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      status,
      currentAutomationStage: inferredStage,
      lastErrorCode: currentErrorCode,
    },
    pc: {
      hostname: os.hostname(),
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      uptimeSeconds: Math.round(os.uptime()),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
    },
    chrome: {
      running: chromeProcess.running,
      processCount: chromeProcess.processCount,
      processCheck: chromeProcess.method,
      remoteDebugging: {
        available: cdp.available,
        endpoint: cdp.endpoint,
        error: cdp.error,
      },
    },
    shopling: {
      tabsPresent: shopling.length > 0,
      tabCount: shopling.length,
      url: primaryTarget ? redactUrl(primaryTarget.url) : null,
      urls: shopling.map((target) => redactUrl(target.url)).slice(0, 20),
      primaryTitle: primaryTarget?.title || null,
      pageProbe: pageProbe
        ? {
            title: pageProbe.title || "",
            role: pageProbe.role || "UNKNOWN",
            a21Globals: pageProbe.a21Globals || [],
            localStorageKeyHints: pageProbe.localStorageKeyHints || [],
            textSample: pageProbe.textSample || "",
          }
        : null,
      probeError,
    },
    a21Extension: detectA21ExtensionState(targets, pageProbe),
  };
}
