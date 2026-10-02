import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { listChromeTargets, withCdpTarget } from "./chrome-cdp.mjs";

const execFileAsync = promisify(execFile);
const LABEL_SETTINGS_PATH = "/order/dlvy_print_setting.phtml";
const LABEL_DOCUMENT_URL = "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml";
const EXPECTED_FIELDS = ["모델번호", "샵플링모델명", "샵플링옵션명", "수량", "옵션자체코드", "선택"];

function selectSettingsTarget(targets = []) {
  const matches = targets.filter((target) => {
    try {
      return new URL(target.url).pathname === LABEL_SETTINGS_PATH;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    const error = new Error(`Expected one Shopling label settings page, found ${matches.length}.`);
    error.code = "SHOPLING_LABEL_SETTINGS_TARGET_COUNT_INVALID";
    throw error;
  }
  return matches[0];
}

function requestLegacyTls(url, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = https.request(url, {
      method,
      headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) },
      ciphers: "DEFAULT@SECLEVEL=1",
      rejectUnauthorized: true,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolveRequest({
        status: response.statusCode || 0,
        body: Buffer.concat(chunks),
        contentType: String(response.headers["content-type"] || ""),
      }));
    });
    request.on("error", rejectRequest);
    request.end(body);
  });
}

export function buildStandaloneLabelHtml(html, localizedSources = new Map()) {
  let standalone = String(html || "")
    .replace(/<div\b[^>]*id=["']loading["'][^>]*>[\s\S]*?<\/div>/i, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  standalone = standalone.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, source) => (
    `${prefix}${quote}${localizedSources.get(source) || source}${quote}`
  ));
  return `<style>
    @page { size: 109mm 127mm; margin: 0 11pt; }
    div.page { break-after: page !important; page-break-after: always !important; break-inside: avoid !important; }
    div.page:last-of-type { break-after: auto !important; page-break-after: auto !important; }
  </style>${standalone}`;
}

export function validateShoplingLabelHtmlPageCount(html, options = {}) {
  const expectedPages = Number(options.expectedPages);
  const autoDetectPages = options.autoDetectPages === true;
  const pageMarkerCount = (String(html || "").match(/\[\d+\s*\/\s*\d+\]/g) || []).length;
  const finalMarker = Math.max(0, ...Array.from(String(html || "").matchAll(/\[\d+\s*\/\s*(\d+)\]/g), (match) => Number(match[1])));
  const validatedPageCount = autoDetectPages ? finalMarker : expectedPages;
  if (!Number.isInteger(validatedPageCount) || validatedPageCount <= 0
    || pageMarkerCount !== validatedPageCount || finalMarker !== validatedPageCount) {
    const error = new Error("Shopling label HTML page count does not match the requested batch.");
    error.code = "SHOPLING_LABEL_HTML_PAGE_COUNT_MISMATCH";
    throw error;
  }
  return validatedPageCount;
}

async function readSettingsForm(config, expectedOrders, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const runWithTarget = dependencies.withCdpTarget || withCdpTarget;
  const listing = await listTargets(config);
  if (!listing.available) {
    const error = new Error("Chrome DevTools is unavailable.");
    error.code = "CHROME_CDP_UNAVAILABLE";
    throw error;
  }
  const target = selectSettingsTarget(listing.targets);
  return runWithTarget(target, async (session) => {
    const evaluated = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const form = document.forms.frm;
        if (!form) throw new Error('Shopling label settings form is unavailable.');
        const params = new URLSearchParams(new FormData(form));
        params.set('mode', 'print_act');
        return {
          body: params.toString(),
          courier: String(form.elements.namedItem('dlvy_id')?.value || ''),
          style: String(form.elements.namedItem('print_style')?.value || ''),
          orderCount: (String(form.elements.namedItem('ord_no_arr')?.value || '').match(/[0-9]+/g) || []).length,
          fields: Array.from(document.querySelectorAll('select[name^="prod_print_info_"]')).map((select) => clean(select.selectedOptions?.[0]?.textContent)),
          recipientOutput: String(document.querySelector('input[name="rcv_nm_YN"]:checked')?.value || ''),
          senderInfo: String(document.querySelector('input[name="send_info"]:checked')?.value || ''),
          mallInfo: String(document.querySelector('input[name="small_nm_yn"]:checked')?.value || ''),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, 15_000);
    const form = evaluated.result?.value;
    if (!form || form.courier !== "018" || form.style !== "003" || form.orderCount !== expectedOrders) {
      const error = new Error("Shopling label settings do not match the requested batch.");
      error.code = "SHOPLING_LABEL_SETTINGS_MISMATCH";
      throw error;
    }
    if (JSON.stringify(form.fields) !== JSON.stringify(EXPECTED_FIELDS)
      || form.recipientOutput !== "N" || form.senderInfo !== "A" || form.mallInfo !== "N") {
      const error = new Error("Shopling label field or sender/recipient settings are unexpected.");
      error.code = "SHOPLING_LABEL_FIELDS_MISMATCH";
      throw error;
    }
    const cookieResult = await session.send("Network.getAllCookies", {}, 10_000);
    const cookieHeader = (cookieResult.cookies || [])
      .filter((cookie) => /(?:^|\.)shopling\.co\.kr$/i.test(cookie.domain))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    if (!cookieHeader) {
      const error = new Error("Shopling session cookies are unavailable.");
      error.code = "SHOPLING_SESSION_COOKIES_MISSING";
      throw error;
    }
    return { body: form.body, cookieHeader };
  }, { timeoutMs: 15_000 });
}

function resolveChromeExecutable(env = process.env, exists = existsSync) {
  const candidates = [
    env.COMMERCE_OS_CHROME,
    join(env.ProgramFiles || "C:/Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    join(env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => exists(candidate)) || "";
}

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const details = await stat(path);
      if (details.size > 0) return details;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  const error = new Error("Headless Chrome did not create the label PDF.");
  error.code = "SHOPLING_LABEL_PDF_NOT_CREATED";
  throw error;
}

export async function createShoplingLabelPdfFromSettings(config, options = {}, dependencies = {}) {
  const expectedOrders = Number(options.expectedOrders);
  const expectedPages = Number(options.expectedPages);
  const autoDetectPages = options.autoDetectPages === true;
  if (!Number.isInteger(expectedOrders) || expectedOrders <= 0
    || (!autoDetectPages && (!Number.isInteger(expectedPages) || expectedPages <= 0))) {
    const error = new Error("A positive expected order count and either a positive page count or auto-detection are required.");
    error.code = "SHOPLING_LABEL_EXPECTED_COUNTS_REQUIRED";
    throw error;
  }
  const { body, cookieHeader } = await readSettingsForm(config, expectedOrders, dependencies);
  const request = dependencies.requestLegacyTls || requestLegacyTls;
  const response = await request(LABEL_DOCUMENT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader,
      origin: "https://a.shopling.co.kr",
      referer: "https://a.shopling.co.kr/order/dlvy_print_setting.phtml",
    },
    body,
  });
  const html = response.body.toString("utf8");
  if (response.status !== 200) {
    const error = new Error("Shopling label HTML page count does not match the requested batch.");
    error.code = "SHOPLING_LABEL_HTML_PAGE_COUNT_MISMATCH";
    throw error;
  }
  const validatedPageCount = validateShoplingLabelHtmlPageCount(html, { expectedPages, autoDetectPages });

  const defaultOutputDir = resolve(options.env?.LOCALAPPDATA || process.env.LOCALAPPDATA || tmpdir(), "CommerceOS", "labels");
  const outputPath = resolve(options.outputPath || resolve(defaultOutputDir, "shopling-labels.pdf"));
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  const jobDir = await mkdtemp(join(tmpdir(), "commerce-os-label-job-"));
  const assetDir = resolve(jobDir, "assets");
  const standalonePath = resolve(jobDir, "shopling-label-standalone.html");
  await mkdir(assetDir, { recursive: true });

  try {
    const imageSources = [...new Set(Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi), (match) => match[1]))];
    const localized = new Map();
    for (const [index, source] of imageSources.entries()) {
      if (/^data:/i.test(source)) continue;
      const asset = await request(new URL(source, LABEL_DOCUMENT_URL).href, {
        headers: { cookie: cookieHeader, referer: LABEL_DOCUMENT_URL },
      });
      if (asset.status !== 200 || !asset.body.length) {
        const error = new Error(`Could not download label asset ${index + 1}.`);
        error.code = "SHOPLING_LABEL_ASSET_DOWNLOAD_FAILED";
        throw error;
      }
      const extension = /png/i.test(asset.contentType) ? ".png"
        : /jpe?g/i.test(asset.contentType) ? ".jpg"
          : /gif/i.test(asset.contentType) ? ".gif"
            : ".bin";
      const name = `asset-${String(index + 1).padStart(3, "0")}${extension}`;
      await writeFile(resolve(assetDir, name), asset.body);
      localized.set(source, `assets/${name}`);
    }
    await writeFile(standalonePath, buildStandaloneLabelHtml(html, localized), "utf8");

    const chrome = dependencies.chromeExecutable || resolveChromeExecutable(options.env);
    if (!chrome) {
      const error = new Error("Google Chrome executable was not found.");
      error.code = "SHOPLING_LABEL_CHROME_MISSING";
      throw error;
    }
    await rm(outputPath, { force: true });
    const profile = resolve(jobDir, "chrome-profile");
    await mkdir(profile, { recursive: true });
    const run = dependencies.execFile || execFileAsync;
    await run(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${outputPath}`,
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      pathToFileURL(standalonePath).href,
    ], { windowsHide: true, timeout: options.renderTimeoutMs || 120_000, maxBuffer: 1024 * 1024 });
    const details = await waitForFile(outputPath);
    const pdf = await readFile(outputPath);
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      const error = new Error("Headless Chrome returned an invalid label PDF.");
      error.code = "SHOPLING_LABEL_PDF_INVALID";
      throw error;
    }
    return {
      outputPath,
      pdfBytes: details.size,
      orderCount: expectedOrders,
      pageCount: validatedPageCount,
      localizedImageCount: localized.size,
      pageCountValidation: "html-and-pdf-parser",
    };
  } finally {
    const tempRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
    if (jobDir.toLowerCase().startsWith(tempRoot)) await rm(jobDir, { recursive: true, force: true });
  }
}
