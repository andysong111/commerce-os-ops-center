import { CdpSession, fetchJson, withBrowserCdpTarget } from "./chrome-cdp.mjs";

const MAX_RESPONSE_CHARS = 64 * 1024 * 1024;
const STOCK_CONTROL_BRIDGE_PATH = "/china-order-manager/stock-control";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function scopedRequestUrl(origin, value) {
  try {
    const expectedOrigin = new URL(origin).origin;
    const url = new URL(value);
    return url.origin === expectedOrigin
      && url.protocol === "https:"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

async function createTarget(config, url, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  const version = await (options.fetchJson || fetchJson)(
    `${config.chromeDebugBaseUrl}/json/version`,
    timeoutMs,
  );
  if (!version.webSocketDebuggerUrl) {
    fail("CDP_BROWSER_WEBSOCKET_MISSING", "Chrome 연결 정보를 확인하지 못했습니다.");
  }
  const session = new CdpSession(version.webSocketDebuggerUrl, options);
  await session.connect(timeoutMs);
  try {
    const created = await session.send("Target.createTarget", { url }, timeoutMs);
    if (!created.targetId) {
      fail("OPS_CENTER_BROWSER_TARGET_CREATE_FAILED", "Ops Center 연결 탭을 만들지 못했습니다.");
    }
    return { id: created.targetId, type: "page", url };
  } finally {
    await session.close();
  }
}

async function closeTarget(config, targetId, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  const version = await (options.fetchJson || fetchJson)(
    `${config.chromeDebugBaseUrl}/json/version`,
    timeoutMs,
  );
  if (!version.webSocketDebuggerUrl) return;
  const session = new CdpSession(version.webSocketDebuggerUrl, options);
  await session.connect(timeoutMs);
  try {
    await session.send("Target.closeTarget", { targetId }, timeoutMs);
  } finally {
    await session.close();
  }
}

function normalizedFilePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

export async function ensureOpsCenterStockoutExtensionLoaded(config, options = {}) {
  const extensionPath = String(config.stockoutExtensionDir || "").trim();
  if (!extensionPath) {
    fail("OPS_CENTER_STOCKOUT_EXTENSION_PATH_MISSING", "HF31 품절 전송 확장 경로가 설정되지 않았습니다.");
  }
  const timeoutMs = Math.max(5_000, Math.min(30_000, Number(options.timeoutMs || 15_000)));
  const version = await (options.fetchJson || fetchJson)(
    `${config.chromeDebugBaseUrl}/json/version`,
    timeoutMs,
  );
  if (!version.webSocketDebuggerUrl) {
    fail("CDP_BROWSER_WEBSOCKET_MISSING", "Chrome 연결 정보를 확인하지 못했습니다.");
  }
  const session = new CdpSession(version.webSocketDebuggerUrl, options);
  await session.connect(timeoutMs);
  try {
    const findPinnedExtension = async () => {
      const response = await session.send("Extensions.getExtensions", {}, timeoutMs);
      return (response.extensions || []).find((extension) => (
        normalizedFilePath(extension.path) === normalizedFilePath(extensionPath)
        && extension.version === "0.5.9"
      )) || null;
    };
    const existing = await findPinnedExtension();
    if (existing?.enabled === true) return { installed: false, extension: existing };

    const loaded = await session.send("Extensions.loadUnpacked", {
      path: extensionPath,
      enableInIncognito: false,
    }, timeoutMs);
    const extension = await findPinnedExtension();
    if (!loaded.id || extension?.id !== loaded.id || extension.enabled !== true) {
      fail("OPS_CENTER_STOCKOUT_EXTENSION_LOAD_FAILED", "HF31 품절 전송 확장을 전용 Chrome에 등록하지 못했습니다.");
    }
    return { installed: true, extension };
  } finally {
    await session.close();
  }
}

async function waitForOrigin(session, origin, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await session.send("Runtime.evaluate", {
      expression: "({ origin: location.origin, readyState: document.readyState })",
      returnByValue: true,
    }, Math.min(timeoutMs, 3_000)).catch(() => null);
    const value = result?.result?.value;
    if (value?.origin === origin && value?.readyState === "complete") return;
    await (options.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(150);
  }
  fail("OPS_CENTER_BROWSER_ORIGIN_TIMEOUT", "자동화 Chrome에서 Ops Center 연결을 준비하지 못했습니다.");
}

export async function requestOpsCenterJsonViaChrome(config, request, options = {}) {
  const origin = new URL(config.opsOrigin).origin;
  const url = String(request?.url || "");
  if (!scopedRequestUrl(origin, url)) {
    fail("OPS_CENTER_BROWSER_TARGET_REJECTED", "허용되지 않은 Ops Center 요청 주소입니다.");
  }

  const method = String(request?.method || "GET").toUpperCase();
  if (!new Set(["GET", "POST", "PUT"]).has(method)) {
    fail("OPS_CENTER_BROWSER_METHOD_REJECTED", "허용되지 않은 Ops Center 요청 방식입니다.");
  }

  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(options.timeoutMs || 30_000)));
  const target = await (options.createTarget || createTarget)(config, `${origin}/`, {
    ...options,
    timeoutMs,
  });
  const connect = options.withBrowserCdpTarget
    || ((selected, handler, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      handler,
      connectOptions,
    ));

  try {
    return await connect(target, async (session) => {
      await session.send("Page.enable", {}, timeoutMs);
      await waitForOrigin(session, origin, { ...options, timeoutMs });
      const result = await session.send("Runtime.evaluate", {
        expression: `(${async function browserRequest(input) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), input.timeoutMs);
          try {
            const response = await fetch(input.url, {
              method: input.method,
              headers: input.headers,
              ...(input.body == null ? {} : { body: input.body }),
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
            });
            const text = await response.text();
            if (text.length > input.maxResponseChars) {
              return { error: "OPS_CENTER_BROWSER_RESPONSE_TOO_LARGE" };
            }
            return { ok: response.ok, status: response.status, text };
          } catch (error) {
            return {
              error: "OPS_CENTER_BROWSER_FETCH_FAILED",
              errorName: String(error?.name || "Error"),
            };
          } finally {
            clearTimeout(timer);
          }
        }})(${JSON.stringify({
          url,
          method,
          headers: request?.headers || {},
          body: request?.body ?? null,
          timeoutMs,
          maxResponseChars: MAX_RESPONSE_CHARS,
        })})`,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs + 5_000);
      if (result.exceptionDetails) {
        fail("OPS_CENTER_BROWSER_EVALUATION_FAILED", "Ops Center 브라우저 요청을 실행하지 못했습니다.");
      }
      const value = result.result?.value;
      if (value?.error) {
        fail(value.error, "자동화 Chrome에서 Ops Center 요청이 실패했습니다.");
      }
      if (!value || typeof value.text !== "string" || !Number.isInteger(value.status)) {
        fail("OPS_CENTER_BROWSER_RESPONSE_INVALID", "Ops Center 브라우저 응답이 올바르지 않습니다.");
      }
      let body;
      try {
        body = JSON.parse(value.text);
      } catch {
        fail("OPS_CENTER_BROWSER_RESPONSE_INVALID", "Ops Center 브라우저 응답이 JSON 형식이 아닙니다.", {
          status: value.status,
        });
      }
      return { ok: value.ok === true, status: value.status, body };
    }, { timeoutMs: timeoutMs + 5_000 });
  } finally {
    await (options.closeTarget || closeTarget)(config, target.id, {
      ...options,
      timeoutMs,
    }).catch(() => null);
  }
}

function normalizeStockoutBarcodes(values) {
  return [...new Set((values || [])
    .map((value) => String(value ?? "").normalize("NFKC").toUpperCase()
      .replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, ""))
    .filter((value) => /^B[A-Z]{1,2}\d+-\d+$/.test(value)))];
}

export async function probeOpsCenterStockoutExtensionViaChrome(config, options = {}) {
  const origin = new URL(config.opsOrigin).origin;
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(options.timeoutMs || 30_000)));
  await (options.ensureStockoutExtension || ensureOpsCenterStockoutExtensionLoaded)(config, options);
  const target = await (options.createTarget || createTarget)(
    config,
    `${origin}${STOCK_CONTROL_BRIDGE_PATH}`,
    { ...options, timeoutMs },
  );
  const connect = options.withBrowserCdpTarget
    || ((selected, handler, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      handler,
      connectOptions,
    ));

  try {
    return await connect(target, async (session) => {
      await session.send("Page.enable", {}, 15_000);
      await waitForOrigin(session, origin, { ...options, timeoutMs });
      const result = await session.send("Runtime.evaluate", {
        expression: `(${async function probeStockoutExtension(input) {
          const channels = [
            {
              name: "HF27",
              ready: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27",
              ping: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27",
            },
            {
              name: "LEGACY",
              ready: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY",
              ping: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING",
            },
          ];
          const bridgeMark = "__commerceOsStockSyncBridgeHF27";
          return await new Promise((resolve) => {
            let interval = null;
            const finish = (value) => {
              if (interval) clearInterval(interval);
              clearTimeout(timer);
              window.removeEventListener("message", onMessage);
              resolve(value);
            };
            const timer = setTimeout(() => finish({
              ok: false,
              code: "OPS_CENTER_STOCKOUT_EXTENSION_NOT_READY",
              message: "Commerce OS 품절 전송 확장프로그램에 연결하지 못했습니다.",
              diagnostics: {
                path: location.pathname,
                readyState: document.readyState,
                bridgeMarker: window[bridgeMark] === true,
                channelsAttempted: channels.map((channel) => channel.name),
              },
            }), input.timeoutMs);
            const ping = () => {
              for (const channel of channels) {
                window.postMessage({ type: channel.ping }, location.origin);
              }
            };
            function onMessage(event) {
              if (event.source !== window || event.origin !== location.origin) return;
              const channel = channels.find((candidate) => candidate.ready === event.data?.type);
              if (!channel) return;
              const bridged = event.data?.[bridgeMark] === true
                || String(event.data?.stockSyncChannel || "").toUpperCase() === "HF27";
              finish({
                ok: true,
                extensionChannel: channel.name === "HF27" || bridged ? "HF27" : channel.name,
                diagnostics: {
                  path: location.pathname,
                  readyState: document.readyState,
                  bridgeMarker: window[bridgeMark] === true,
                },
              });
            }
            window.addEventListener("message", onMessage);
            ping();
            interval = setInterval(ping, 500);
          });
        }})(${JSON.stringify({ timeoutMs })})`,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs + 5_000);
      if (result.exceptionDetails || !result.result?.value) {
        fail("OPS_CENTER_STOCKOUT_PROBE_FAILED", "품절 전송 확장프로그램 연결 점검에 실패했습니다.");
      }
      return result.result.value;
    }, { timeoutMs: timeoutMs + 5_000 });
  } finally {
    await (options.closeTarget || closeTarget)(config, target.id, {
      ...options,
      timeoutMs: 15_000,
    }).catch(() => null);
  }
}

export async function runOpsCenterCanonicalStockoutViaChrome(config, input, options = {}) {
  const origin = new URL(config.opsOrigin).origin;
  const barcodes = normalizeStockoutBarcodes(input?.barcodes);
  if (!barcodes.length || barcodes.length !== (input?.barcodes || []).length) {
    fail("OPS_CENTER_STOCKOUT_BARCODES_INVALID", "기준재고 0으로 확정할 B코드가 올바르지 않습니다.");
  }

  const timeoutMs = Math.max(
    180_000,
    Math.min(30 * 60_000, Number(options.timeoutMs || barcodes.length * 360_000)),
  );
  await (options.ensureStockoutExtension || ensureOpsCenterStockoutExtensionLoaded)(config, options);
  const target = await (options.createTarget || createTarget)(
    config,
    `${origin}${STOCK_CONTROL_BRIDGE_PATH}`,
    {
      ...options,
      timeoutMs: 30_000,
    },
  );
  const connect = options.withBrowserCdpTarget
    || ((selected, handler, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      handler,
      connectOptions,
    ));

  try {
    const value = await connect(target, async (session) => {
      await session.send("Page.enable", {}, 15_000);
      await waitForOrigin(session, origin, { ...options, timeoutMs: 30_000 });
      const result = await session.send("Runtime.evaluate", {
        expression: `(${async function runCanonicalStockout(browserInput) {
          const LEGACY = {
            name: "LEGACY",
            ready: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY",
            ping: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING",
            start: "COMMERCE_OS_SHOPLING_STOCK_SYNC_START",
            result: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT",
          };
          const HF27 = {
            name: "HF27",
            ready: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27",
            ping: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27",
            start: "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27",
            result: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27",
          };
          const BRIDGE_MARK = "__commerceOsStockSyncBridgeHF27";

          const postJson = async (path, body) => {
            const response = await fetch(path, {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json().catch(() => ({}));
            return { ok: response.ok, status: response.status, payload };
          };
          const waitForExtension = () => new Promise((resolve) => {
            let interval = null;
            const timer = setTimeout(() => {
              if (interval) clearInterval(interval);
              window.removeEventListener("message", onMessage);
              resolve(null);
            }, 30_000);
            const ping = () => {
              window.postMessage({ type: HF27.ping }, location.origin);
              window.postMessage({ type: LEGACY.ping }, location.origin);
            };
            function onMessage(event) {
              if (event.source !== window || event.origin !== location.origin) return;
              const type = String(event.data?.type || "");
              if (type !== HF27.ready && type !== LEGACY.ready) return;
              clearTimeout(timer);
              if (interval) clearInterval(interval);
              window.removeEventListener("message", onMessage);
              const bridged = event.data?.[BRIDGE_MARK] === true
                || String(event.data?.stockSyncChannel || "").toUpperCase() === "HF27";
              resolve(type === HF27.ready || bridged ? HF27 : LEGACY);
            }
            window.addEventListener("message", onMessage);
            ping();
            interval = setInterval(ping, 500);
          });
          const waitForResult = (job, channel) => new Promise((resolve) => {
            const timer = setTimeout(() => {
              window.removeEventListener("message", onMessage);
              resolve({
                type: channel.result,
                jobId: job.jobId,
                job,
                outcome: "FAILED",
                message: `${job.barcode} 품절 전송 결과 확인 시간이 초과되었습니다.`,
                evidence: { code: "OPS_CENTER_STOCKOUT_RESULT_TIMEOUT" },
                finishedAt: Date.now(),
              });
            }, browserInput.jobTimeoutMs);
            function onMessage(event) {
              if (event.source !== window || event.origin !== location.origin) return;
              const type = String(event.data?.type || "");
              if ((type !== HF27.result && type !== LEGACY.result)
                || event.data?.jobId !== job.jobId) return;
              clearTimeout(timer);
              window.removeEventListener("message", onMessage);
              resolve(event.data);
            }
            window.addEventListener("message", onMessage);
            window.postMessage({ type: channel.start, job }, location.origin);
          });
          const record = async (job, outcome, message, evidence, finishedAt) => {
            const stamp = Number(finishedAt || Date.now());
            const response = await postJson("/api/inventory-stock-control/sync", {
              eventId: `post-packing-stock-sync:${job.jobId}:${outcome}:${stamp}`.slice(0, 480),
              jobId: job.jobId,
              barcode: job.barcode,
              productKind: job.productKind,
              modelNo: job.modelNo,
              desiredStatus: job.desiredStatus,
              outcome,
              message,
              evidence: {
                canonicalPostPackingStockout: true,
                ...(evidence && typeof evidence === "object" ? evidence : {}),
              },
            });
            if (!response.ok || response.payload?.ok !== true) {
              throw new Error(response.payload?.message || `품절 전송 결과 원장 기록 실패 (HTTP ${response.status})`);
            }
          };

          const extensionChannel = await waitForExtension();
          if (!extensionChannel) {
            return {
              ok: false,
              code: "OPS_CENTER_STOCKOUT_EXTENSION_NOT_READY",
              message: "Commerce OS 품절 전송 확장프로그램에 연결하지 못했습니다.",
              diagnostics: {
                path: location.pathname,
                readyState: document.readyState,
                bridgeMarker: window[BRIDGE_MARK] === true,
                channelsAttempted: [HF27.name, LEGACY.name],
              },
            };
          }

          const batch = await postJson("/api/inventory-stock-control/batch", {
            batchId: browserInput.batchId,
            barcodes: browserInput.barcodes,
            occurredAt: browserInput.occurredAt,
          });
          if (!batch.ok || batch.payload?.ok !== true || !Array.isArray(batch.payload?.jobs)) {
            return {
              ok: false,
              code: batch.payload?.code || "OPS_CENTER_STOCKOUT_BASELINE_FAILED",
              message: batch.payload?.message || `기준재고 0 저장 실패 (HTTP ${batch.status})`,
              status: batch.status,
            };
          }
          const returnedBarcodes = batch.payload.jobs
            .map((job) => String(job?.barcode || "").toUpperCase())
            .sort();
          const requestedBarcodes = [...browserInput.barcodes].sort();
          if (returnedBarcodes.length !== requestedBarcodes.length
            || returnedBarcodes.some((barcode, index) => barcode !== requestedBarcodes[index])) {
            return {
              ok: false,
              code: "OPS_CENTER_STOCKOUT_JOB_SET_MISMATCH",
              message: "기준재고 0 저장 후 생성된 품절 작업이 요청 B코드 전체와 일치하지 않습니다.",
              batch: batch.payload,
            };
          }

          const results = [];
          for (const job of batch.payload.jobs) {
            await record(
              job,
              "STARTED",
              "미발송 송장 처리에서 기준재고 0 확정 후 Shopling·연결 쇼핑몰 품절 전송을 시작했습니다.",
              { batchId: browserInput.batchId },
            );
            const result = await waitForResult(job, extensionChannel);
            await record(
              result.job || job,
              result.outcome,
              result.message || "",
              result.evidence,
              result.finishedAt,
            );
            results.push({
              bCode: job.barcode,
              jobId: job.jobId,
              outcome: result.outcome,
              message: result.message || "",
              evidence: result.evidence || null,
            });
            if (result.outcome !== "SUCCEEDED") {
              return {
                ok: false,
                code: "OPS_CENTER_STOCKOUT_TRANSMISSION_FAILED",
                message: result.message || `${job.barcode} 품절 전송에 실패했습니다.`,
                batch: batch.payload,
                results,
              };
            }
          }
          return { ok: true, extensionChannel: extensionChannel.name, batch: batch.payload, results };
        }})(${JSON.stringify({
          batchId: String(input.batchId || "").slice(0, 160),
          barcodes,
          occurredAt: input.occurredAt || new Date().toISOString(),
          jobTimeoutMs: Math.max(120_000, Math.min(10 * 60_000, Number(options.jobTimeoutMs || 360_000))),
        })})`,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs);
      if (result.exceptionDetails) {
        fail("OPS_CENTER_STOCKOUT_EVALUATION_FAILED", "기준재고 0·품절 전송 실행 중 브라우저 오류가 발생했습니다.");
      }
      return result.result?.value;
    }, { timeoutMs: timeoutMs + 5_000 });

    if (!value || value.ok !== true) {
      fail(
        value?.code || "OPS_CENTER_CANONICAL_STOCKOUT_FAILED",
        value?.message || "기준재고 0·품절 전송 결과를 확인하지 못했습니다.",
        value || {},
      );
    }
    return value;
  } finally {
    await (options.closeTarget || closeTarget)(config, target.id, {
      ...options,
      timeoutMs: 15_000,
    }).catch(() => null);
  }
}
